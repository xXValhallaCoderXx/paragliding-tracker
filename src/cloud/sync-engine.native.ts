import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { cloudAuthService } from './auth-service';
import { flightRow, profileRow } from './payloads';
import { CLOUD_CONFIG, cloudConfigured } from './config';
import {
  classifySyncError,
  evaluateSyncGate,
  hasUsableTrack,
  igcObjectPath,
  nextBackoff,
  shouldUploadIgc,
} from './sync-plan';
import { getSupabase } from './supabase';
import type { CloudSyncEngine, SyncSnapshot, SyncTrigger } from './types';
import { RECORDER_CONFIG } from '@/recorder/config';
import {
  bindCloudLink,
  clearFlightDeletion,
  countPendingSync,
  getCloudLink,
  getPilotProfile,
  getUnfinishedSession,
  getSessionExportData,
  listDirtyFlights,
  listPendingFlightDeletions,
  markFlightIgcPushed,
  markFlightPushed,
  markPilotProfilePushed,
  resetCloudLink,
  recordFlightDeletionFailure,
  recordFlightSyncFailure,
  setCloudCursors,
  updatePilotProfile,
  applyRemoteFlightMetadata,
} from '@/recorder/database.native';
import { buildUnsignedIgc } from '@/recorder/igc';
import type { FlightSyncCandidate } from '@/recorder/types';

/**
 * Offline-first backup of the local logbook.
 *
 * Three properties hold at all times, and everything else is detail:
 *
 * 1. **The phone is the source of truth.** Flight facts — status, timestamps, metrics,
 *    IGC references — are pushed and never pulled. Only title/site/notes merge back.
 * 2. **Capture always wins.** The gate refuses to run while recording, and the dirty
 *    query independently excludes unfinished flights. No network call ever happens
 *    inside a database transaction.
 * 3. **Nothing here can lose local data.** The only local write outside the sync
 *    bookkeeping tables is a guarded metadata update; a remote signal never deletes.
 */

const INITIAL_SNAPSHOT: SyncSnapshot = {
  phase: 'idle',
  blockedBy: null,
  lastSyncAt: null,
  pendingFlights: 0,
  pendingDeletions: 0,
  cloudOnlyFlights: 0,
  linkedUserId: null,
  lastError: null,
};

/** Whole-cycle backoff, in memory: a failed cycle should not persist a wait across launches. */
let cycleAttemptCount = 0;
let cycleNextAttemptAt = 0;

let snapshot: SyncSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<(snapshot: SyncSnapshot) => void>();
let inFlight: Promise<SyncSnapshot> | null = null;

function publish(patch: Partial<SyncSnapshot>): SyncSnapshot {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

async function refreshCounts(): Promise<void> {
  try {
    const pending = await countPendingSync();
    publish({ pendingFlights: pending.flights, pendingDeletions: pending.deletions });
  } catch {
    // Counts are cosmetic; never let them fail a cycle.
  }
  try {
    // Read here as well as in runCycle so the value is available from the moment the
    // provider subscribes. Signed-out users never complete a cycle, and the logbook
    // needs the link to offer reconnection to an existing backup.
    const link = await getCloudLink();
    publish({ linkedUserId: link.userId });
  } catch {
    // Same contract: never fail a cycle over it.
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function pushProfile(userId: string): Promise<void> {
  const profile = await getPilotProfile();
  if (profile.pushedUpdatedAt !== null && profile.pushedUpdatedAt >= profile.updatedAt) return;

  const { error } = await getSupabase()
    .from('profiles')
    .upsert(
      profileRow(profile, userId),
      { onConflict: 'id' },
    );
  if (error) throw error;
  // The watermark is the value that was actually uploaded, not "now" — an edit made
  // while the request was in flight stays dirty and is pushed on the next cycle.
  await markPilotProfilePushed(profile.updatedAt);
}

async function pushDeletions(userId: string, now: number, ignoreBackoff: boolean): Promise<unknown[]> {
  const failures: unknown[] = [];
  const tombstones = await listPendingFlightDeletions(CLOUD_CONFIG.pushBatchSize, now, { ignoreBackoff });
  for (const tombstone of tombstones) {
    try {
      // Storage first: an orphaned object nobody can list is worse than a flight row
      // that gets deleted on the next pass.
      const { error: removeError } = await getSupabase()
        .storage.from(CLOUD_CONFIG.igcBucket)
        .remove([igcObjectPath(userId, tombstone.flightId)]);
      // A missing object is the expected case for a flight that was never uploaded.
      if (removeError && !/not found/i.test(removeError.message)) throw removeError;

      const { error } = await getSupabase()
        .from('flights')
        .delete()
        .eq('id', tombstone.flightId)
        .eq('user_id', userId);
      if (error) throw error;

      await clearFlightDeletion(tombstone.flightId);
    } catch (error) {
      const kind = classifySyncError(error);
      if (kind === 'reauth') throw error;
      const backoff = nextBackoff(tombstone.attemptCount, now, Math.random);
      await recordFlightDeletionFailure(
        tombstone.flightId,
        messageOf(error),
        kind === 'fatal' ? now + CLOUD_CONFIG.backoffMaxMs : backoff.nextAttemptAt,
      );
      failures.push(error);
    }
  }
  return failures;
}

async function pushIgc(flight: FlightSyncCandidate, userId: string): Promise<void> {
  if (!hasUsableTrack(flight)) return;

  const data = await getSessionExportData(flight.recordingSessionId);
  const profile = await getPilotProfile();
  const igc = buildUnsignedIgc(data.session, data.locations, {
    pilotName: profile.pilotName,
    gliderType: profile.gliderType,
    gliderId: profile.gliderId,
  });
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, igc.content);
  if (!shouldUploadIgc(flight, sha256)) return;

  const objectPath = igcObjectPath(userId, flight.id);
  const { error: uploadError } = await getSupabase()
    .storage.from(CLOUD_CONFIG.igcBucket)
    .upload(objectPath, igc.content, {
      contentType: 'application/vnd.fai.igc',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const byteCount = new TextEncoder().encode(igc.content).byteLength;
  const { error } = await getSupabase()
    .from('flights')
    .update({
      igc_object_path: objectPath,
      igc_sha256: sha256,
      igc_byte_count: byteCount,
      igc_artifact_version: RECORDER_CONFIG.igcArtifactVersion,
    })
    .eq('id', flight.id)
    .eq('user_id', userId);
  if (error) throw error;

  await markFlightIgcPushed({ flightId: flight.id, sha256, objectPath, pushedAt: Date.now() });
}

async function pushFlights(userId: string, now: number, ignoreBackoff: boolean): Promise<unknown[]> {
  const failures: unknown[] = [];
  const flights = await listDirtyFlights(CLOUD_CONFIG.pushBatchSize, now, { ignoreBackoff });
  for (const flight of flights) {
    try {
      const { data, error } = await getSupabase()
        .from('flights')
        .upsert(flightRow(flight, userId, Platform.OS), { onConflict: 'id' })
        .select('updated_at')
        .single();
      if (error) throw error;

      // Only acknowledge the flight after its required IGC has reached the server.
      // An upload failure must leave the flight pending for the next attempt.
      await pushIgc(flight, userId);

      await markFlightPushed({
        flightId: flight.id,
        pushedUpdatedAt: flight.updatedAt,
        remoteUpdatedAt: String(data?.updated_at ?? ''),
      });
    } catch (error) {
      const kind = classifySyncError(error);
      if (kind === 'reauth') throw error;
      const backoff = nextBackoff(flight.attemptCount, now, Math.random);
      await recordFlightSyncFailure(
        flight.id,
        messageOf(error),
        // A row the server will never accept is parked rather than retried every cycle.
        kind === 'fatal' ? now + CLOUD_CONFIG.backoffMaxMs : backoff.nextAttemptAt,
      );
      failures.push(error);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pullProfile(userId: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('pilot_name, glider_type, glider_id, registration_id, client_updated_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  const local = await getPilotProfile();
  if (data.client_updated_at <= local.updatedAt) return;

  await updatePilotProfile(
    {
      pilotName: data.pilot_name,
      gliderType: data.glider_type,
      gliderId: data.glider_id,
      registrationId: data.registration_id,
    },
    data.client_updated_at,
  );
  await markPilotProfilePushed(data.client_updated_at);
}

/**
 * Pulls metadata edits and counts what the account holds that this device does not.
 *
 * Cloud-only flights are counted, never materialised: a flight row here would need a
 * `sessions` row and its raw fixes to satisfy the local schema's RESTRICT foreign keys,
 * and inventing one would corrupt the evidence story the recorder exists to protect.
 */
async function pullFlights(userId: string, cursor: string | null): Promise<string | null> {
  const query = getSupabase()
    .from('flights')
    .select('id, title, site, notes, client_updated_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(CLOUD_CONFIG.pullPageSize);

  const { data, error } = cursor ? await query.gt('updated_at', cursor) : await query;
  if (error) throw error;
  if (!data || data.length === 0) return cursor;

  let cloudOnly = 0;
  let nextCursor = cursor;
  for (const row of data) {
    const outcome = await applyRemoteFlightMetadata(
      {
        flightId: row.id,
        title: row.title,
        site: row.site,
        notes: row.notes,
        clientUpdatedAt: row.client_updated_at,
      },
      String(row.updated_at),
    );
    // Only a flight with no local row at all is one this device has never held. A local
    // row that simply happens to be newer is emphatically not "cloud only".
    if (outcome === 'missing') cloudOnly += 1;
    nextCursor = String(row.updated_at);
  }

  publish({ cloudOnlyFlights: cloudOnly });
  await setCloudCursors({ flightsCursor: nextCursor, cloudOnlyFlightCount: cloudOnly });
  return nextCursor;
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

async function runCycle(trigger: SyncTrigger, recorderRecovering: boolean): Promise<SyncSnapshot> {
  const now = Date.now();
  const auth = cloudAuthService.getSnapshot();

  let link;
  try {
    link = await getCloudLink();
  } catch (error) {
    return publish({ phase: 'error', lastError: messageOf(error) });
  }
  // Published before the gate, because the gate blocks on every guest cycle and the
  // logbook needs to know whether this phone has ever had an account.
  publish({
    linkedUserId: link.userId,
    lastSyncAt: link.lastSyncAt,
    lastError: link.lastSyncError,
  });

  // Read straight from the database rather than subscribing to recorderService: its
  // subscribe() starts a 1 Hz poll, far too expensive to hold open just to observe state.
  const unfinished = await getUnfinishedSession().catch(() => null);

  const gate = evaluateSyncGate({
    configured: cloudConfigured,
    authStatus: auth.status,
    sessionUserId: auth.userId,
    linkedUserId: link.userId,
    recorderRecovering,
    unfinishedSessionStatus:
      unfinished?.status === 'recording' || unfinished?.status === 'interrupted'
        ? unfinished.status
        : null,
    now,
    lastSyncAt: link.lastSyncAt,
    nextAttemptAt: cycleNextAttemptAt,
    trigger,
  });

  if (!gate.run) {
    await refreshCounts();
    return publish({ phase: 'blocked', blockedBy: gate.reason });
  }

  publish({ phase: 'syncing', blockedBy: null, lastError: null });
  const userId = auth.userId!;

  try {
    if (gate.bindTo) await bindCloudLink(gate.bindTo, now);

    await pushProfile(userId);
    const ignoreBackoff = trigger === 'manual';
    const failures = await pushDeletions(userId, now, ignoreBackoff);
    failures.push(...await pushFlights(userId, now, ignoreBackoff));
    await pullProfile(userId);
    await pullFlights(userId, link.flightsCursor);

    // Let independent rows finish, but never report a completed backup while a row
    // failed. Its own retry state remains stored even after this cycle ends.
    if (failures.length > 0) throw failures[0];

    cycleAttemptCount = 0;
    cycleNextAttemptAt = 0;
    await setCloudCursors({ lastSyncAt: now, lastSyncError: null });
    await refreshCounts();
    return publish({ phase: 'idle', blockedBy: null, lastSyncAt: now, lastError: null });
  } catch (error) {
    const kind = classifySyncError(error);
    if (kind === 'reauth') {
      // The token is no longer accepted. Sign out so the account screen offers a way
      // back in, rather than retrying with a credential the server has rejected.
      // A failed logout already reports its error through the auth snapshot. Keep
      // this cycle's original sync error and retry schedule even if logout fails.
      await cloudAuthService.signOut().catch(() => undefined);
    }
    const backoff = nextBackoff(cycleAttemptCount, now, Math.random);
    cycleAttemptCount = backoff.attemptCount;
    cycleNextAttemptAt = backoff.nextAttemptAt;
    await setCloudCursors({ lastSyncError: messageOf(error) }).catch(() => undefined);
    await refreshCounts();
    return publish({ phase: 'error', lastError: messageOf(error) });
  }
}

export const cloudSyncEngine: CloudSyncEngine = {
  getSnapshot: () => snapshot,

  rebindTo: async (userId: string) => {
    await resetCloudLink(userId);
    // resetCloudLink binds to `userId`, so that is what the snapshot must report.
    publish({ blockedBy: null, lastError: null, cloudOnlyFlights: 0, linkedUserId: userId });
    await refreshCounts();
  },

  /**
   * Overlapping triggers coalesce onto one cycle rather than queueing. Two foreground
   * events in the same second should do the work once, not twice.
   */
  requestSync: (trigger: SyncTrigger, options?: { recorderRecovering?: boolean }) => {
    if (!inFlight) {
      inFlight = runCycle(trigger, options?.recorderRecovering ?? false).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  },

  subscribe: (listener) => {
    listeners.add(listener);
    listener(snapshot);
    void refreshCounts();
    return () => {
      listeners.delete(listener);
    };
  },
};

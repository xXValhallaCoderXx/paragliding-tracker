import { archiveRepository } from '@/archives/repository';
import { notifyJournal, setJournalOwner } from '@/journal/context';
import { deleteRemoteFlight, mergeRemoteFlight, pullArchiveCatalogue, pullFlightDeletions, pushArchiveChanges } from './archive-sync.native';
import { downloadArchiveIgc } from './archive-download.native';
import { RestoreTransfer } from './restore-transfer';
import { INITIAL_RESTORE_ENVIRONMENT, type RestoreEnvironment } from './restore-plan';
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
  getFlightDetail,
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
  markFlightCloudOwner,
} from '@/recorder/database.native';
import { buildUnsignedIgc } from '@/recorder/igc';
import type { FlightSyncCandidate } from '@/recorder/types';

/**
 * Foreground backup and private archive restoration. Captured evidence remains
 * separate from restored summaries and verified IGCs. Capture takes priority;
 * only an owner-scoped explicit deletion marker can remove completed evidence.
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
let countRefreshRevision = 0;

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
  const generation = authGeneration;
  const owner = activeOwner;
  const revision = ++countRefreshRevision;
  const current = () => generation === authGeneration && revision === countRefreshRevision;
  try {
    const now = Date.now();
    const [pending, metadata, deletions] = await Promise.all([
      countPendingSync(owner ?? undefined),
      owner ? archiveRepository.listDirtyMetadata(owner, Number.MAX_SAFE_INTEGER, now, true) : [],
      owner ? archiveRepository.listPendingDeletions(owner, Number.MAX_SAFE_INTEGER, now, true) : [],
    ]);
    if (!current()) return;
    publish({ pendingFlights: pending.flights + metadata.length, pendingDeletions: pending.deletions + deletions.length });
  } catch {
    // Counts are cosmetic; never let them fail a cycle.
  }
  try {
    // Read here as well as in runCycle so the value is available from the moment the
    // provider subscribes. Signed-out users never complete a cycle, and the logbook
    // needs the link to offer reconnection to an existing backup.
    const link = await getCloudLink();
    if (!current()) return;
    publish({ linkedUserId: link.userId });
  } catch {
    // Same contract: never fail a cycle over it.
  }
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function pushProfile(userId: string, guard: () => void): Promise<void> {
  guard();
  const profile = await getPilotProfile();
  if (profile.updatedAt === 0 && profile.pushedUpdatedAt === null) return;
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
  guard();
  await markPilotProfilePushed(profile.updatedAt);
}

async function pushDeletions(userId: string, now: number, ignoreBackoff: boolean, guard: () => void): Promise<unknown[]> {
  const failures: unknown[] = [];
  const tombstones = await listPendingFlightDeletions(CLOUD_CONFIG.pushBatchSize, now, { ignoreBackoff, ownerUserId: userId });
  for (const tombstone of tombstones) {
    try {
      guard();
      // Legacy unowned receipts must never be silently rebound to a different pilot.
      if (tombstone.ownerUserId !== userId) continue;
      await deleteRemoteFlight(userId, tombstone.flightId, guard);
      guard();

      await clearFlightDeletion(tombstone.flightId, userId);
    } catch (error) {
      guard();
      const kind = classifySyncError(error);
      if (kind === 'reauth') throw error;
      const backoff = nextBackoff(tombstone.attemptCount, now, Math.random);
      await recordFlightDeletionFailure(
        tombstone.flightId,
        messageOf(error),
        kind === 'fatal' ? now + CLOUD_CONFIG.backoffMaxMs : backoff.nextAttemptAt,
        userId,
      );
      failures.push(error);
    }
  }
  return failures;
}

async function pushIgc(flight: FlightSyncCandidate, userId: string, guard: () => void): Promise<void> {
  guard();
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

  guard();
  const objectPath = igcObjectPath(userId, flight.id);
  const { error: uploadError } = await getSupabase()
    .storage.from(CLOUD_CONFIG.igcBucket)
    .upload(objectPath, igc.content, {
      contentType: 'application/vnd.fai.igc',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  guard();
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

  guard();
  await markFlightIgcPushed({ flightId: flight.id, sha256, objectPath, pushedAt: Date.now() });
}

async function pushFlights(userId: string, now: number, ignoreBackoff: boolean, guard: () => void): Promise<unknown[]> {
  const failures: unknown[] = [];
  const flights = await listDirtyFlights(CLOUD_CONFIG.pushBatchSize, now, { ignoreBackoff, ownerUserId: userId });
  for (const flight of flights) {
    try {
      guard();
      if (flight.cloudOwnerUserId && flight.cloudOwnerUserId !== userId) continue;
      await markFlightCloudOwner(flight.id, userId);
      guard();
      const { data, error } = await getSupabase().rpc('write_private_flight', {
        p_flight: flightRow(flight, userId, Platform.OS), p_metadata_only: false,
      });
      if (error) throw error;
      guard();
      const canonical = Array.isArray(data) ? data[0] : data;
      if (!canonical || canonical.id !== flight.id || canonical.user_id !== userId) throw new Error('The flight backup could not be verified.');
      await mergeRemoteFlight(userId, canonical, guard, flight.updatedAt);

      if (!await getFlightDetail(flight.id)) continue;
      // Only acknowledge the flight after its required IGC has reached the server.
      // An upload failure must leave the flight pending for the next attempt.
      await pushIgc(flight, userId, guard);
      guard();

      await markFlightPushed({
        flightId: flight.id,
        // mergeRemoteFlight already acknowledges an applied canonical revision.
        // Otherwise acknowledge only the dispatched edit, preserving a newer local edit.
        pushedUpdatedAt: Math.min(flight.updatedAt, canonical.client_updated_at),
        remoteUpdatedAt: canonical.updated_at,
      });
    } catch (error) {
      guard();
      const kind = classifySyncError(error);
      if (kind === 'reauth') throw error;
      if (!await getFlightDetail(flight.id)) continue;
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

async function pullProfile(userId: string, guard: () => void): Promise<void> {
  guard();
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('pilot_name, glider_type, glider_id, registration_id, client_updated_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  guard();
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

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

class StaleSyncError extends Error {}
let environment: RestoreEnvironment = { ...INITIAL_RESTORE_ENVIRONMENT };
let activeOwner: string | null | undefined;
let activeAuthStatus: string | undefined;
let authGeneration = 0;
let inFlightGeneration = -1;
let environmentRevision = 0;
let inFlightEnvironmentRevision = -1;
let mutationRevision = 0;
let inFlightMutationRevision = -1;
let authTransition: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let throttleRetryAt = 0;
const restore = new RestoreTransfer({
  list: (owner) => archiveRepository.listPendingDownloads(owner, Number.MAX_SAFE_INTEGER),
  counts: async (owner) => {
    const flights = await archiveRepository.list(owner);
    return { total: flights.filter((flight) => flight.archive.trackState !== 'missing').length,
      completed: flights.filter((flight) => flight.archive.trackState === 'ready').length };
  },
  begin: (owner, id) => archiveRepository.markDownloadStarted(owner, id),
  commit: async (candidate, bytes, shouldCommit) => {
    const saved = await archiveRepository.storeVerifiedIgc(candidate.ownerUserId, candidate.flightId, candidate.sha256, bytes, candidate.artifactVersion, shouldCommit);
    if (!saved) throw new Error('The backup changed while downloading. Retry to refresh it.');
  },
  fail: (owner, id, error) => archiveRepository.recordDownloadFailure(owner, id, error),
  download: downloadArchiveIgc,
  getPaused: (owner) => archiveRepository.getRestorePaused(owner),
  setPaused: (owner, paused) => archiveRepository.setRestorePaused(owner, paused),
  changed: (flightId, artifactChanged) => notifyJournal({ kind: artifactChanged ? 'artifact' : 'metadata', flightId }),
  publish: (value) => publish({ restore: value }),
});

function eligible(): boolean {
  return environment.foreground && environment.recorderReady && !environment.recorderBusy &&
    environment.network !== 'offline' && environment.network !== 'unknown';
}
function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const retryAt = Math.max(cycleNextAttemptAt, throttleRetryAt);
  if (!eligible() || !activeOwner || retryAt <= 0) return;
  const generation = authGeneration;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void (async () => {
      // A slow transfer can outlast the deadline. Do not absorb the timer into
      // that cycle after its outgoing queues have already been read.
      if (inFlight) await inFlight;
      if (generation !== authGeneration || !eligible() || !activeOwner) return;
      const deadline = Math.max(cycleNextAttemptAt, throttleRetryAt);
      if (deadline <= 0) return;
      if (deadline > Date.now()) { scheduleRetry(); return; }
      await cloudSyncEngine.requestSync('foreground');
    })();
  }, Math.max(1, retryAt - Date.now()));
}
function authChanged(): Promise<void> {
  const auth = cloudAuthService.getSnapshot();
  const next = auth.status === 'signed_in' ? auth.userId : null;
  if (activeOwner === next && activeAuthStatus === auth.status) return authTransition ?? Promise.resolve();
  activeOwner = next;
  activeAuthStatus = auth.status;
  const generation = ++authGeneration;
  cycleAttemptCount = 0;
  cycleNextAttemptAt = 0;
  throttleRetryAt = 0;
  mutationRevision = 0;
  scheduleRetry();
  if (next || auth.status === 'restoring') setJournalOwner(next);
  publish({ phase: 'idle', lastError: null, cloudOnlyFlights: 0, pendingFlights: 0, pendingDeletions: 0 });
  const initialization = (async () => {
    await restore.setOwner(next);
    if (generation !== authGeneration) return;
    if (next) await archiveRepository.rememberOwner(next);
    else if (auth.status !== 'restoring') {
      const previous = await archiveRepository.getLastOwner();
      if (generation === authGeneration) setJournalOwner(previous);
    }
  })();
  const transition = initialization.catch((error) => {
    if (generation === authGeneration) activeAuthStatus = undefined;
    throw error;
  }).finally(() => { if (authTransition === transition) authTransition = null; });
  authTransition = transition;
  return transition;
}

async function runCycle(trigger: SyncTrigger, recorderRecovering: boolean): Promise<SyncSnapshot> {
  const now = Date.now();
  const auth = cloudAuthService.getSnapshot();
  const generation = authGeneration;
  const userId = auth.status === 'signed_in' ? auth.userId : null;
  const current = () => generation === authGeneration && activeOwner === userId;
  const guard = () => {
    if (!current() || !environment.foreground || environment.recorderBusy || !environment.recorderReady) throw new StaleSyncError();
  };
  const link = await getCloudLink();
  if (!current()) return snapshot;
  publish({ linkedUserId: link.userId, lastSyncAt: link.lastSyncAt, lastError: link.lastSyncError });
  const unfinished = await getUnfinishedSession();
  if (!current()) return snapshot;
  const gate = evaluateSyncGate({
    configured: cloudConfigured, authStatus: auth.status, sessionUserId: userId,
    linkedUserId: link.userId, recorderRecovering: recorderRecovering || !environment.recorderReady,
    unfinishedSessionStatus: unfinished?.status === 'recording' || unfinished?.status === 'interrupted' ? unfinished.status : null,
    now, lastSyncAt: link.lastSyncAt, nextAttemptAt: cycleNextAttemptAt, trigger,
  });
  if (!userId || !environment.foreground || environment.recorderBusy || (!gate.run && !['account_mismatch', 'throttled', 'backoff'].includes(gate.reason))) {
    await refreshCounts();
    if (!current()) return snapshot;
    return publish({ phase: 'blocked', blockedBy: gate.run ? 'recording' : gate.reason });
  }
  try {
    guard();
    if (!gate.run && (gate.reason === 'throttled' || gate.reason === 'backoff')) {
      await refreshCounts();
      guard();
      if (gate.reason === 'throttled') {
        throttleRetryAt = snapshot.pendingFlights + snapshot.pendingDeletions > 0
          ? link.lastSyncAt! + CLOUD_CONFIG.minimumSyncIntervalMs : 0;
      }
      await restore.run(current);
      guard();
      scheduleRetry();
      return publish({ phase: 'blocked', blockedBy: gate.reason });
    }
    throttleRetryAt = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    publish({ phase: 'syncing', blockedBy: null, lastError: null });
    if (gate.run && gate.bindTo) await bindCloudLink(gate.bindTo, now);
    const ignoreBackoff = trigger === 'manual';
    const failures: unknown[] = [];
    // Owner archive queues do not require rebinding the captured logbook.
    failures.push(...await pushArchiveChanges(userId, guard, ignoreBackoff));
    if (gate.run) failures.push(...await pushDeletions(userId, now, ignoreBackoff, guard));
    failures.push(...await pullFlightDeletions(userId, guard));
    await pullArchiveCatalogue(userId, guard, true);
    if (gate.run) {
      await pullProfile(userId, guard);
      await pushProfile(userId, guard);
      failures.push(...await pushFlights(userId, now, ignoreBackoff, guard));
    }
    failures.push(...await pullFlightDeletions(userId, guard));
    await pullArchiveCatalogue(userId, guard);
    guard();
    await restore.run(current);
    guard();
    cycleAttemptCount = 0;
    cycleNextAttemptAt = 0;
    if (gate.run && failures.length === 0) await setCloudCursors({ lastSyncAt: now, lastSyncError: null });
    await refreshCounts();
    guard();
    if (gate.run && failures.length === 0 && snapshot.pendingFlights + snapshot.pendingDeletions > 0) {
      throttleRetryAt = now + CLOUD_CONFIG.minimumSyncIntervalMs;
    }
    scheduleRetry();
    const archives = await archiveRepository.list(userId);
    guard();
    publish({ cloudOnlyFlights: archives.length });
    notifyJournal({ kind: 'metadata' });
    if (failures.length) throw failures[0];
    return publish({ phase: gate.run ? 'idle' : 'blocked', blockedBy: gate.run ? null : 'account_mismatch',
      ...(gate.run ? { lastSyncAt: now } : {}), lastError: null });
  } catch (error) {
    if (error instanceof StaleSyncError || !current()) return snapshot;
    const kind = classifySyncError(error);
    if (kind === 'reauth' && current()) await cloudAuthService.signOut().catch(() => undefined);
    if (!current()) return snapshot;
    const backoff = nextBackoff(cycleAttemptCount, now, Math.random);
    cycleAttemptCount = backoff.attemptCount;
    cycleNextAttemptAt = backoff.nextAttemptAt;
    scheduleRetry();
    await setCloudCursors({ lastSyncError: messageOf(error) }).catch(() => undefined);
    await refreshCounts();
    if (!current()) return snapshot;
    return publish({ phase: 'error', lastError: messageOf(error) });
  }
}

export const cloudSyncEngine: CloudSyncEngine = {
  getSnapshot: () => snapshot,
  authChanged,
  setEnvironment(patch) {
    const wasEligible = eligible();
    const changed = Object.entries(patch).some(([key, value]) => environment[key as keyof RestoreEnvironment] !== value);
    environment = { ...environment, ...patch };
    if (changed) environmentRevision += 1;
    restore.setEnvironment(patch);
    scheduleRetry();
    if (activeOwner && eligible() && (!wasEligible || (changed && patch.network !== undefined))) {
      void cloudSyncEngine.requestSync('foreground');
    }
  },
  pauseRestore: () => { void restore.pause().catch((error) => publish({ lastError: messageOf(error) })); },
  resumeRestore: (options) => { void restore.resume(options.allowMobileData).then(() => cloudSyncEngine.requestSync('manual')).catch((error) => publish({ lastError: messageOf(error) })); },
  retryRestore: (options) => { void restore.resume(options.allowMobileData).then(() => cloudSyncEngine.requestSync('manual')).catch((error) => publish({ lastError: messageOf(error) })); },
  rebindTo: async (userId) => {
    await resetCloudLink(userId);
    publish({ blockedBy: null, lastError: null, cloudOnlyFlights: 0, linkedUserId: userId });
    await refreshCounts();
  },
  requestSync: async (trigger, options) => {
    if (!cloudConfigured) return snapshot;
    let initializationGeneration = authGeneration;
    try {
      const initialization = authChanged();
      initializationGeneration = authGeneration;
      await initialization;
    } catch (error) {
      return initializationGeneration === authGeneration ? publish({ phase: 'error', lastError: messageOf(error) }) : snapshot;
    }
    const requestedGeneration = authGeneration;
    const requestedMutationRevision = trigger === 'post-save' ? ++mutationRevision : mutationRevision;
    if (trigger === 'post-save') void refreshCounts();
    let nextTrigger = trigger;
    if (inFlight) {
      const joinedGeneration = inFlightGeneration;
      const joinedEnvironmentRevision = inFlightEnvironmentRevision;
      const joinedMutationRevision = inFlightMutationRevision;
      const result = await inFlight;
      if (requestedGeneration !== authGeneration) return snapshot;
      const changedDuringCycle = requestedMutationRevision > joinedMutationRevision;
      if (joinedGeneration === requestedGeneration && trigger !== 'manual' &&
          joinedEnvironmentRevision === environmentRevision && !changedDuringCycle) return result;
      if (changedDuringCycle && trigger !== 'manual') nextTrigger = 'post-save';
    }
    if (!inFlight) {
      inFlightGeneration = authGeneration;
      inFlightEnvironmentRevision = environmentRevision;
      inFlightMutationRevision = mutationRevision;
      inFlight = runCycle(nextTrigger, options?.recorderRecovering ?? false)
        .catch((error) => requestedGeneration === authGeneration ? publish({ phase: 'error', lastError: messageOf(error) }) : snapshot)
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  },
  subscribe: (listener) => {
    listeners.add(listener);
    listener(snapshot);
    void refreshCounts();
    return () => { listeners.delete(listener); };
  },
};

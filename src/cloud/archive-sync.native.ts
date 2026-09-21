import { archiveRepository } from '@/archives/repository';
import type { ArchiveRemoteFlight } from '@/archives/types';
import { applyRemoteFlightMetadata, deleteCompletedFlight, getFlightDetail, markFlightCloudOwner } from '@/recorder/database.native';
import { notifyJournal } from '@/journal/context';
import { getSupabase } from './supabase';
import { CLOUD_CONFIG } from './config';
import { catalogueContinuation } from './restore-plan';
import { nextBackoff } from './sync-plan';

type Guard = () => void;
const message = (error: unknown) => error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);

export async function cleanDeletedArtifact(flightId: string, objectPath: string, guard: Guard): Promise<void> {
  guard();
  const { error } = await getSupabase().storage.from(CLOUD_CONFIG.igcBucket).remove([objectPath]);
  guard();
  const { data, error: acknowledgement } = await getSupabase().rpc('acknowledge_private_flight_cleanup', {
    p_flight_id: flightId, ...(error ? { p_error: error.message } : {}),
  });
  if (error) throw error;
  if (acknowledgement) throw acknowledgement;
  guard();
  const receipt = Array.isArray(data) ? data[0] : data;
  if (!receipt || receipt.flight_id !== flightId || receipt.storage_object_path !== objectPath || receipt.storage_cleanup_pending) {
    throw new Error(receipt?.storage_cleanup_last_error ?? 'The archived file cleanup could not be verified. Retry synchronization.');
  }
}

export async function deleteRemoteFlight(owner: string, flightId: string, guard: Guard): Promise<void> {
  guard();
  const { data, error } = await getSupabase().rpc('delete_private_flight', { p_flight_id: flightId });
  if (error) throw error;
  guard();
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.user_id !== owner || row.flight_id !== flightId) throw new Error('The flight deletion could not be verified.');
  await applyDeletion(owner, flightId, row.recording_session_id, row.deleted_at);
  notifyJournal({ kind: 'delete', flightId });
  await cleanDeletedArtifact(flightId, row.storage_object_path, guard);
}

/** Explicit markers are the sole remote authority to remove a recorded flight. */
export async function pullFlightDeletions(owner: string, guard: Guard): Promise<unknown[]> {
  let after: string | null = null;
  const failures: unknown[] = [];
  do {
    guard();
    let query = getSupabase().from('private_flight_deletions').select('*').eq('user_id', owner)
      .order('flight_id', { ascending: true }).limit(CLOUD_CONFIG.pullPageSize);
    if (after) query = query.gt('flight_id', after);
    const { data, error } = await query;
    if (error) throw error;
    guard();
    for (const row of data ?? []) {
      guard();
      if (row.user_id !== owner) throw new Error('The deletion belongs to another account.');
      await applyDeletion(owner, row.flight_id, row.recording_session_id, row.deleted_at);
      notifyJournal({ kind: 'delete', flightId: row.flight_id });
      if (row.storage_cleanup_pending) {
        try { await cleanDeletedArtifact(row.flight_id, row.storage_object_path, guard); }
        catch (error) { guard(); failures.push(error); }
      }
    }
    if (!data || data.length < CLOUD_CONFIG.pullPageSize) break;
    after = data[data.length - 1]!.flight_id;
  } while (true);
  return failures;
}

/** Page checkpoints and queued downloads commit together before a cursor can advance. */
export async function pullArchiveCatalogue(owner: string, guard: Guard, full = false): Promise<void> {
  let cursor = full ? null : await archiveRepository.getCursor(owner);
  do {
    guard();
    let query = getSupabase().from('flights').select('*').eq('user_id', owner)
      .order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(CLOUD_CONFIG.pullPageSize);
    if (cursor) query = query.or(catalogueContinuation({ updatedAt: cursor.updatedAt, id: cursor.flightId }));
    const { data, error } = await query;
    if (error) throw error;
    guard();
    for (const row of data ?? []) {
      guard();
      await mergeRemoteFlight(owner, row, guard);
      guard();
      cursor = { updatedAt: row.updated_at, flightId: row.id };
      await archiveRepository.setCursor(owner, cursor);
    }
    if (data?.length) notifyJournal({ kind: 'metadata' });
    if (!data || data.length < CLOUD_CONFIG.pullPageSize) break;
  } while (true);
  notifyJournal({ kind: 'metadata' });
}

export async function mergeRemoteFlight(owner: string, row: ArchiveRemoteFlight, guard: Guard, expectedLocalUpdatedAt?: number): Promise<void> {
  guard();
  if (row.user_id !== owner) throw new Error('The backup belongs to another account.');
  const local = await getFlightDetail(row.id);
  guard();
  if (local) {
    if (local.recordingSessionId !== row.recording_session_id) throw new Error('A backup has a conflicting recording identity.');
    await markFlightCloudOwner(row.id, owner);
    await applyRemoteFlightMetadata({ flightId: row.id, title: row.title, site: row.site,
      siteSource: row.site_source === 'manual' || row.site_source === 'osm' || row.site_source === 'paraglidingearth' ? row.site_source : null, notes: row.notes, clientUpdatedAt: row.client_updated_at,
      expectedLocalUpdatedAt }, row.updated_at);
  } else {
    await archiveRepository.upsertRemote(owner, row);
  }
}

export async function pushArchiveChanges(owner: string, guard: Guard, ignoreBackoff: boolean): Promise<unknown[]> {
  const failures: unknown[] = [];
  const now = Date.now();
  for (const deletion of await archiveRepository.listPendingDeletions(owner, CLOUD_CONFIG.pushBatchSize, now, ignoreBackoff)) {
    try {
      await deleteRemoteFlight(owner, deletion.flightId, guard);
      await archiveRepository.acknowledgeDeletion(owner, deletion.flightId, deletion.deletedAt);
    } catch (error) {
      guard();
      const next = nextBackoff(deletion.attemptCount, now, Math.random);
      await archiveRepository.recordDeletionFailure(owner, deletion.flightId, message(error), next.nextAttemptAt);
      failures.push(error);
    }
  }
  for (const flight of await archiveRepository.listDirtyMetadata(owner, CLOUD_CONFIG.pushBatchSize, now, ignoreBackoff)) {
    try {
      guard();
      const { data, error } = await getSupabase().rpc('write_private_flight', { p_metadata_only: true, p_flight: {
        id: flight.id, title: flight.title, site: flight.site, site_source: flight.siteSource,
        notes: flight.notes, client_updated_at: flight.dirtyUpdatedAt,
      } });
      if (error) throw error;
      guard();
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.id !== flight.id || row.user_id !== owner) throw new Error('The saved flight update could not be verified.');
      await archiveRepository.upsertRemote(owner, row, flight.dirtyUpdatedAt);
      await archiveRepository.markMetadataPushed(owner, flight.id, flight.dirtyUpdatedAt, row.updated_at);
      notifyJournal({ kind: 'metadata', flightId: flight.id });
    } catch (error) {
      guard();
      const next = nextBackoff(0, now, Math.random);
      await archiveRepository.recordMetadataFailure(owner, flight.id, message(error), next.nextAttemptAt);
      failures.push(error);
    }
  }
  return failures;
}

async function applyDeletion(owner: string, flightId: string, sessionId: string | null, deletedAt: string): Promise<void> {
  await archiveRepository.applyRemoteDeletion(owner, flightId, sessionId, Date.parse(deletedAt));
  const local = await getFlightDetail(flightId);
  if (local && (!sessionId || local.recordingSessionId === sessionId)) {
    await deleteCompletedFlight(flightId, Date.parse(deletedAt), { remoteOwnerUserId: owner, ...(sessionId ? { recordingSessionId: sessionId } : {}) });
  }
}

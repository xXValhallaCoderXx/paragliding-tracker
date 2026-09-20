import { archiveRepository } from '@/archives/repository';
import { parseArchivedIgc } from '@/archives/igc';
import { getArchiveDatabase, getCloudLink, getFlightDetail } from '@/recorder/database.native';
import { REPLAY_FIXES_SQL } from '@/recorder/replay-repository-core';
import type { ReplayFix } from '@/lib/replay/model';
import type { SharedReplayArtifactV1 } from '@/social/feed-types';
import { publicationArtifact, recordedPublicationArtifact } from './publication-artifact';

export async function publicationSourceExists(owner: string, flightId: string): Promise<boolean> {
  const db = await getArchiveDatabase();
  if (await db.getFirstAsync(`SELECT 1 FROM archive_deletions WHERE owner_user_id = ? AND flight_id = ?
    UNION ALL SELECT 1 FROM flight_deletions WHERE owner_user_id = ? AND flight_id = ? LIMIT 1`, owner, flightId, owner, flightId)) return false;
  const captured = await getFlightDetail(flightId);
  if (captured) {
    const link = await getCloudLink();
    return ['completed', 'partial'].includes(captured.status) && !!captured.metrics && captured.sessionStatus === 'completed' &&
      (!captured.cloudOwnerUserId || captured.cloudOwnerUserId === owner) && (!link.userId || link.userId === owner);
  }
  const archive = await archiveRepository.get(owner, flightId);
  return !!archive && ['completed', 'partial'].includes(archive.status) && !!archive.metrics;
}

export async function publicationBackupReady(owner: string, flightId: string): Promise<boolean> {
  const db = await getArchiveDatabase();
  const captured = await db.getFirstAsync<{ cloud_owner_user_id: string | null; pushed_updated_at: number | null; updated_at: number }>(
    `SELECT f.cloud_owner_user_id, f.updated_at, s.pushed_updated_at FROM flights f LEFT JOIN flight_sync_state s ON s.flight_id = f.id WHERE f.id = ?`, flightId);
  if (captured) return captured.cloud_owner_user_id === owner && captured.pushed_updated_at !== null && captured.pushed_updated_at >= captured.updated_at;
  return !!await archiveRepository.get(owner, flightId);
}

export async function buildPublicationArtifact(owner: string, flightId: string): Promise<SharedReplayArtifactV1> {
  if (!await publicationSourceExists(owner, flightId)) throw new Error('This saved flight is no longer available for this account.');
  const captured = await getFlightDetail(flightId);
  if (captured) {
    const endedAt = captured.session.endedAt === null ? null : Math.min(captured.session.endedAt, captured.session.manualStopAt ?? captured.session.endedAt);
    if (endedAt === null) throw new Error('Save the flight before sharing it.');
    const bounds = { startedAt: captured.session.startedAt, endedAt };
    const db = await getArchiveDatabase();
    const fixes = await db.getAllAsync<Omit<ReplayFix, 'mocked'> & { mocked: number }>(REPLAY_FIXES_SQL,
      captured.recordingSessionId, bounds.startedAt, bounds.endedAt);
    return recordedPublicationArtifact(fixes.map(fix => ({ ...fix, mocked: fix.mocked !== 0 })), bounds, captured.status === 'partial');
  }
  const archive = await archiveRepository.get(owner, flightId);
  if (!archive || archive.endedAt === null) throw new Error('This archived flight is unavailable.');
  const bounds = { startedAt: archive.startedAt, endedAt: archive.endedAt };
  const bytes = await archiveRepository.readIgc(owner, flightId);
  if (!bytes) {
    // A known no-track summary can still be shared honestly. A route waiting for
    // download must not be quietly converted to a no-track publication.
    if (archive.archive.trackState !== 'missing' || (archive.metrics?.fixCount ?? 0) > 0) {
      throw new Error('Download this flight’s archived route before sharing it.');
    }
    return publicationArtifact([], bounds, archive.status === 'partial', 'igc');
  }
  const parsed = parseArchivedIgc(bytes, bounds);
  // The original IGC writer truncates milliseconds. Its replay extent is distinct
  // from the exact summary times; never reject a valid first sample for that loss.
  return publicationArtifact(parsed.points, parsed.bounds ?? bounds, archive.status === 'partial', 'igc');
}

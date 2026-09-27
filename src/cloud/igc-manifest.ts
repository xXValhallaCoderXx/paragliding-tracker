import type { ArchiveDownloadCandidate, ArchiveRemoteFlight } from '@/archives/types';
import { MAX_ARCHIVE_IGC_BYTES } from '@/archives/types';

/** Incomplete or foreign references must not cause a historical artifact to be replaced. */
export function existingIgcManifest(row: ArchiveRemoteFlight, owner: string): ArchiveDownloadCandidate | null {
  const fields = [row.igc_object_path, row.igc_sha256, row.igc_byte_count, row.igc_artifact_version];
  if (fields.every(value => value === null || value === undefined)) return null;
  if (row.user_id !== owner || row.igc_object_path !== `${owner}/${row.id}.igc` ||
      !/^[a-f0-9]{64}$/i.test(row.igc_sha256 ?? '') ||
      !Number.isSafeInteger(row.igc_byte_count) || row.igc_byte_count! <= 0 || row.igc_byte_count! > MAX_ARCHIVE_IGC_BYTES ||
      !Number.isSafeInteger(row.igc_artifact_version) || row.igc_artifact_version! <= 0) {
    throw new Error('The existing track backup needs recovery. Retry backup to verify its original file.');
  }
  return {
    ownerUserId: owner, flightId: row.id, recordingSessionId: row.recording_session_id,
    title: row.title, startedAt: row.started_at, endedAt: row.ended_at ?? row.started_at,
    objectPath: row.igc_object_path, sha256: row.igc_sha256!, byteCount: row.igc_byte_count!,
    artifactVersion: row.igc_artifact_version!, attemptCount: 0,
  };
}

import type { Tables } from '../cloud/database.types';
import type { ArchivedFlightSummary } from '../recorder/types';
import type { SqlExecutor } from '../recorder/repository-core';

export const MAX_ARCHIVE_IGC_BYTES = 25 * 1024 * 1024;
export const ARCHIVE_FREE_SPACE_RESERVE = 512 * 1024 * 1024;

export type ArchiveRemoteFlight = Tables<'flights'> & { deleted_at?: string | null; site_source?: string | null };
export interface ArchiveCursor { updatedAt: string; flightId: string }
export interface ArchiveDownloadCandidate {
  ownerUserId: string;
  flightId: string;
  recordingSessionId: string;
  title: string | null;
  startedAt: number;
  endedAt: number;
  objectPath: string;
  sha256: string;
  byteCount: number;
  artifactVersion: number;
  attemptCount: number;
}
export interface ArchiveMetadataCandidate extends ArchivedFlightSummary { dirtyUpdatedAt: number }
export interface ArchiveDeletion {
  ownerUserId: string;
  flightId: string;
  recordingSessionId: string | null;
  deletedAt: number;
  attemptCount: number;
  nextAttemptAt: number;
  lastError: string | null;
}
export interface ArchiveSqlExecutor extends SqlExecutor {
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
}
export interface ArchiveDatabaseAccess {
  read<T>(operation: (database: ArchiveSqlExecutor) => Promise<T>): Promise<T>;
  write<T>(operation: (transaction: ArchiveSqlExecutor) => Promise<T>): Promise<T>;
}

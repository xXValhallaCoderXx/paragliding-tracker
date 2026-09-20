import type { ArchiveDatabaseAccess, ArchiveSqlExecutor } from '@/archives/types';
import type { PublicationMode, SharingPreferences } from '../social/feed-types';

export interface CaptureSharingStamp { ownerUserId: string; generation: string; operationId: string }
export interface PublicationIntent {
  ownerUserId: string; flightId: string; operationId: string; mode: PublicationMode;
  action: 'share' | 'hide'; consentGeneration: string | null; expectedRevision: number;
  state: 'pending' | 'shared' | 'hidden' | 'cancelled'; activityId: string | null;
  attemptCount: number; nextAttemptAt: number; error: string | null;
}
interface IntentRow {
  owner_user_id: string; flight_id: string; operation_id: string; mode: PublicationMode; action: 'share' | 'hide';
  consent_generation: string | null; expected_revision: number; state: PublicationIntent['state'];
  activity_id: string | null; attempt_count: number; next_attempt_at: number; last_error: string | null;
}
function intent(row: IntentRow): PublicationIntent {
  return { ownerUserId: row.owner_user_id, flightId: row.flight_id, operationId: row.operation_id, mode: row.mode,
    action: row.action, consentGeneration: row.consent_generation, expectedRevision: row.expected_revision,
    state: row.state, activityId: row.activity_id, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, error: row.last_error };
}

export const PUBLICATION_SCHEMA_SQL = `
  CREATE TABLE social_sharing_preferences (
    owner_user_id TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), generation TEXT
  );
  CREATE TABLE social_capture_stamps (
    flight_id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, consent_generation TEXT NOT NULL,
    operation_id TEXT NOT NULL, captured_at INTEGER NOT NULL
  );
  CREATE TABLE social_publication_intents (
    owner_user_id TEXT NOT NULL, flight_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('automatic','manual')), action TEXT NOT NULL CHECK (action IN ('share','hide')),
    consent_generation TEXT, expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
    state TEXT NOT NULL CHECK (state IN ('pending','shared','hidden','cancelled')),
    activity_id TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (owner_user_id, flight_id)
  );
  CREATE INDEX social_publication_retry_order ON social_publication_intents (owner_user_id, state, next_attempt_at, flight_id);
`;
export const PUBLICATION_COLUMNS = {
  social_sharing_preferences: ['owner_user_id', 'enabled', 'generation'],
  social_capture_stamps: ['flight_id', 'owner_user_id', 'consent_generation', 'operation_id', 'captured_at'],
  social_publication_intents: ['owner_user_id', 'flight_id', 'operation_id', 'mode', 'action', 'consent_generation',
    'expected_revision', 'state', 'activity_id', 'attempt_count', 'next_attempt_at', 'last_error', 'updated_at'],
} as const;

/** Called only by createSession, inside the same transaction as the new recording. */
export async function stampCapture(transaction: ArchiveSqlExecutor, flightId: string, stamp: CaptureSharingStamp, capturedAt: number): Promise<void> {
  await transaction.runAsync(`INSERT INTO social_capture_stamps (flight_id, owner_user_id, consent_generation, operation_id, captured_at)
    SELECT ?, owner_user_id, generation, ?, ? FROM social_sharing_preferences
    WHERE owner_user_id = ? AND enabled = 1 AND generation = ?`,
  flightId, stamp.operationId, capturedAt, stamp.ownerUserId, stamp.generation);
}
/** Finalization is idempotent; existing hidden/cancelled/shared rows are never requeued. */
export async function enqueueFinalizedPublication(transaction: ArchiveSqlExecutor, flightId: string, now: number): Promise<void> {
  await transaction.runAsync(`INSERT OR IGNORE INTO social_publication_intents
    (owner_user_id, flight_id, operation_id, mode, action, consent_generation, expected_revision, state, updated_at)
    SELECT s.owner_user_id, f.id, s.operation_id, 'automatic', 'share', s.consent_generation, 0, 'pending', ?
    FROM social_capture_stamps s JOIN flights f ON f.id = s.flight_id JOIN flight_metrics m ON m.flight_id = f.id
    JOIN social_sharing_preferences p ON p.owner_user_id = s.owner_user_id
    WHERE f.id = ? AND f.status IN ('completed','partial') AND f.ended_at IS NOT NULL
      AND p.enabled = 1 AND p.generation = s.consent_generation
      AND (f.cloud_owner_user_id IS NULL OR f.cloud_owner_user_id = s.owner_user_id)`, now, flightId);
}
export async function cancelDeletedPublication(transaction: ArchiveSqlExecutor, flightId: string, now: number): Promise<void> {
  await transaction.runAsync(`UPDATE social_publication_intents SET state = 'cancelled', last_error = NULL, updated_at = ? WHERE flight_id = ?`, now, flightId);
  await transaction.runAsync('DELETE FROM social_capture_stamps WHERE flight_id = ?', flightId);
}

export class PublicationRepository {
  constructor(private readonly database: ArchiveDatabaseAccess, private readonly now = Date.now) {}
  getPreferences(owner: string): Promise<SharingPreferences | null> {
    return this.database.read(async db => {
      const row = await db.getFirstAsync<{ enabled: number; generation: string | null }>('SELECT enabled, generation FROM social_sharing_preferences WHERE owner_user_id = ?', owner);
      return row ? { enabled: row.enabled === 1, generation: row.generation } : null;
    });
  }
  setPreferences(owner: string, preferences: SharingPreferences, guard: () => void = () => undefined): Promise<void> {
    return this.database.write(async db => {
      guard();
      await db.runAsync(`INSERT INTO social_sharing_preferences (owner_user_id, enabled, generation) VALUES (?, ?, ?)
        ON CONFLICT(owner_user_id) DO UPDATE SET enabled = excluded.enabled, generation = excluded.generation`, owner, preferences.enabled ? 1 : 0, preferences.generation);
      // Even re-enabling later cannot resurrect intents stamped with an older consent.
      await db.runAsync(`UPDATE social_publication_intents SET state = 'cancelled', last_error = NULL, updated_at = ?
        WHERE owner_user_id = ? AND mode = 'automatic' AND action = 'share' AND state = 'pending'
        AND (? = 0 OR ? IS NULL OR consent_generation <> ?)`, this.now(), owner, preferences.enabled ? 1 : 0, preferences.generation, preferences.generation);
      guard();
    });
  }
  get(owner: string, flightId: string): Promise<PublicationIntent | null> {
    return this.database.read(async db => {
      const row = await db.getFirstAsync<IntentRow>('SELECT * FROM social_publication_intents WHERE owner_user_id = ? AND flight_id = ?', owner, flightId);
      return row ? intent(row) : null;
    });
  }
  listPending(owner: string, now = this.now()): Promise<PublicationIntent[]> {
    return this.database.read(async db => (await db.getAllAsync<IntentRow>(`SELECT * FROM social_publication_intents
      WHERE owner_user_id = ? AND state = 'pending' AND next_attempt_at <= ? ORDER BY updated_at, flight_id LIMIT 25`, owner, now)).map(intent));
  }
  nextAttempt(owner: string): Promise<number | null> {
    return this.database.read(async db => (await db.getFirstAsync<{ time: number | null }>(`SELECT MIN(next_attempt_at) AS time
      FROM social_publication_intents WHERE owner_user_id = ? AND state = 'pending'`, owner))?.time ?? null);
  }
  queueManual(owner: string, flightId: string, operationId: string, expectedRevision: number, guard: () => void = () => undefined): Promise<void> {
    return this.database.write(async db => {
      guard();
      // A new explicit action may override a prior hide. Retry never calls this.
      await db.runAsync(`INSERT INTO social_publication_intents
        (owner_user_id, flight_id, operation_id, mode, action, consent_generation, expected_revision, state, updated_at)
        VALUES (?, ?, ?, 'manual', 'share', NULL, ?, 'pending', ?)
        ON CONFLICT(owner_user_id, flight_id) DO UPDATE SET operation_id = excluded.operation_id, mode = 'manual', action = 'share',
          consent_generation = NULL, expected_revision = excluded.expected_revision, state = 'pending',
          attempt_count = 0, next_attempt_at = 0, last_error = NULL, updated_at = excluded.updated_at`,
      owner, flightId, operationId, expectedRevision, this.now());
      guard();
    });
  }
  queueHide(owner: string, flightId: string, operationId: string, guard: () => void = () => undefined): Promise<void> {
    return this.database.write(async db => {
      guard();
      await db.runAsync(`INSERT INTO social_publication_intents
        (owner_user_id, flight_id, operation_id, mode, action, expected_revision, state, updated_at)
        VALUES (?, ?, ?, 'manual', 'hide', 0, 'pending', ?)
        ON CONFLICT(owner_user_id, flight_id) DO UPDATE SET operation_id = excluded.operation_id, action = 'hide', mode = 'manual',
          state = 'pending', attempt_count = 0, next_attempt_at = 0, last_error = NULL, updated_at = excluded.updated_at`,
      owner, flightId, operationId, this.now());
      guard();
    });
  }
  acknowledge(candidate: PublicationIntent, state: 'shared' | 'hidden', activityId: string | null): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE social_publication_intents SET state = ?, activity_id = ?, last_error = NULL,
      next_attempt_at = 0, updated_at = ? WHERE owner_user_id = ? AND flight_id = ? AND operation_id = ? AND state = 'pending'`,
    state, activityId, this.now(), candidate.ownerUserId, candidate.flightId, candidate.operationId); });
  }
  fail(candidate: PublicationIntent, message: string, retryAt: number): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE social_publication_intents SET attempt_count = attempt_count + 1,
      next_attempt_at = ?, last_error = ?, updated_at = ? WHERE owner_user_id = ? AND flight_id = ? AND operation_id = ? AND state = 'pending'`,
    retryAt, message, this.now(), candidate.ownerUserId, candidate.flightId, candidate.operationId); });
  }
  defer(candidate: PublicationIntent, retryAt: number): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE social_publication_intents SET next_attempt_at = ?
      WHERE owner_user_id = ? AND flight_id = ? AND operation_id = ? AND state = 'pending'`,
    retryAt, candidate.ownerUserId, candidate.flightId, candidate.operationId); });
  }
  retry(owner: string, flightId: string, guard: () => void = () => undefined): Promise<void> {
    return this.database.write(async db => { guard(); await db.runAsync(`UPDATE social_publication_intents SET next_attempt_at = 0, last_error = NULL
      WHERE owner_user_id = ? AND flight_id = ? AND state = 'pending'`, owner, flightId); guard(); });
  }
  cancel(candidate: PublicationIntent): Promise<void> {
    return this.database.write(async db => { await db.runAsync(`UPDATE social_publication_intents SET state = 'cancelled', last_error = NULL, updated_at = ?
      WHERE owner_user_id = ? AND flight_id = ? AND operation_id = ?`, this.now(), candidate.ownerUserId, candidate.flightId, candidate.operationId); });
  }
}

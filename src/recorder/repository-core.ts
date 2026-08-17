import type {
  BeginSessionRecoveryAttemptInput,
  PendingSessionRecoveryAttempt,
  SessionRecord,
  SessionRecoveryAttempt,
  SessionRecoveryKind,
  SessionRecoveryProof,
} from './types';

export interface SqlRunResult {
  changes: number;
}

export interface SqlExecutor {
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  runAsync(source: string, ...params: unknown[]): Promise<SqlRunResult>;
}

export interface TransactionalDatabase {
  withExclusiveTransactionAsync(task: (transaction: SqlExecutor) => Promise<void>): Promise<void>;
}

const SESSION_RECOVERY_ATTEMPT_COLUMNS = `
  attempt.id AS attempt_id,
  attempt.session_id,
  attempt.kind,
  attempt.attempt_started_at,
  attempt.deadline_at,
  attempt.maximum_cached_fix_age_ms,
  attempt.baseline_location_sequence,
  proof.sequence AS proving_fix_sequence,
  proof.source_timestamp AS proving_fix_source_at,
  proof.receipt_timestamp AS proving_fix_receipt_at`;

const SESSION_RECOVERY_ATTEMPT_PROOF_JOIN = `LEFT JOIN location_fixes proof
  ON proof.id = (
    SELECT candidate.id
    FROM location_fixes candidate
    WHERE candidate.session_id = attempt.session_id
      AND candidate.mocked = 0
      AND candidate.sequence > attempt.baseline_location_sequence
      AND candidate.receipt_timestamp >= attempt.attempt_started_at
      AND candidate.receipt_timestamp <= attempt.deadline_at
      AND candidate.source_timestamp >=
        attempt.attempt_started_at - attempt.maximum_cached_fix_age_ms
    ORDER BY candidate.receipt_timestamp ASC, candidate.sequence ASC
    LIMIT 1
  )`;

export const PENDING_SESSION_RECOVERY_ATTEMPT_SQL = `SELECT${SESSION_RECOVERY_ATTEMPT_COLUMNS}
FROM session_recovery_attempts attempt
${SESSION_RECOVERY_ATTEMPT_PROOF_JOIN}
WHERE attempt.session_id = ? AND attempt.completed_at IS NULL
ORDER BY attempt.attempt_started_at DESC, attempt.id DESC
LIMIT 1`;

export const SESSION_RECOVERY_ATTEMPT_BY_ID_SQL = `SELECT${SESSION_RECOVERY_ATTEMPT_COLUMNS}
FROM session_recovery_attempts attempt
${SESSION_RECOVERY_ATTEMPT_PROOF_JOIN}
WHERE attempt.id = ? AND attempt.completed_at IS NULL
LIMIT 1`;

export interface SessionRecoveryAttemptProofRow {
  attempt_id: string;
  session_id: string;
  kind: SessionRecoveryKind;
  attempt_started_at: number;
  deadline_at: number;
  maximum_cached_fix_age_ms: number;
  baseline_location_sequence: number;
  proving_fix_sequence: number | null;
  proving_fix_source_at: number | null;
  proving_fix_receipt_at: number | null;
}

export function mapPendingSessionRecoveryAttemptRow(
  row: SessionRecoveryAttemptProofRow | null,
): PendingSessionRecoveryAttempt | null {
  if (!row) return null;
  if (row.kind !== 'automatic' && row.kind !== 'manual') {
    throw new Error(`Recovery attempt ${row.attempt_id} has an invalid kind.`);
  }
  const numericFields = [
    row.attempt_started_at,
    row.deadline_at,
    row.maximum_cached_fix_age_ms,
    row.baseline_location_sequence,
  ];
  if (numericFields.some((value) => !Number.isFinite(value))) {
    throw new Error(`Recovery attempt ${row.attempt_id} has invalid persisted fields.`);
  }
  const proofValues = [
    row.proving_fix_sequence,
    row.proving_fix_source_at,
    row.proving_fix_receipt_at,
  ];
  const hasNoProof = proofValues.every((value) => value === null);
  const hasCompleteProof = proofValues.every(
    (value) => typeof value === 'number' && Number.isFinite(value),
  );
  if (!hasNoProof && !hasCompleteProof) {
    throw new Error(`Recovery attempt ${row.attempt_id} has an incomplete proving fix.`);
  }
  return {
    attemptId: row.attempt_id,
    sessionId: row.session_id,
    kind: row.kind,
    attemptStartedAt: row.attempt_started_at,
    deadlineAt: row.deadline_at,
    maximumCachedFixAgeMs: row.maximum_cached_fix_age_ms,
    baselineLocationSequence: row.baseline_location_sequence,
    provingFix: hasCompleteProof
      ? {
          sequence: row.proving_fix_sequence as number,
          sourceTimestamp: row.proving_fix_source_at as number,
          receiptTimestamp: row.proving_fix_receipt_at as number,
        }
      : null,
  };
}

export function resolveSessionCompletionTimestamp(
  startedAt: number,
  requestedEndedAt: number,
  manualStopAt: number | null,
  reason: 'stopped' | 'interrupted_finalized',
): number {
  if (!Number.isFinite(requestedEndedAt) || requestedEndedAt < startedAt) {
    throw new Error('Session completion time must be at or after the session start.');
  }
  if (manualStopAt === null) return requestedEndedAt;
  if (!Number.isFinite(manualStopAt) || manualStopAt < startedAt) {
    throw new Error('The stored manual stop boundary is invalid.');
  }
  if (reason !== 'stopped') {
    throw new Error('A pending manual stop must complete with reason stopped.');
  }
  return manualStopAt;
}

interface SessionStopRow {
  status: SessionRecord['status'];
  started_at: number;
  manual_stop_at: number | null;
}

function validateSessionBoundary(value: number, startedAt: number, label: string): void {
  if (!Number.isFinite(value) || value < startedAt) {
    throw new Error(`${label} must be a finite timestamp at or after the session start.`);
  }
}

export async function requestSessionStopTransaction(
  transaction: SqlExecutor,
  sessionId: string,
  stoppedAt: number,
): Promise<number> {
  const session = await transaction.getFirstAsync<SessionStopRow>(
    `SELECT status, started_at, manual_stop_at
     FROM sessions
     WHERE id = ?`,
    sessionId,
  );
  if (!session) throw new Error(`Session ${sessionId} was not found.`);
  validateSessionBoundary(stoppedAt, session.started_at, 'Manual stop boundary');

  if (session.manual_stop_at !== null) {
    validateSessionBoundary(session.manual_stop_at, session.started_at, 'Stored manual stop boundary');
    if (session.status !== 'interrupted') {
      throw new Error('A stored manual stop boundary requires an interrupted session.');
    }
    await transaction.runAsync(
      `UPDATE session_recovery_attempts
       SET completed_at = ?, outcome = 'stopped'
       WHERE session_id = ? AND completed_at IS NULL`,
      session.manual_stop_at,
      sessionId,
    );
    return session.manual_stop_at;
  }
  if (session.status !== 'recording' && session.status !== 'interrupted') {
    throw new Error('Only an unfinished session can request a manual stop.');
  }

  const result = await transaction.runAsync(
    `UPDATE sessions
     SET status = 'interrupted',
         manual_stop_at = ?,
         updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
     WHERE id = ? AND status IN ('recording', 'interrupted') AND manual_stop_at IS NULL`,
    stoppedAt,
    stoppedAt,
    stoppedAt,
    sessionId,
  );
  if (result.changes !== 1) throw new Error('The manual stop request raced another session change.');

  await transaction.runAsync(
    `UPDATE session_recovery_attempts
     SET completed_at = ?, outcome = 'stopped'
     WHERE session_id = ? AND completed_at IS NULL`,
    stoppedAt,
    sessionId,
  );

  await transaction.runAsync(
    `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
     VALUES (?, 'manual_stop_requested', ?, ?, ?)`,
    sessionId,
    stoppedAt,
    `manual-stop-requested:${sessionId}:${stoppedAt}`,
    JSON.stringify({ stoppedAt }),
  );
  return stoppedAt;
}

function validateRecoveryAttemptInput(input: BeginSessionRecoveryAttemptInput): void {
  if (!input.attemptId.trim()) throw new Error('Recovery attempt ID must not be blank.');
  if (!input.sessionId.trim()) throw new Error('Recovery session ID must not be blank.');
  if (input.kind !== 'automatic' && input.kind !== 'manual') {
    throw new Error(`Unsupported session recovery kind: ${String(input.kind)}.`);
  }
  if (!Number.isFinite(input.attemptStartedAt)) {
    throw new Error('Recovery attempt start must be a finite timestamp.');
  }
  if (!Number.isFinite(input.deadlineAt) || input.deadlineAt < input.attemptStartedAt) {
    throw new Error('Recovery deadline must be at or after the attempt start.');
  }
  if (
    !Number.isFinite(input.maximumCachedFixAgeMs) ||
    input.maximumCachedFixAgeMs < 0
  ) {
    throw new Error('Maximum cached fix age must be a non-negative finite duration.');
  }
}

export async function beginSessionRecoveryAttemptTransaction(
  transaction: SqlExecutor,
  input: BeginSessionRecoveryAttemptInput,
): Promise<SessionRecoveryAttempt> {
  validateRecoveryAttemptInput(input);
  const session = await transaction.getFirstAsync<{
    status: SessionRecord['status'];
    started_at: number;
    location_sequence: number;
    manual_stop_at: number | null;
  }>(
    `SELECT status, started_at, location_sequence, manual_stop_at
     FROM sessions
     WHERE id = ?`,
    input.sessionId,
  );
  if (!session) throw new Error(`Session ${input.sessionId} was not found.`);
  if (input.attemptStartedAt < session.started_at) {
    throw new Error('Recovery attempt cannot begin before the session start.');
  }
  if (session.manual_stop_at !== null) {
    throw new Error('A session with a pending manual stop cannot begin recovery.');
  }
  if (input.kind === 'manual' && session.status !== 'interrupted') {
    throw new Error('Manual recovery can only begin for an interrupted session.');
  }
  if (input.kind === 'automatic' && session.status !== 'recording') {
    throw new Error('Automatic recovery can only begin for a recording session.');
  }
  const pending = await transaction.getFirstAsync<SessionRecoveryAttemptProofRow>(
    PENDING_SESSION_RECOVERY_ATTEMPT_SQL,
    input.sessionId,
  );
  if (pending) throw new Error('This session already has an unmatched recovery attempt.');

  await transaction.runAsync(
    `UPDATE sessions
     SET status = 'recording',
         updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
     WHERE id = ?`,
    input.attemptStartedAt,
    input.attemptStartedAt,
    input.sessionId,
  );
  await transaction.runAsync(
    `INSERT INTO session_recovery_attempts (
       id, session_id, kind, attempt_started_at, deadline_at,
       maximum_cached_fix_age_ms, baseline_location_sequence
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.attemptId,
    input.sessionId,
    input.kind,
    input.attemptStartedAt,
    input.deadlineAt,
    input.maximumCachedFixAgeMs,
    session.location_sequence,
  );
  await transaction.runAsync(
    `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
     VALUES (?, 'recovery_attempt', ?, ?, ?)`,
    input.sessionId,
    input.attemptStartedAt,
    `recovery-attempt:${input.attemptId}`,
    JSON.stringify({
      attemptId: input.attemptId,
      kind: input.kind,
      attemptStartedAt: input.attemptStartedAt,
      deadlineAt: input.deadlineAt,
      maximumCachedFixAgeMs: input.maximumCachedFixAgeMs,
      baselineLocationSequence: session.location_sequence,
    }),
  );
  return { ...input, baselineLocationSequence: session.location_sequence };
}

export async function confirmSessionRecoveryAttemptTransaction(
  transaction: SqlExecutor,
  attemptId: string,
  occurredAt: number,
): Promise<SessionRecoveryProof> {
  if (!attemptId.trim()) throw new Error('Recovery attempt ID must not be blank.');
  const row = await transaction.getFirstAsync<SessionRecoveryAttemptProofRow>(
    SESSION_RECOVERY_ATTEMPT_BY_ID_SQL,
    attemptId,
  );
  const attempt = mapPendingSessionRecoveryAttemptRow(row);
  if (!attempt) throw new Error(`Pending recovery attempt ${attemptId} was not found.`);
  if (!Number.isFinite(occurredAt) || occurredAt < attempt.attemptStartedAt) {
    throw new Error('Recovery confirmation time must be at or after the attempt start.');
  }
  if (!attempt.provingFix) {
    throw new Error(`Recovery attempt ${attemptId} does not have an eligible proving fix.`);
  }

  const completed = await transaction.runAsync(
    `UPDATE session_recovery_attempts
     SET completed_at = ?, outcome = 'succeeded',
         proving_fix_sequence = ?, proving_fix_source_at = ?, proving_fix_receipt_at = ?
     WHERE id = ? AND completed_at IS NULL`,
    occurredAt,
    attempt.provingFix.sequence,
    attempt.provingFix.sourceTimestamp,
    attempt.provingFix.receiptTimestamp,
    attemptId,
  );
  if (completed.changes !== 1) {
    throw new Error(`Recovery attempt ${attemptId} was already completed.`);
  }
  await transaction.runAsync(
    `UPDATE sessions
     SET status = 'recording',
         updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
     WHERE id = ? AND manual_stop_at IS NULL`,
    occurredAt,
    occurredAt,
    attempt.sessionId,
  );
  const eventPayload = {
    attemptId,
    kind: attempt.kind,
    provingFix: attempt.provingFix,
  };
  await transaction.runAsync(
    `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
     VALUES (?, 'recovery_succeeded', ?, ?, ?)`,
    attempt.sessionId,
    occurredAt,
    `recovery-succeeded:${attemptId}`,
    JSON.stringify(eventPayload),
  );
  if (attempt.kind === 'manual') {
    await transaction.runAsync(
      `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
       VALUES (?, 'session_resumed', ?, ?, ?)`,
      attempt.sessionId,
      occurredAt,
      `session-resumed:${attemptId}`,
      JSON.stringify(eventPayload),
    );
  }
  return { ...attempt, provingFix: attempt.provingFix, confirmedAt: occurredAt };
}

export interface RawLocationFix {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    altitudeAccuracy: number | null;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
  };
  mocked?: boolean;
}

export interface LocationBatchInput {
  callbackId: string;
  receivedAt: number;
  locations: RawLocationFix[];
}

export interface LocationBatchResult {
  sessionId: string | null;
  reported: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  callbackDuplicate: boolean;
}

interface ActiveSessionRow {
  id: string;
  location_sequence: number;
  started_at: number;
}

function isNullableFinite(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

export function resolveInterruptedPartialEndAt(
  startedAt: number,
  occurredAt: number,
  latestEligibleFixSourceAt: number | null,
): number {
  const ceiling = Number.isFinite(occurredAt) ? Math.max(startedAt, occurredAt) : startedAt;
  if (latestEligibleFixSourceAt === null || !Number.isFinite(latestEligibleFixSourceAt)) {
    return startedAt;
  }
  return Math.min(ceiling, Math.max(startedAt, latestEligibleFixSourceAt));
}

export function isValidRawLocation(location: RawLocationFix): boolean {
  return (
    Number.isFinite(location.timestamp) &&
    Number.isFinite(location.coords.latitude) &&
    location.coords.latitude >= -90 &&
    location.coords.latitude <= 90 &&
    Number.isFinite(location.coords.longitude) &&
    location.coords.longitude >= -180 &&
    location.coords.longitude <= 180 &&
    isNullableFinite(location.coords.altitude) &&
    isNullableFinite(location.coords.altitudeAccuracy) &&
    isNullableFinite(location.coords.accuracy) &&
    isNullableFinite(location.coords.speed) &&
    isNullableFinite(location.coords.heading)
  );
}

export async function persistLocationBatchTransaction(
  database: TransactionalDatabase,
  input: LocationBatchInput,
): Promise<LocationBatchResult> {
  let result: LocationBatchResult = {
    sessionId: null,
    reported: input.locations.length,
    inserted: 0,
    duplicates: 0,
    invalid: 0,
    callbackDuplicate: false,
  };

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const session = await transaction.getFirstAsync<ActiveSessionRow>(
      `SELECT id, location_sequence, started_at
       FROM sessions
       WHERE status = 'recording'
       ORDER BY started_at DESC
       LIMIT 1`,
    );
    if (!session) return;
    result.sessionId = session.id;

    const dedupeKey = `location-callback:${session.id}:${input.callbackId}`;
    const legacyDedupeKey = `location-callback:${input.callbackId}`;
    const existingEvent = await transaction.getFirstAsync<{ id: number }>(
      `SELECT id FROM events
       WHERE session_id = ? AND dedupe_key IN (?, ?)
       LIMIT 1`,
      session.id,
      dedupeKey,
      legacyDedupeKey,
    );
    if (existingEvent) {
      result = {
        ...result,
        duplicates: input.locations.length,
        callbackDuplicate: true,
      };
      await transaction.runAsync(
        `UPDATE sessions
         SET last_location_callback_at = CASE
               WHEN last_location_callback_at IS NULL OR ? > last_location_callback_at THEN ?
               ELSE last_location_callback_at
             END,
             updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
         WHERE id = ?`,
        input.receivedAt,
        input.receivedAt,
        input.receivedAt,
        input.receivedAt,
        session.id,
      );
      await transaction.runAsync(
        `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
         VALUES (?, 'location_callback_duplicate', ?, NULL, ?)`,
        session.id,
        input.receivedAt,
        JSON.stringify({
          callbackId: input.callbackId,
          reported: input.locations.length,
          duplicates: input.locations.length,
        }),
      );
      return;
    }

    let nextSequence = session.location_sequence;
    let lastFixAt: number | null = null;
    for (const [batchIndex, location] of input.locations.entries()) {
      if (!isValidRawLocation(location) || location.timestamp < session.started_at) {
        result.invalid += 1;
        continue;
      }

      const candidateSequence = nextSequence + 1;
      const insert = await transaction.runAsync(
        `INSERT OR IGNORE INTO location_fixes (
          session_id, sequence, callback_id, batch_index, source_timestamp,
          receipt_timestamp, latitude, longitude, gps_altitude, vertical_accuracy,
          horizontal_accuracy, speed, heading, mocked
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        session.id,
        candidateSequence,
        input.callbackId,
        batchIndex,
        location.timestamp,
        input.receivedAt,
        location.coords.latitude,
        location.coords.longitude,
        location.coords.altitude,
        location.coords.altitudeAccuracy,
        location.coords.accuracy,
        location.coords.speed,
        location.coords.heading,
        location.mocked ? 1 : 0,
      );

      if (insert.changes === 1) {
        nextSequence = candidateSequence;
        result.inserted += 1;
        lastFixAt = Math.max(lastFixAt ?? location.timestamp, location.timestamp);
      } else {
        result.duplicates += 1;
      }
    }

    await transaction.runAsync(
      `UPDATE sessions
       SET location_sequence = ?,
           last_fix_at = CASE
             WHEN last_fix_at IS NULL OR ? > last_fix_at THEN ?
             ELSE last_fix_at
           END,
           last_location_callback_at = CASE
             WHEN last_location_callback_at IS NULL OR ? > last_location_callback_at THEN ?
             ELSE last_location_callback_at
           END,
           updated_at = CASE WHEN ? > updated_at THEN ? ELSE updated_at END
       WHERE id = ?`,
      nextSequence,
      lastFixAt,
      lastFixAt,
      input.receivedAt,
      input.receivedAt,
      input.receivedAt,
      input.receivedAt,
      session.id,
    );
    await transaction.runAsync(
      `INSERT INTO events (session_id, event_type, occurred_at, dedupe_key, payload_json)
       VALUES (?, 'location_callback', ?, ?, ?)`,
      session.id,
      input.receivedAt,
      dedupeKey,
      JSON.stringify({
        callbackId: input.callbackId,
        reported: result.reported,
        inserted: result.inserted,
        duplicates: result.duplicates,
        invalid: result.invalid,
      }),
    );
  });

  return result;
}

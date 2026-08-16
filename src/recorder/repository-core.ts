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
}

function isNullableFinite(value: number | null): boolean {
  return value === null || Number.isFinite(value);
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
      `SELECT id, location_sequence
       FROM sessions
       WHERE status = 'recording'
       ORDER BY started_at DESC
       LIMIT 1`,
    );
    if (!session) return;
    result.sessionId = session.id;

    const dedupeKey = `location-callback:${input.callbackId}`;
    const existingEvent = await transaction.getFirstAsync<{ id: number }>(
      'SELECT id FROM events WHERE dedupe_key = ? LIMIT 1',
      dedupeKey,
    );
    if (existingEvent) {
      result = {
        ...result,
        duplicates: input.locations.length,
        callbackDuplicate: true,
      };
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
      if (!isValidRawLocation(location)) {
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
           updated_at = ?
       WHERE id = ?`,
      nextSequence,
      lastFixAt,
      lastFixAt,
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

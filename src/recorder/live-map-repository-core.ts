import {
  LIVE_MAP_MAX_ROWS,
  LIVE_MAP_WINDOW_MS,
  type CapturedMapFix,
  type LiveMapPage,
  type LiveMapRead,
} from '../lib/live/types';
import type { ReplayReader } from './replay-repository-core';

interface LiveSessionRow {
  status: string;
  started_at: number;
  location_sequence: number;
}

type StoredFix = Omit<CapturedMapFix, 'mocked'> & { mocked: number };

const COLUMNS = `session_id AS sessionId, sequence,
  source_timestamp AS sourceTimestamp, receipt_timestamp AS receiptTimestamp,
  latitude, longitude, horizontal_accuracy AS horizontalAccuracy, mocked`;

const BOOTSTRAP_SQL = `SELECT ${COLUMNS} FROM location_fixes
  WHERE session_id = ? AND sequence <= ?
  ORDER BY sequence DESC LIMIT ?`;

const DELTA_SQL = `SELECT ${COLUMNS} FROM location_fixes
  WHERE session_id = ? AND sequence > ? AND sequence <= ?
  ORDER BY sequence ASC LIMIT ?`;

// The predicate matches schema 8's partial index. Even a long mocked/invalid tail must
// not make a marker lookup walk the flight, or substitute receipt order for source time.
export const LIVE_MAP_POSITION_SQL = `SELECT ${COLUMNS} FROM location_fixes
  INDEXED BY location_fixes_map_source_order
  WHERE session_id = ? AND mocked = 0
    AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
    AND source_timestamp >= ? AND source_timestamp <= ? AND sequence <= ?
  ORDER BY source_timestamp DESC, sequence DESC LIMIT 1`;

const mapFix = (row: StoredFix): CapturedMapFix => ({ ...row, mocked: row.mocked !== 0 });

/** Read-only: neither recorder state nor its capture/health path is touched here. */
export async function readLiveMapPage(database: ReplayReader, input: LiveMapRead): Promise<LiveMapPage> {
  const { sessionId, now } = input;
  if (!sessionId || !Number.isFinite(now)) throw new Error('A live map needs a session and a valid read time.');
  if (input.cursor && (input.cursor.sessionId !== sessionId ||
    !Number.isSafeInteger(input.cursor.sequence) || input.cursor.sequence < 0)) {
    throw new Error('The live map cursor belongs to another session or is invalid.');
  }
  const session = await database.getFirstAsync<LiveSessionRow>(
    'SELECT status, started_at, location_sequence FROM sessions WHERE id = ?', sessionId,
  );
  if (!session || session.status !== 'recording') throw new Error('This recording is no longer active.');
  const highWatermark = session.location_sequence;
  if (!Number.isSafeInteger(highWatermark) || highWatermark < 0 || !Number.isFinite(session.started_at)) {
    throw new Error('This recording has an invalid location checkpoint.');
  }
  if (input.cursor && input.cursor.sequence > highWatermark) {
    throw new Error('The live map cursor is ahead of this recording.');
  }
  const mode = input.cursor ? 'delta' : 'bootstrap';
  const stored = mode === 'bootstrap'
    ? await database.getAllAsync<StoredFix>(BOOTSTRAP_SQL, sessionId, highWatermark, LIVE_MAP_MAX_ROWS)
    : input.cursor!.sequence === highWatermark ? []
      : await database.getAllAsync<StoredFix>(DELTA_SQL, sessionId, input.cursor!.sequence,
        highWatermark, LIVE_MAP_MAX_ROWS + 1);
  const scanned = stored.slice(0, LIVE_MAP_MAX_ROWS);
  // A delta's cursor advances over invalid/expired rows, never over an unscanned page.
  // Bootstrap deliberately discards older history and consumes its full watermark.
  const sequence = mode === 'bootstrap' ? highWatermark
    : scanned.at(-1)?.sequence ?? input.cursor!.sequence;
  const position = await database.getFirstAsync<StoredFix>(LIVE_MAP_POSITION_SQL,
    sessionId, session.started_at, now, highWatermark);
  const cutoff = Math.max(session.started_at, now - LIVE_MAP_WINDOW_MS);
  return {
    sessionId, mode, highWatermark, cursor: { sessionId, sequence },
    hasMore: sequence < highWatermark,
    rows: scanned.map(mapFix).filter((row) => row.sourceTimestamp >= cutoff && row.sourceTimestamp <= now),
    position: position ? mapFix(position) : null,
  };
}

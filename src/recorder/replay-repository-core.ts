import { normalizeReplayPoints, type FlightReplay, type ReplayFix } from '../lib/replay/model';

/** Minimal async SQLite surface, also used by repository tests. */
export interface ReplayReader {
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
}

export interface ReplayHeaderRow {
  status: string;
  session_status: string;
  completion_reason: string | null;
  recording_session_id: string;
  started_at: number;
  ended_at: number | null;
  manual_stop_at: number | null;
}

export const REPLAY_HEADER_SQL = `SELECT f.status, f.recording_session_id,
  s.status AS session_status, s.completion_reason, s.started_at, s.ended_at, s.manual_stop_at
  FROM flights f JOIN sessions s ON s.id = f.recording_session_id WHERE f.id = ?`;

export const REPLAY_FIXES_SQL = `SELECT source_timestamp AS sourceTimestamp, sequence,
  latitude, longitude, gps_altitude AS gpsAltitude, speed, mocked
  FROM location_fixes
  WHERE session_id = ? AND source_timestamp >= ? AND source_timestamp <= ? AND mocked = 0
  ORDER BY source_timestamp, sequence`;

export async function readFlightReplay(database: ReplayReader, flightId: string): Promise<FlightReplay> {
  const header = await database.getFirstAsync<ReplayHeaderRow>(REPLAY_HEADER_SQL, flightId);
  if (!header) return { kind: 'unavailable', reason: 'not_found' };
  if (header.session_status !== 'completed' || header.status === 'recording') return { kind: 'unavailable', reason: 'open' };
  if (header.status !== 'completed' && header.status !== 'partial') return { kind: 'unavailable', reason: 'processing' };
  const endedAt = header.ended_at === null ? null : Math.min(header.ended_at, header.manual_stop_at ?? header.ended_at);
  if (endedAt === null || !Number.isFinite(header.started_at) || !Number.isFinite(endedAt) || endedAt <= header.started_at) return { kind: 'unavailable', reason: 'invalid_bounds' };
  const bounds = { startedAt: header.started_at, endedAt };
  const fixes = await database.getAllAsync<Omit<ReplayFix, 'mocked'> & { mocked: number }>(REPLAY_FIXES_SQL, header.recording_session_id, bounds.startedAt, bounds.endedAt);
  const points = normalizeReplayPoints(fixes.map((fix) => ({ ...fix, mocked: fix.mocked !== 0 })), bounds);
  if (points.length < 2) return { kind: 'unavailable', reason: 'insufficient_fixes' };
  return { kind: 'available', flightId, bounds, points, partial: header.status === 'partial' || header.completion_reason === 'interrupted_finalized' };
}

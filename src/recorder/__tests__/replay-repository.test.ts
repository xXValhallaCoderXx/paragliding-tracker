import { readFlightReplay, REPLAY_FIXES_SQL, REPLAY_HEADER_SQL, type ReplayHeaderRow, type ReplayReader } from '../replay-repository-core';

const header: ReplayHeaderRow = { status: 'completed', session_status: 'completed', completion_reason: 'stopped', recording_session_id: 'selected-session', started_at: 1000, ended_at: 5000, manual_stop_at: 4000 };
const fix = (t: number) => ({ sourceTimestamp: t, sequence: t, latitude: 46, longitude: 8, gpsAltitude: null, speed: null, mocked: 0 });
function db(row: ReplayHeaderRow | null = header, points = [fix(1000), fix(2000)]) {
  const getFirstAsync = jest.fn(async () => row);
  const getAllAsync = jest.fn(async () => points);
  return { reader: { getFirstAsync, getAllAsync } as ReplayReader, getFirstAsync, getAllAsync };
}
it('loads only the selected session, with its saved stop boundary', async () => {
  const { reader, getFirstAsync, getAllAsync } = db();
  const result = await readFlightReplay(reader, 'selected-flight');
  expect(getFirstAsync).toHaveBeenCalledWith(REPLAY_HEADER_SQL, 'selected-flight');
  expect(getAllAsync).toHaveBeenCalledWith(REPLAY_FIXES_SQL, 'selected-session', 1000, 4000);
  expect(result).toMatchObject({ kind: 'available', partial: false, bounds: { startedAt: 1000, endedAt: 4000 } });
  expect(REPLAY_FIXES_SQL).not.toMatch(/SELECT\s+\*|pressure|events|receipt|heading|accuracy/);
});
it.each([
  ['not_found', null],
  ['open', { ...header, session_status: 'interrupted' }],
  ['open', { ...header, session_status: 'recording' }],
  ['processing', { ...header, status: 'processing' }],
  ['invalid_bounds', { ...header, ended_at: null }],
  ['invalid_bounds', { ...header, ended_at: 1000 }],
  ['invalid_bounds', { ...header, started_at: NaN }],
] as const)('explains %s without reading samples', async (reason, row) => {
  const { reader, getAllAsync } = db(row);
  expect(await readFlightReplay(reader, 'f')).toEqual({ kind: 'unavailable', reason });
  expect(getAllAsync).not.toHaveBeenCalled();
});
it('replays completed partial flights, including ones with no altitude', async () => {
  const { reader } = db({ ...header, status: 'partial', completion_reason: 'interrupted_finalized' });
  expect(await readFlightReplay(reader, 'f')).toMatchObject({ kind: 'available', partial: true });
});
it('requires two distinct timestamps, not simply two database rows', async () => {
  const { reader } = db(header, [fix(1000), { ...fix(1000), sequence: 2000 }]);
  expect(await readFlightReplay(reader, 'f')).toEqual({ kind: 'unavailable', reason: 'insufficient_fixes' });
});
it('filters out-of-bounds and mocked rows defensively', async () => {
  const { reader } = db(header, [fix(999), fix(1000), { ...fix(2000), mocked: 1 }, fix(4001)]);
  expect(await readFlightReplay(reader, 'f')).toMatchObject({ reason: 'insufficient_fixes' });
});

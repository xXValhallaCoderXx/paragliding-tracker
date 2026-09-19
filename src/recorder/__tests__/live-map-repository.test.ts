import { TestDatabase, schemaAt, seedSession } from '../../../tests/support/sqlite';
import { LIVE_MAP_POSITION_SQL, readLiveMapPage } from '../live-map-repository-core';
import { LIVE_MAP_WINDOW_MS } from '@/lib/live/types';
import type { ReplayReader } from '../replay-repository-core';

let db: TestDatabase;
beforeEach(async () => { db = new TestDatabase(); await schemaAt(db, 8); await seedSession(db); });
afterEach(async () => { await db.closeAsync(); });

async function insert(sequence: number, sourceTimestamp: number, options: {
  sessionId?: string; mocked?: number; latitude?: number; receiptTimestamp?: number;
} = {}) {
  const sessionId = options.sessionId ?? 'session-1';
  await db.runAsync(`INSERT INTO location_fixes
    (session_id, sequence, callback_id, batch_index, source_timestamp, receipt_timestamp,
     latitude, longitude, horizontal_accuracy, mocked)
    VALUES (?, ?, ?, 0, ?, ?, ?, 8, 5, ?)`, sessionId, sequence, `callback-${sequence}`,
  sourceTimestamp, options.receiptTimestamp ?? sourceTimestamp, options.latitude ?? 46, options.mocked ?? 0);
  await db.runAsync('UPDATE sessions SET location_sequence = ? WHERE id = ?', sequence, sessionId);
}

it('reads only committed evidence from the selected active session and changes no evidence', async () => {
  await seedSession(db, 'other', 'completed');
  await insert(1, 1000); await insert(2, 3000); await insert(1, 4000, { sessionId: 'other' });
  const before = await db.getAllAsync('SELECT * FROM location_fixes');
  const page = await readLiveMapPage(db, { sessionId: 'session-1', now: 5000 });
  expect(page.rows.map((row) => row.sessionId)).toEqual(['session-1', 'session-1']);
  expect(page).toMatchObject({ position: { sequence: 2, sourceTimestamp: 3000 }, cursor: { sessionId: 'session-1', sequence: 2 }, hasMore: false });
  expect(await db.getAllAsync('SELECT * FROM location_fixes')).toEqual(before);
  await expect(readLiveMapPage(db, { sessionId: 'other', now: 5000 })).rejects.toThrow('no longer active');
});

it('bounds a long session to recent raw rows and finds the latest source position beyond a mocked/invalid tail', async () => {
  await insert(1, 1000);
  await insert(2, 1_499_000);
  for (let sequence = 3; sequence <= 1500; sequence++) {
    await insert(sequence, 1000 + sequence, sequence % 2 ? { mocked: 1 } : { latitude: 91 });
  }
  const page = await readLiveMapPage(db, { sessionId: 'session-1', now: 1_500_000 });
  expect(page.rows).toEqual([]);
  expect(page.position).toMatchObject({ sequence: 2, sourceTimestamp: 1_499_000 });
  expect(page.cursor.sequence).toBe(1500);
  expect(page.hasMore).toBe(false);
  const plan = await db.getAllAsync<{ detail: string }>(`EXPLAIN QUERY PLAN ${LIVE_MAP_POSITION_SQL}`, 'session-1', 1000, 1_500_000, 1500);
  expect(plan.some((row) => row.detail.includes('location_fixes_map_source_order'))).toBe(true);
  expect(plan.some((row) => /SCAN |TEMP B-TREE/.test(row.detail))).toBe(false);
});

it('keeps the last-known position when its trail expires, without accepting a future or mocked point', async () => {
  await insert(1, 1000); await insert(2, 4000, { receiptTimestamp: 8000 });
  await insert(3, 2000, { receiptTimestamp: 9000 }); // Delayed batch does not move position backwards.
  await insert(4, 6000, { mocked: 1 }); await insert(5, 9_000_000);
  const page = await readLiveMapPage(db, { sessionId: 'session-1', now: LIVE_MAP_WINDOW_MS + 7000 });
  expect(page.rows).toEqual([]);
  expect(page.position).toMatchObject({ sequence: 2, sourceTimestamp: 4000, receiptTimestamp: 8000 });
  expect(page.cursor.sequence).toBe(5);
});

it('advances the sequence cursor over invalid, mocked and expired rows while honestly reporting an unfinished delta', async () => {
  for (let sequence = 1; sequence <= 1100; sequence++) {
    await insert(sequence, 1000 + sequence, sequence % 2 ? { mocked: 1 } : { latitude: 91 });
  }
  const page = await readLiveMapPage(db, { sessionId: 'session-1', cursor: { sessionId: 'session-1', sequence: 0 }, now: 1_500_000 });
  expect(page).toMatchObject({ rows: [], position: null, cursor: { sequence: 999 }, highWatermark: 1100, hasMore: true });
  const last = await readLiveMapPage(db, { sessionId: 'session-1', cursor: page.cursor, now: 1_500_000 });
  expect(last).toMatchObject({ rows: [], cursor: { sequence: 1100 }, hasMore: false });
});

it('caps bootstrap at 999 stored rows and does not mix a concurrently committed append into its watermark', async () => {
  for (let sequence = 1; sequence <= 1100; sequence++) await insert(sequence, 1000 + sequence);
  let appended = false;
  const reader: ReplayReader = {
    getAllAsync: db.getAllAsync.bind(db),
    async getFirstAsync<T>(sql: string, ...params: (string | number)[]) {
      const result = await db.getFirstAsync<T>(sql, ...params);
      if (!appended) { appended = true; await insert(1101, 3000); }
      return result;
    },
  };
  const page = await readLiveMapPage(reader, { sessionId: 'session-1', now: 4000 });
  expect(page.rows).toHaveLength(999);
  expect(Math.max(...page.rows.map((row) => row.sequence))).toBe(1100);
  expect(page.position?.sequence).toBe(1100);
  expect(page.cursor.sequence).toBe(1100);
  const next = await readLiveMapPage(db, { sessionId: 'session-1', cursor: page.cursor, now: 4000 });
  expect(next.rows.map((row) => row.sequence)).toEqual([1101]);
  expect(next.position?.sequence).toBe(1101);
});

it('rejects a cursor from another recording before querying its evidence', async () => {
  await expect(readLiveMapPage(db, { sessionId: 'session-1', cursor: { sessionId: 'other', sequence: 1 }, now: 4000 }))
    .rejects.toThrow('another session');
});

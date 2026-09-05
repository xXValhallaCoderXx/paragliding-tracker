import * as SQLite from 'expo-sqlite';
import * as database from '../database.native';
import { TestDatabase, schemaAt, seedSession, seedEvidence, sqliteHarness } from '../../../tests/support/sqlite';
import { BACKFILL_FLIGHTS_SQL } from '../flight-repository-core';
import type { RawLocationFix } from '../repository-core';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), backupDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
let harness: ReturnType<typeof sqliteHarness>;
let db: TestDatabase;
// Keep the real module and its write queue; reset the contents of its one connection between tests.
beforeAll(async () => {
  harness = sqliteHarness();
  jest.mocked(SQLite.openDatabaseAsync).mockImplementation(harness.openDatabaseAsync);
  await database.getLatestSession();
  db = harness.databases.get('xc-recorder.db')!;
});
beforeEach(async () => {
  for (const { name } of await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    await db.execAsync(`PRAGMA foreign_keys = OFF; DROP TABLE "${name}"; PRAGMA foreign_keys = ON`);
  }
  await schemaAt(db, 7);
  await seedSession(db); await db.execAsync(BACKFILL_FLIGHTS_SQL);
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => harness.dispose());
const fix = (timestamp: number, overrides: Partial<RawLocationFix> = {}): RawLocationFix => ({
  timestamp, coords: { latitude: 46, longitude: 8, altitude: 1000, altitudeAccuracy: 4, accuracy: 3, speed: 10, heading: 90 }, ...overrides,
});
const batch = (callbackId: string, receivedAt: number, locations: RawLocationFix[]) => database.persistLocationBatch({ callbackId, receivedAt, locations });
const attempt = (overrides = {}) => database.beginSessionRecoveryAttempt({
  attemptId: 'attempt', sessionId: 'session-1', kind: 'automatic', attemptStartedAt: 10_000,
  deadlineAt: 20_000, maximumCachedFixAgeMs: 5000, ...overrides,
});
const power = { batteryLevel: null, batteryState: null, lowPowerMode: null, batteryOptimizationEnabled: null, recordedAt: 30_000 };

it('enforces one unfinished recording and singleton device settings in the applied schema', async () => {
  await expect(seedSession(db, 'second', 'recording')).rejects.toThrow(/UNIQUE/);
  await expect(seedSession(db, 'second', 'interrupted')).rejects.toThrow(/UNIQUE/);
  await expect(db.runAsync('INSERT INTO pilot_profile (id, updated_at) VALUES (2, 0)')).rejects.toThrow(/CHECK/);
  await expect(db.runAsync('INSERT INTO cloud_link (id) VALUES (2)')).rejects.toThrow(/CHECK/);
});

it('deduplicates callbacks and sources, rejects invalid fixes, and never moves the heartbeat backwards', async () => {
  expect(await batch('a', 3000, [fix(1500), fix(999), fix(NaN)])).toMatchObject({ inserted: 1, invalid: 2 });
  expect(await batch('a', 4000, [fix(1500)])).toMatchObject({ callbackDuplicate: true, duplicates: 1 });
  expect(await batch('b', 5000, [fix(1500), fix(2000)])).toMatchObject({ inserted: 1, duplicates: 1 });
  await batch('empty', 6000, []); await batch('old', 5500, [fix(999)]);
  expect(await database.getSession('session-1')).toMatchObject({ locationSequence: 2, lastFixAt: 2000, lastLocationCallbackAt: 6000 });
  expect(await db.getAllAsync('SELECT sequence, source_timestamp FROM location_fixes ORDER BY sequence')).toEqual([
    { sequence: 1, source_timestamp: 1500 }, { sequence: 2, source_timestamp: 2000 },
  ]);
  expect(await db.getFirstAsync("SELECT payload_json FROM events WHERE dedupe_key = 'location-callback:session-1:a'"))
    .toEqual({ payload_json: JSON.stringify({ callbackId: 'a', reported: 3, inserted: 1, duplicates: 0, invalid: 2 }) });
});

it('accepts legacy dedupe keys and scopes a repeated native callback ID to its session', async () => {
  await db.runAsync("INSERT INTO events (session_id,event_type,occurred_at,dedupe_key,payload_json) VALUES ('session-1','location_callback',1000,'location-callback:legacy','{}')");
  expect(await batch('legacy', 2000, [fix(1500)])).toMatchObject({ callbackDuplicate: true });
  await batch('a', 2000, [fix(1500)]);
  await database.completeSession('session-1', 2000, 'stopped', power);
  await seedSession(db, 'session-2');
  expect(await batch('a', 3000, [fix(1500)])).toMatchObject({ sessionId: 'session-2', inserted: 1 });
});

it('rolls back fixes and checkpoints if callback accounting cannot be stored, then permits retry', async () => {
  await db.execAsync("CREATE TRIGGER full_disk BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(batch('a', 2000, [fix(1500)])).rejects.toThrow('disk full');
  expect(await db.getAllAsync('SELECT * FROM location_fixes')).toEqual([]);
  expect(await database.getSession('session-1')).toMatchObject({ locationSequence: 0, lastLocationCallbackAt: null });
  await db.execAsync('DROP TRIGGER full_disk');
  expect(await batch('a', 2000, [fix(1500)])).toMatchObject({ inserted: 1 });
});

it('persists the first Stop, closes recovery, and rejects later capture and partial completion', async () => {
  await attempt();
  expect(await database.requestSessionStop('session-1', 12_000)).toBe(12_000);
  expect(await database.requestSessionStop('session-1', 13_000)).toBe(12_000);
  expect(await database.getPendingSessionStop()).toMatchObject({ sessionId: 'session-1', stoppedAt: 12_000 });
  expect(await batch('late', 14_000, [fix(14_000)])).toMatchObject({ inserted: 0, sessionId: null });
  expect(await database.getPendingSessionRecoveryAttempt('session-1')).toBeNull();
  await expect(attempt()).rejects.toThrow('pending manual stop');
  await expect(database.completeSession('session-1', 30_000, 'interrupted_finalized', power)).rejects.toThrow('reason stopped');
  await database.completeSession('session-1', 30_000, 'stopped', power);
  await database.completeSession('session-1', 40_000, 'stopped', power);
  expect(await database.getSession('session-1')).toMatchObject({ status: 'completed', endedAt: 12_000, manualStopAt: 12_000 });
  expect(await database.getFlight('session-1')).toMatchObject({ status: 'processing', endedAt: 12_000 });
  expect(await database.getPendingSessionStop()).toBeNull();
  expect(await db.getFirstAsync("SELECT count(*) AS count FROM events WHERE event_type = 'session_completed'")).toEqual({ count: 1 });
});

it('rejects malformed Stop boundaries and rolls back a Stop that cannot record its audit event', async () => {
  await expect(database.requestSessionStop('session-1', 999)).rejects.toThrow('at or after');
  await db.execAsync("CREATE TRIGGER full_disk BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(database.requestSessionStop('session-1', 2000)).rejects.toThrow('disk full');
  expect(await database.getSession('session-1')).toMatchObject({ status: 'recording', manualStopAt: null });
});

it('claims one recovery attempt and requires a fresh, non-mocked, in-window proving fix', async () => {
  await batch('baseline', 9000, [fix(8000)]);
  expect(await attempt()).toMatchObject({ baselineLocationSequence: 1 });
  await expect(attempt({ attemptId: 'second' })).rejects.toThrow('unmatched recovery');
  await batch('early', 9999, [fix(6000)]);
  await batch('stale', 11_000, [fix(4999)]);
  await batch('mocked', 12_000, [fix(11_000, { mocked: true })]);
  await batch('late', 20_001, [fix(20_000)]);
  await expect(database.confirmSessionRecoveryAttempt('attempt', 21_000)).rejects.toThrow('eligible proving fix');
  await batch('proof', 20_000, [fix(5000)]);
  expect(await database.confirmSessionRecoveryAttempt('attempt', 21_000)).toMatchObject({
    attemptId: 'attempt', provingFix: { sequence: 6, sourceTimestamp: 5000, receiptTimestamp: 20_000 },
  });
  await expect(database.confirmSessionRecoveryAttempt('attempt', 22_000)).rejects.toThrow('not found');
  expect(await database.getPendingSessionRecoveryAttempt('session-1')).toBeNull();
});

it('pairs manual resume and recovery success with the same proof', async () => {
  await db.runAsync("UPDATE sessions SET status = 'interrupted'");
  await attempt({ kind: 'manual' }); await batch('proof', 11_000, [fix(10_000)]);
  await database.confirmSessionRecoveryAttempt('attempt', 12_000);
  const events = await db.getAllAsync<{ event_type: string; payload_json: string }>("SELECT event_type, payload_json FROM events WHERE event_type IN ('recovery_succeeded', 'session_resumed')");
  expect(events.map((row) => row.event_type)).toEqual(['recovery_succeeded', 'session_resumed']);
  for (const row of events) expect(JSON.parse(row.payload_json)).toMatchObject({ attemptId: 'attempt', kind: 'manual', provingFix: { sequence: 1 } });
});

it('reads snapshot evidence and replay from the selected session within its saved Stop', async () => {
  await batch('a', 2000, [fix(1000), fix(2000)]);
  await batch('mock', 3000, [fix(2500, { mocked: true })]);
  expect(await database.getSessionSnapshotMetrics('session-1')).toMatchObject({
    fixCount: 3, lastLocationCallbackAt: 3000, latestEligibleFixSourceAt: 2000, latestEligibleFixReceiptAt: 2000,
  });
  await database.requestSessionStop('session-1', 2000);
  await database.completeSession('session-1', 4000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'session-1', status: 'completed', endedAt: 2000, updatedAt: 4000 });
  await seedSession(db, 'other', 'completed'); await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await seedEvidence(db, 'other');
  expect(await database.getFlightReplay('session-1')).toMatchObject({ kind: 'available', bounds: { startedAt: 1000, endedAt: 2000 }, points: [
    expect.objectContaining({ timestamp: 1000 }), expect.objectContaining({ timestamp: 2000 }),
  ] });
});

it('rejects deleting open or processing flights, then deletes all evidence and queues both tombstones', async () => {
  await expect(database.deleteCompletedFlight('session-1')).rejects.toThrow('active or unfinished');
  await seedEvidence(db); await attempt(); await batch('proof', 11_000, [fix(10_000)]);
  await database.confirmSessionRecoveryAttempt('attempt', 12_000);
  await database.completeSession('session-1', 13_000, 'stopped', power);
  await expect(database.deleteCompletedFlight('session-1')).rejects.toThrow('active or unfinished');
  await database.setFlightStatus({ flightId: 'session-1', status: 'partial', endedAt: 13_000, updatedAt: 13_000 });
  await db.runAsync("INSERT INTO flight_tracks VALUES ('session-1', '[]', 1, 13000)");
  await database.markFlightPushed({ flightId: 'session-1', pushedUpdatedAt: 13_000, remoteUpdatedAt: '2026-09-06T00:00:00Z' });
  await seedSession(db, 'other', 'completed'); await db.execAsync(BACKFILL_FLIGHTS_SQL); await seedEvidence(db, 'other');
  await database.deleteCompletedFlight('session-1', 14_000);
  expect(await database.getSession('session-1')).toBeNull();
  expect(await database.getFlight('session-1')).toBeNull();
  expect(await db.getAllAsync('SELECT session_id FROM location_fixes')).toEqual([{ session_id: 'other' }]);
  expect(await database.listPendingFileDeletions()).toEqual(['/private/flight.igc']);
  expect(await database.listPendingFlightDeletions(10, 15_000)).toMatchObject([{ flightId: 'session-1', recordingSessionId: 'session-1', deletedAt: 14_000 }]);
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

it('rolls deletion back if its cloud tombstone cannot be saved', async () => {
  await seedEvidence(db); await database.completeSession('session-1', 2000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'session-1', status: 'completed', endedAt: 2000, updatedAt: 2000 });
  await db.execAsync("CREATE TRIGGER full_disk BEFORE INSERT ON flight_deletions BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(database.deleteCompletedFlight('session-1')).rejects.toThrow('disk full');
  expect(await database.getFlight('session-1')).not.toBeNull();
  expect(await db.getFirstAsync('SELECT count(*) AS count FROM location_fixes')).toEqual({ count: 1 });
  expect(await database.listPendingFileDeletions()).toEqual([]);
});

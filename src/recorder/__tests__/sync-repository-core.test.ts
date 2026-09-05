import { TestDatabase, schemaAt, seedSession, seedEvidence } from '../../../tests/support/sqlite';
import { BACKFILL_FLIGHTS_SQL } from '../flight-repository-core';
import {
  BIND_CLOUD_LINK_SQL, COUNT_PENDING_SYNC_SQL, DIRTY_FLIGHTS_SQL, MARK_FLIGHT_PUSHED_SQL,
  PENDING_FLIGHT_DELETIONS_SQL, RECORD_FLIGHT_SYNC_FAILURE_SQL,
  applyRemoteFlightMetadataTransaction, mapFlightSyncCandidate, resetCloudLinkTransaction,
  updatePilotProfileTransaction, type FlightSyncCandidateRow,
} from '../sync-repository-core';
let db: TestDatabase;
beforeEach(async () => { db = new TestDatabase(); await schemaAt(db, 7); });
afterEach(async () => db.closeAsync());
async function flight(id: string, status = 'completed', start = 1000, sessionStatus = 'completed') {
  await seedSession(db, id, sessionStatus, start); await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await db.runAsync('UPDATE flights SET status = ? WHERE id = ?', status, id);
}
const candidates = async (now = 10_000, limit = 100) =>
  (await db.getAllAsync<FlightSyncCandidateRow>(DIRTY_FLIGHTS_SQL, now, limit)).map(mapFlightSyncCandidate);

it('selects only finished dirty flights, respects backoff and orders then limits work', async () => {
  await flight('late', 'partial', 2000); await flight('early'); await flight('clean');
  await flight('waiting'); await flight('processing', 'processing');
  await flight('live', 'completed', 1000, 'recording');
  await db.runAsync(MARK_FLIGHT_PUSHED_SQL, 'clean', 1000, '2026-09-06T00:00:00Z');
  await db.runAsync(RECORD_FLIGHT_SYNC_FAILURE_SQL, 'waiting', 20_000, 'offline');
  expect((await candidates()).map((f) => f.id)).toEqual(['early', 'late']);
  expect((await candidates(10_000, 1)).map((f) => f.id)).toEqual(['early']);
  expect(await db.getFirstAsync(COUNT_PENDING_SYNC_SQL)).toEqual({ flights: 3, deletions: 0 });
  expect((await candidates(20_000)).map((f) => f.id)).toEqual(['early', 'waiting', 'late']);
  expect((await candidates())[0]).toMatchObject({ metrics: null, attemptCount: 0, nextAttemptAt: 0 });
  await db.runAsync("UPDATE sessions SET status = 'interrupted' WHERE id = 'live'");
  expect((await candidates()).map((f) => f.id)).not.toContain('live');
});

it('maps actual metrics and preserves an edit made during an in-flight push', async () => {
  await flight('f');
  await db.runAsync("INSERT INTO flight_metrics (flight_id,algorithm_version,duration_ms,track_distance_metres,fix_count,quality,computed_at) VALUES ('f',3,4000,12345.6,240,'healthy',6100)");
  await db.runAsync("UPDATE flights SET updated_at = 6000 WHERE id = 'f'");
  await db.runAsync(MARK_FLIGHT_PUSHED_SQL, 'f', 5000, '2026-09-06T00:00:00Z');
  expect(await candidates()).toMatchObject([{ id: 'f', metrics: { flightId: 'f', algorithmVersion: 3, durationMs: 4000, trackDistanceMetres: 12345.6, fixCount: 240, quality: 'healthy' } }]);
  await db.runAsync(MARK_FLIGHT_PUSHED_SQL, 'f', 6000, '2026-09-06T00:00:01Z');
  expect(await candidates()).toEqual([]);
});

it('merges only newer metadata, resets provenance, and advances the watermark without an echo', async () => {
  await flight('f'); await seedEvidence(db, 'f');
  await db.runAsync("UPDATE flights SET title = 'Local', site = 'Launch', site_source = 'osm', takeoff_latitude = 46, takeoff_longitude = 8");
  const facts = await db.getFirstAsync('SELECT recording_session_id, status, started_at, ended_at, takeoff_latitude, takeoff_longitude FROM flights');
  const evidence = await db.getAllAsync('SELECT * FROM location_fixes');
  const remote = { flightId: 'f', title: 'Remote', site: 'Elsewhere', notes: 'Remote notes', clientUpdatedAt: 9000 };
  await db.withExclusiveTransactionAsync(async (tx) => {
    expect(await applyRemoteFlightMetadataTransaction(tx, remote, '2026-09-06T00:00:00Z')).toBe('applied');
  });
  expect(await db.getFirstAsync('SELECT * FROM flights')).toMatchObject({ ...facts as object, title: 'Remote', site: 'Elsewhere', site_source: 'manual', notes: 'Remote notes', updated_at: 9000 });
  expect(await candidates()).toEqual([]);
  for (const clientUpdatedAt of [1000, 9000]) {
    expect(await applyRemoteFlightMetadataTransaction(db, { ...remote, title: 'Stale', clientUpdatedAt }, 'later')).toBe('local_newer');
  }
  expect(await db.getFirstAsync('SELECT pushed_updated_at, remote_updated_at FROM flight_sync_state')).toEqual({ pushed_updated_at: 9000, remote_updated_at: '2026-09-06T00:00:00Z' });
  expect(await applyRemoteFlightMetadataTransaction(db, { ...remote, flightId: 'missing' }, 'later')).toBe('missing');
  await applyRemoteFlightMetadataTransaction(db, { ...remote, site: null, clientUpdatedAt: 10_000 }, 'later');
  expect(await db.getFirstAsync('SELECT site, site_source FROM flights')).toEqual({ site: null, site_source: null });
  expect(await db.getAllAsync('SELECT * FROM location_fixes')).toEqual(evidence);
});

it('rolls back the metadata merge when advancing its watermark fails', async () => {
  await flight('f');
  await db.execAsync("CREATE TRIGGER full_disk BEFORE INSERT ON flight_sync_state BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(db.withExclusiveTransactionAsync(async (tx) => {
    await applyRemoteFlightMetadataTransaction(tx, { flightId: 'f', title: 'Lost', site: null, notes: null, clientUpdatedAt: 9000 }, 'later');
  })).rejects.toThrow('disk full');
  expect(await db.getFirstAsync('SELECT title, updated_at FROM flights')).toEqual({ title: null, updated_at: 1000 });
});

it('claims only an unbound account and resets sync state without changing the logbook or evidence', async () => {
  await flight('f'); await seedEvidence(db, 'f');
  await db.runAsync("INSERT INTO flight_deletions (flight_id, recording_session_id, deleted_at) VALUES ('deleted', 'deleted-session', 2000)");
  await db.runAsync(MARK_FLIGHT_PUSHED_SQL, 'f', 1000, 'remote');
  await db.runAsync('UPDATE pilot_profile SET pushed_updated_at = 1000');
  const tables = ['flights', 'sessions', 'location_fixes', 'pressure_samples', 'events', 'exports', 'flight_metrics', 'flight_deletions', 'session_recovery_attempts'];
  const before = await Promise.all(tables.map((table) => db.getAllAsync(`SELECT * FROM ${table}`)));
  expect((await db.runAsync(BIND_CLOUD_LINK_SQL, 'a', 1000)).changes).toBe(1);
  expect((await db.runAsync(BIND_CLOUD_LINK_SQL, 'b', 2000)).changes).toBe(0);
  await db.withExclusiveTransactionAsync((tx) => resetCloudLinkTransaction(tx, 'b', 3000));
  expect(await db.getFirstAsync('SELECT user_id, linked_at FROM cloud_link')).toEqual({ user_id: 'b', linked_at: 3000 });
  expect(await db.getAllAsync('SELECT * FROM flight_sync_state')).toEqual([]);
  expect(await db.getFirstAsync('SELECT pushed_updated_at FROM pilot_profile')).toEqual({ pushed_updated_at: null });
  expect(await Promise.all(tables.map((table) => db.getAllAsync(`SELECT * FROM ${table}`)))).toEqual(before);
  await resetCloudLinkTransaction(db, null, 4000);
  expect(await db.getFirstAsync('SELECT user_id, linked_at FROM cloud_link')).toEqual({ user_id: null, linked_at: null });
});

it('patches registration and selected profile fields without losing untouched fields or the push watermark', async () => {
  await db.runAsync("UPDATE pilot_profile SET glider_type = 'Rush 6', glider_id = 'old', pushed_updated_at = 1000");
  await updatePilotProfileTransaction(db, { pilotName: 'Renate', gliderId: null, registrationId: 'APPI-123' }, 2000);
  expect(await db.getFirstAsync('SELECT * FROM pilot_profile')).toEqual({ id: 1, pilot_name: 'Renate', glider_type: 'Rush 6', glider_id: null, registration_id: 'APPI-123', updated_at: 2000, pushed_updated_at: 1000 });
});

it('selects deletion tombstones oldest first with a deterministic tie-break, limit and backoff', async () => {
  for (const [id, time, next] of [['z', 2000, 0], ['b', 1000, 0], ['a', 1000, 0], ['wait', 500, 3000]]) {
    await db.runAsync('INSERT INTO flight_deletions (flight_id,recording_session_id,deleted_at,next_attempt_at) VALUES (?, ?, ?, ?)', id, id, time, next);
  }
  expect((await db.getAllAsync<{ flight_id: string }>(PENDING_FLIGHT_DELETIONS_SQL, 2000, 2)).map((f) => f.flight_id)).toEqual(['a', 'b']);
  expect(await db.getFirstAsync(COUNT_PENDING_SYNC_SQL)).toEqual({ flights: 0, deletions: 4 });
});

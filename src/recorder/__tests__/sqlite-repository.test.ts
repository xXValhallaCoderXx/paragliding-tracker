import * as SQLite from 'expo-sqlite';
import * as database from '../database.native';
import { TestDatabase, schemaAt, seedSession, seedEvidence, sqliteHarness } from '../../../tests/support/sqlite';
import { BACKFILL_FLIGHTS_SQL } from '../flight-repository-core';
import type { RawLocationFix } from '../repository-core';
import { EquipmentRepositoryCore } from '../equipment-repository-core';
import { finalizeFlightForSession } from '../flight-repository.native';

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
  await schemaAt(db, 11);
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
const equipment = () => {
  let id = 0;
  return new EquipmentRepositoryCore({ uuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    database: { read: async operation => operation(await database.getArchiveDatabase()), write: operation => database.withArchiveWrite(operation) } });
};

it('records aircraft alongside start, leaves legacy unknown, and rejects a stale selection before creating evidence', async () => {
  const inventory = equipment();
  const added = await inventory.saveAircraft({ owner: 'guest', sport: 'speedflying', model: 'Speedwing', size: '12', makeCurrent: true });
  const aircraft = added.aircraft[0]!;
  expect((await database.getFlightBySessionId('session-1'))?.equipmentSnapshot).toBeNull();
  await database.completeSession('session-1', 2000, 'stopped', power);
  const intent = { owner: 'guest', aircraftId: aircraft.id, expectedGeneration: aircraft.generation };
  await inventory.saveAircraft({ owner: 'guest', id: aircraft.id, expectedGeneration: aircraft.generation,
    sport: 'speedflying', model: 'Changed speedwing', size: '12' });
  await expect(database.createSession({ id: 'stale-session', startedAt: 3000, platform: 'android', deviceMetadata: {}, appMetadata: {}, startPower: power,
    equipment: intent })).rejects.toThrow('changed');
  expect(await database.getSession('stale-session')).toBeNull();
  await database.createSession({ id: 'new-session', startedAt: 3000, platform: 'android', deviceMetadata: {}, appMetadata: {}, startPower: power,
    equipment: { ...intent, expectedGeneration: aircraft.generation + 1 } });
  const snapshot = (await database.getSessionExportData('new-session')).equipmentSnapshot;
  expect(snapshot).toMatchObject({ model: 'Changed speedwing', capturedAt: 3000, size: '12', sport: 'speedflying' });
  await inventory.setArchived('guest', aircraft.id, true, aircraft.generation + 1);
  expect((await database.getSessionExportData('new-session')).equipmentSnapshot).toEqual(snapshot);
});

it('records explicit no-aircraft even when a current aircraft exists', async () => {
  await equipment().saveAircraft({ owner: 'guest', sport: 'hang_gliding', model: 'Falcon', makeCurrent: true });
  await database.completeSession('session-1', 2000, 'stopped', power);
  await database.createSession({ id: 'no-aircraft', startedAt: 3000, platform: 'android', deviceMetadata: {}, appMetadata: {}, startPower: power,
    equipment: { owner: 'guest', aircraftId: null } });
  expect((await database.getFlightBySessionId('no-aircraft'))?.equipmentSnapshot).toEqual({
    version: 1, capturedAt: 3000, aircraftId: null, sport: null, model: null, size: null, registrationId: null,
  });
});

it('retains start equipment through interrupted resume and partial finalization after the inventory changes', async () => {
  const inventory = equipment();
  const saved = await inventory.saveAircraft({ owner: 'guest', sport: 'hang_gliding', model: 'Original wing',
    size: '155', registrationId: 'HG-ORIGINAL', makeCurrent: true });
  const aircraft = saved.aircraft[0]!;
  await database.completeSession('session-1', 2000, 'stopped', power);
  await database.createSession({ id: 'resumed-session', startedAt: 3000, platform: 'android',
    deviceMetadata: {}, appMetadata: {}, startPower: power,
    equipment: { owner: 'guest', aircraftId: aircraft.id, expectedGeneration: aircraft.generation } });
  const snapshot = (await database.getFlightBySessionId('resumed-session'))!.equipmentSnapshot;
  expect(snapshot).toMatchObject({ capturedAt: 3000, aircraftId: aircraft.id, model: 'Original wing', registrationId: 'HG-ORIGINAL' });
  await database.markSessionInterrupted('resumed-session', 9000, 'synthetic interruption');
  const edited = await inventory.saveAircraft({ owner: 'guest', id: aircraft.id, expectedGeneration: aircraft.generation,
    sport: 'hang_gliding', model: 'Edited wing', size: '170', registrationId: 'HG-CHANGED' });
  await inventory.setArchived('guest', aircraft.id, true, edited.aircraft[0]!.generation);
  await inventory.saveAircraft({ owner: 'guest', sport: 'speedflying', model: 'Next wing', makeCurrent: true });

  await attempt({ sessionId: 'resumed-session', kind: 'manual' });
  await batch('resume-proof', 11_000, [fix(10_000)]);
  await database.confirmSessionRecoveryAttempt('attempt', 12_000);
  expect(await database.getSession('resumed-session')).toMatchObject({ status: 'recording' });
  expect((await database.getSessionExportData('resumed-session')).equipmentSnapshot).toEqual(snapshot);
  expect(await db.getFirstAsync('SELECT count(*) AS count FROM sessions')).toEqual({ count: 2 });

  await database.markSessionInterrupted('resumed-session', 13_000, 'synthetic second interruption');
  await database.completeSession('resumed-session', 14_000, 'interrupted_finalized', power);
  expect(await finalizeFlightForSession('resumed-session')).toMatchObject({ status: 'partial', equipmentSnapshot: snapshot });
  expect((await database.getSessionExportData('resumed-session')).equipmentSnapshot).toEqual(snapshot);
});

it('claims only guest equipment and retains the last inventory on unlink without moving it on rebind', async () => {
  const inventory = equipment();
  await inventory.saveAircraft({ owner: 'guest', sport: 'paragliding', model: 'Rush', makeCurrent: true });
  await database.bindCloudLink('owner-a');
  expect((await inventory.getInventory()).aircraft).toHaveLength(1);
  await database.resetCloudLink(null);
  expect(await inventory.getActiveOwner()).toBe('owner-a');
  expect((await inventory.getInventory()).aircraft).toHaveLength(1);
  await database.bindCloudLink('owner-b');
  expect((await inventory.getInventory()).aircraft).toEqual([]);
  expect(await db.getAllAsync("SELECT * FROM equipment_entities WHERE owner_key='owner-a' AND kind='aircraft'")).toHaveLength(1);
  await database.resetCloudLink('owner-a');
  expect((await inventory.getInventory()).aircraft).toHaveLength(1);
});

it('rolls back guest ownership and account linking when authorization changes inside the transaction', async () => {
  const inventory = equipment();
  await inventory.saveAircraft({ owner: 'guest', sport: 'paragliding', model: 'Rush' });
  let checks = 0;
  await expect(database.bindCloudLink('owner-a', 3000, () => {
    if (++checks === 4) throw new Error('stale authorization');
  })).rejects.toThrow('stale authorization');
  expect((await database.getCloudLink()).userId).toBeNull();
  expect(await inventory.getActiveOwner()).toBe('guest');
  expect((await inventory.getInventory()).aircraft).toHaveLength(1);
});

it('enforces one unfinished recording and singleton device settings in the applied schema', async () => {
  await expect(seedSession(db, 'second', 'recording')).rejects.toThrow(/UNIQUE/);
  await expect(seedSession(db, 'second', 'interrupted')).rejects.toThrow(/UNIQUE/);
  await expect(db.runAsync('INSERT INTO pilot_profile (id, updated_at) VALUES (2, 0)')).rejects.toThrow(/CHECK/);
  await expect(db.runAsync('INSERT INTO cloud_link (id) VALUES (2)')).rejects.toThrow(/CHECK/);
});

it('stamps only a newly created recording and queues its eligible publication atomically with finalized metrics', async () => {
  await database.completeSession('session-1', 2000, 'stopped', power);
  await db.runAsync("INSERT INTO social_sharing_preferences VALUES ('A', 1, 'generation')");
  await database.createSession({ id: 'new-session', flightId: 'new-flight', startedAt: 3000, platform: 'android',
    deviceMetadata: {}, appMetadata: {}, startPower: power,
    sharingConsent: { ownerUserId: 'A', generation: 'generation', operationId: 'operation' }, sharingConsentCurrent: () => true });
  expect(await db.getAllAsync('SELECT flight_id, owner_user_id, operation_id FROM social_capture_stamps')).toEqual([
    { flight_id: 'new-flight', owner_user_id: 'A', operation_id: 'operation' },
  ]);
  await database.completeSession('new-session', 5000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'new-flight', status: 'completed', endedAt: 5000, updatedAt: 5000 });
  expect(await db.getAllAsync('SELECT * FROM social_publication_intents')).toEqual([]);
  await database.upsertFlightMetrics({ flightId: 'new-flight', algorithmVersion: 1, durationMs: 2000, trackDistanceMetres: 0,
    minGpsAltitude: null, maxGpsAltitude: null, maxGroundSpeed: null, fixCount: 0,
    medianSourceGapMs: null, p95SourceGapMs: null, maxSourceGapMs: null, quality: 'no_track', computedAt: 5000 });
  await db.execAsync("CREATE TRIGGER queue_disk_full BEFORE INSERT ON social_publication_intents BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(database.setFlightStatus({ flightId: 'new-flight', status: 'completed', updatedAt: 6000 })).rejects.toThrow('disk full');
  expect(await db.getFirstAsync("SELECT updated_at FROM flights WHERE id = 'new-flight'")).toEqual({ updated_at: 5000 });
  await db.execAsync('DROP TRIGGER queue_disk_full');
  await database.setFlightStatus({ flightId: 'new-flight', status: 'completed', updatedAt: 6000 });
  await database.setFlightStatus({ flightId: 'new-flight', status: 'completed', updatedAt: 7000 });
  expect(await db.getAllAsync('SELECT flight_id, operation_id, expected_revision, state FROM social_publication_intents')).toEqual([
    { flight_id: 'new-flight', operation_id: 'operation', expected_revision: 0, state: 'pending' },
  ]);
  await database.deleteCompletedFlight('new-flight', 8000);
  expect(await db.getAllAsync('SELECT state FROM social_publication_intents')).toEqual([{ state: 'cancelled' }]);
  expect(await db.getAllAsync('SELECT * FROM social_capture_stamps')).toEqual([]);
});

it('does not stamp a recording when the owner changes while the creation transaction is waiting', async () => {
  await database.completeSession('session-1', 2000, 'stopped', power);
  await db.runAsync("INSERT INTO social_sharing_preferences VALUES ('A', 1, 'generation')");
  await database.createSession({ id: 'new-session', startedAt: 3000, platform: 'android', deviceMetadata: {}, appMetadata: {}, startPower: power,
    sharingConsent: { ownerUserId: 'A', generation: 'generation', operationId: 'operation' }, sharingConsentCurrent: () => false });
  expect(await db.getAllAsync('SELECT * FROM social_capture_stamps')).toEqual([]);
  expect(await database.getSession('new-session')).toMatchObject({ status: 'recording' });
});

it('orders captured metadata edits strictly even in the same millisecond or after a clock rollback', async () => {
  const first = await database.updateFlightMetadata('session-1', { title: 'First' }, 2000);
  const sameMillisecond = await database.updateFlightMetadata('session-1', { title: 'Second' }, 2000);
  const rolledBack = await database.updateFlightMetadata('session-1', { notes: 'Newer edit' }, 1000);
  expect([first.updatedAt, sameMillisecond.updatedAt, rolledBack.updatedAt]).toEqual([2000, 2001, 2002]);
  expect(rolledBack).toMatchObject({ title: 'Second', notes: 'Newer edit' });
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

it('keeps captured ownership immutable and scopes remote deletion without touching active evidence', async () => {
  await database.markFlightCloudOwner('session-1', 'owner-a');
  await database.markFlightCloudOwner('session-1', 'owner-a');
  await expect(database.markFlightCloudOwner('session-1', 'owner-b')).rejects.toThrow('another account');
  await seedEvidence(db);
  expect(await database.deleteCompletedFlight('session-1', 3000, { remoteOwnerUserId: 'owner-a' })).toBe('deferred');
  expect(await database.deleteCompletedFlight('session-1', 3000, { remoteOwnerUserId: 'owner-b' })).toBe('absent');
  expect(await db.getAllAsync('SELECT * FROM location_fixes')).toHaveLength(1);
  await database.completeSession('session-1', 2000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'session-1', status: 'completed', endedAt: 2000, updatedAt: 2000 });
  expect(await database.deleteCompletedFlight('session-1', 3000, { remoteOwnerUserId: 'owner-a', recordingSessionId: 'different' })).toBe('absent');
  expect(await database.deleteCompletedFlight('session-1', 3000, { remoteOwnerUserId: 'owner-a', recordingSessionId: 'session-1' })).toBe('deleted');
  expect(await database.deleteCompletedFlight('session-1', 3000, { remoteOwnerUserId: 'owner-a' })).toBe('absent');
  expect(await database.listPendingFlightDeletions(10)).toEqual([]);
  expect(await db.getFirstAsync('SELECT acknowledged_at FROM archive_deletions')).toEqual({ acknowledged_at: 3000 });
  expect(await database.listPendingFileDeletions()).toEqual(['/private/flight.igc']);
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

it('queues owner-qualified local deletions and removes hidden archive copies atomically', async () => {
  await database.markFlightCloudOwner('session-1', 'owner-a');
  await database.completeSession('session-1', 2000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'session-1', status: 'completed', endedAt: 2000, updatedAt: 2000 });
  await db.runAsync(`INSERT INTO archive_flights (owner_user_id, flight_id, recording_session_id, summary_json, started_at,
    client_updated_at, remote_updated_at, track_state) VALUES ('owner-a', 'session-1', 'session-1', '{}', 1000, 2000, '2026-09-20T00:00:00Z', 'pending')`);
  await database.deleteCompletedFlight('session-1', 3000);
  expect(await db.getAllAsync('SELECT * FROM archive_flights')).toEqual([]);
  expect(await database.listPendingFlightDeletions(10, 4000, { ownerUserId: 'owner-b' })).toEqual([]);
  expect(await database.listPendingFlightDeletions(10, 4000, { ownerUserId: 'owner-a' })).toMatchObject([{ ownerUserId: 'owner-a' }]);
  await database.clearFlightDeletion('session-1', 'owner-b');
  await database.recordFlightDeletionFailure('session-1', 'wrong owner', 9000, 'owner-b');
  expect(await database.listPendingFlightDeletions(10, 4000, { ownerUserId: 'owner-a' })).toMatchObject([{ attemptCount: 0 }]);
  await database.clearFlightDeletion('session-1', 'owner-a');
  expect(await database.listPendingFlightDeletions(10)).toEqual([]);
  expect(await db.getFirstAsync('SELECT owner_user_id, acknowledged_at FROM archive_deletions')).toEqual({ owner_user_id: 'owner-a', acknowledged_at: null });
});

it.each(['local', 'remote'] as const)('removes hidden archive bytes during %s captured deletion with foreign keys disabled', async (origin) => {
  await database.markFlightCloudOwner('session-1', 'owner-a');
  await database.completeSession('session-1', 2000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'session-1', status: 'completed', endedAt: 2000, updatedAt: 2000 });
  for (const owner of ['owner-a', 'owner-b']) {
    await db.runAsync(`INSERT INTO archive_flights (owner_user_id, flight_id, recording_session_id, summary_json, started_at,
      client_updated_at, remote_updated_at, track_state) VALUES (?, 'session-1', 'session-1', '{}', 1000, 2000, '2026-09-20T00:00:00Z', 'ready')`, owner);
    await db.runAsync(`INSERT INTO archive_artifacts (owner_user_id, flight_id, sha256, artifact_version, byte_count, bytes, stored_at)
      VALUES (?, 'session-1', 'digest', 1, 3, ?, 2000)`, owner, new Uint8Array([1, 2, 3]));
  }
  // Match the fresh connection used by Expo's exclusive transactions: foreign keys default to OFF.
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await database.deleteCompletedFlight('session-1', 3000, origin === 'remote' ? { remoteOwnerUserId: 'owner-a' } : undefined);
  await db.execAsync('PRAGMA foreign_keys = ON');
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  expect(await db.getAllAsync('SELECT owner_user_id, flight_id FROM archive_artifacts')).toEqual([
    { owner_user_id: 'owner-b', flight_id: 'session-1' },
  ]);
  expect(await db.getAllAsync('SELECT owner_user_id, flight_id FROM archive_flights')).toEqual([
    { owner_user_id: 'owner-b', flight_id: 'session-1' },
  ]);
  expect(await db.getFirstAsync('SELECT owner_user_id, acknowledged_at FROM archive_deletions')).toEqual({
    owner_user_id: 'owner-a', acknowledged_at: origin === 'remote' ? 3000 : null,
  });
});

it('filters immutable foreign owners before limiting dirty batches and counting pending work', async () => {
  await database.completeSession('session-1', 2000, 'stopped', power);
  await database.setFlightStatus({ flightId: 'session-1', status: 'completed', endedAt: 2000, updatedAt: 2000 });
  await database.markFlightCloudOwner('session-1', 'owner-a');
  await seedSession(db, 'newer', 'completed', 3000); await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await db.runAsync(`INSERT INTO flight_deletions (flight_id, recording_session_id, deleted_at, owner_user_id)
    VALUES ('deleted-a', 'deleted-a', 1000, 'owner-a'), ('deleted-b', 'deleted-b', 1000, 'owner-b'), ('legacy', 'legacy', 1000, NULL)`);
  const batch = await database.listDirtyFlights(1, 5000, { ownerUserId: 'owner-b' });
  expect(batch.map(item => item.id)).toEqual(['newer']);
  expect(await database.countPendingSync('owner-b')).toEqual({ flights: 1, deletions: 1 });
  expect(await database.countPendingSync('owner-a')).toEqual({ flights: 2, deletions: 1 });
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

import * as SQLite from 'expo-sqlite';
import * as database from '../database.native';
import { flightRepository } from '../flight-repository.native';
import { TestDatabase, schemaAt, seedSession, seedEvidence, sqliteHarness } from '../../../tests/support/sqlite';
import { BACKFILL_FLIGHTS_SQL } from '../flight-repository-core';
import { flightMutationGuard, storedFlightMetadata } from '../../lib/flight-mutations';
import { setFlightAuthIdentity, setFlightJournalOwner } from '../../lib/flight-scope';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), backupDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
let harness: ReturnType<typeof sqliteHarness>;
let db: TestDatabase;
beforeAll(async () => {
  harness = sqliteHarness(); jest.mocked(SQLite.openDatabaseAsync).mockImplementation(harness.openDatabaseAsync);
  await database.getLatestSession(); db = harness.databases.get('xc-recorder.db')!;
});
beforeEach(async () => {
  setFlightAuthIdentity(null); setFlightJournalOwner(null);
  for (const { name } of await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    await db.execAsync(`PRAGMA foreign_keys = OFF; DROP TABLE "${name}"; PRAGMA foreign_keys = ON`);
  }
  await schemaAt(db, 11); await seedSession(db, 's', 'completed');
  await db.runAsync("UPDATE sessions SET completion_reason = 'stopped', ended_at = 5000 WHERE id = 's'");
  await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await database.updateFlightMetadata('s', { title: 'Original', site: 'Hill', siteSource: 'paraglidingearth', notes: 'Original note' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => harness.dispose());
async function guard() { const flight = (await database.getFlightDetail('s'))!; return { ...flightMutationGuard(flight), original: storedFlightMetadata(flight) }; }

it('compares only edited fields atomically and returns the newer untouched fields from the transaction', async () => {
  const expected = await guard(); await database.updateFlightMetadata('s', { notes: 'Received from sync', site: 'Valley', siteSource: 'osm' });
  const result = await database.updateFlightMetadata('s', { title: ' My title ' }, 10000, expected);
  expect(result).toMatchObject({ title: 'My title', notes: 'Received from sync', site: 'Valley', siteSource: 'osm' });
});
it('rejects a same-field conflict and treats site name/provenance as a pair', async () => {
  const expected = await guard(); await database.updateFlightMetadata('s', { site: 'Hill', siteSource: 'osm' });
  await expect(database.updateFlightMetadata('s', { site: 'Pilot name', siteSource: 'manual' }, 10000, expected)).rejects.toMatchObject({
    code: 'flight_metadata_conflict', fields: ['site'], saved: { site: 'Hill', siteSource: 'osm' },
  });
  expect((await database.getFlightDetail('s'))?.site).toBe('Hill');
});
it.each(['source', 'recordingSessionId', 'ownerUserId', 'createdAt', 'startedAt'] as const)('rejects a replaced immutable target: %s', async field => {
  const expected = await guard(); Object.assign(expected.target, { [field]: field.endsWith('At') ? -1 : 'different' });
  await expect(database.updateFlightMetadata('s', { title: 'Wrong' }, 10000, expected)).rejects.toThrow('changed');
  await expect(database.deleteCompletedFlight('s', 10000, undefined, expected)).rejects.toThrow('changed');
  expect((await database.getFlightDetail('s'))?.title).toBe('Original');
});
it('rejects queued edit/delete after an auth identity changes away and back', async () => {
  const expected = await guard(); setFlightAuthIdentity('another'); setFlightAuthIdentity(null);
  await expect(database.updateFlightMetadata('s', { title: 'Wrong' }, 10000, expected)).rejects.toThrow('account changed');
  await expect(database.deleteCompletedFlight('s', 10000, undefined, expected)).rejects.toThrow('account changed');
});
it('rejects writes for an unfinished session or an existing deletion', async () => {
  const expected = await guard(); await db.runAsync("UPDATE sessions SET status = 'interrupted' WHERE id = 's'");
  await expect(database.updateFlightMetadata('s', { title: 'Wrong' }, 10000, expected)).rejects.toThrow('Finish saving');
  await db.runAsync("UPDATE sessions SET status = 'completed' WHERE id = 's'");
  await db.runAsync("INSERT INTO flight_deletions (flight_id, recording_session_id, deleted_at) VALUES ('s', 's', 10000)");
  await expect(database.updateFlightMetadata('s', { title: 'Wrong' }, 10000, expected)).rejects.toThrow('deleted');
  await expect(database.deleteCompletedFlight('s', 10000, undefined, expected)).rejects.toThrow('deleted');
});
it.each(['edit', 'delete'])('rolls back %s when identity changes during the transaction', async operation => {
  const expected = await guard();
  const original = TestDatabase.prototype.runAsync;
  jest.spyOn(TestDatabase.prototype, 'runAsync').mockImplementation(async function(this: TestDatabase, sql, ...params) {
    const result = await original.call(this, sql, ...params);
    if (sql.startsWith(operation === 'edit' ? 'UPDATE flights SET title' : 'DELETE FROM flights')) {
      setFlightAuthIdentity('away'); setFlightAuthIdentity(null);
    }
    return result;
  });
  const work = operation === 'edit' ? database.updateFlightMetadata('s', { title: 'Wrong' }, 10000, expected) : database.deleteCompletedFlight('s', 10000, undefined, expected);
  await expect(work).rejects.toThrow('account changed');
  expect((await database.getFlightDetail('s'))?.title).toBe('Original');
  expect(await db.getAllAsync('SELECT * FROM flight_deletions')).toEqual([]);
});
it('returns a committed save even if a subsequent read or artifact sweep would fail', async () => {
  const expected = await guard();
  jest.spyOn(database, 'listPendingFileDeletions').mockRejectedValue(new Error('cleanup failed'));
  jest.spyOn(database, 'getFlightDetail').mockRejectedValue(new Error('read failed'));
  await expect(flightRepository.updateFlight('s', { title: 'Saved' }, expected)).resolves.toMatchObject({ title: 'Saved' });
});
it('returns a committed deletion and leaves file cleanup queued when enumeration fails', async () => {
  await seedEvidence(db, 's'); const expected = await guard();
  jest.spyOn(database, 'listPendingFileDeletions').mockRejectedValue(new Error('cleanup failed'));
  await expect(flightRepository.deleteFlight('s', expected)).resolves.toBeUndefined();
  expect(await database.getFlightDetail('s')).toBeNull();
  expect(await db.getAllAsync('SELECT path FROM pending_file_deletions')).toEqual([{ path: '/private/flight.igc' }]);
  expect(await db.getAllAsync('SELECT flight_id FROM flight_deletions')).toEqual([{ flight_id: 's' }]);
});

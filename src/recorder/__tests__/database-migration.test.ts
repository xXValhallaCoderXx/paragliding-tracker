import * as SQLite from 'expo-sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestDatabase, schemaAt, seedEvidence, seedSession, sqliteHarness } from '../../../tests/support/sqlite';
import { migrateDatabase } from '../database.native';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), backupDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
let harness: ReturnType<typeof sqliteHarness>;
let db: TestDatabase;
beforeEach(() => {
  harness = sqliteHarness(); db = new TestDatabase();
  jest.mocked(SQLite.openDatabaseAsync).mockImplementation(harness.openDatabaseAsync);
  jest.mocked(SQLite.backupDatabaseAsync).mockImplementation(harness.backupDatabaseAsync as never);
  jest.mocked(SQLite.deleteDatabaseAsync).mockImplementation(harness.deleteDatabaseAsync);
});
afterEach(async () => { await db.closeAsync(); await harness.dispose(); jest.resetAllMocks(); });

it('creates an empty database and validates it again without a backup', async () => {
  await migrateDatabase(db.asExpo()); await migrateDatabase(db.asExpo());
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 7 });
  expect(await db.getFirstAsync('SELECT id, registration_id FROM pilot_profile')).toEqual({ id: 1, registration_id: null });
  expect(harness.backupDatabaseAsync).not.toHaveBeenCalled();
});

it.each([0, 1, 2, 3, 4, 5, 6, 7])('upgrades version %i with all recording evidence intact', async (version) => {
  await schemaAt(db, 1); await seedSession(db); await seedEvidence(db);
  await seedSession(db, 'session-closed', 'completed'); await seedEvidence(db, 'session-closed');
  await db.runAsync("UPDATE sessions SET completion_reason = 'stopped', ended_at = 2000 WHERE id = 'session-closed'");
  for (let next = 2; next <= version; next++) {
    const { getSchemaMigrationSteps } = jest.requireActual('../flight-repository-core');
    for (const step of getSchemaMigrationSteps(next - 1, false).filter((s: { version: number }) => s.version === next)) {
      for (const sql of step.statements) await db.execAsync(sql);
    }
  }
  await db.execAsync(`PRAGMA user_version = ${version}`);
  if (version >= 2) await db.runAsync("UPDATE flights SET title = 'Saved title', site = 'Saved site', notes = 'Private notes'");
  const tables = ['sessions', 'location_fixes', 'pressure_samples', 'events', 'exports'];
  const before = await Promise.all(tables.map((table) => db.getAllAsync(`SELECT * FROM ${table}`)));
  await migrateDatabase(db.asExpo());
  for (const [i, table] of tables.entries()) {
    expect(await db.getAllAsync(`SELECT * FROM ${table}`)).toEqual(before[i].map((row) => expect.objectContaining(row as object)));
  }
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 7 });
  expect(await db.getAllAsync('SELECT recording_session_id, status FROM flights ORDER BY recording_session_id')).toEqual([
    { recording_session_id: 'session-1', status: 'recording' },
    { recording_session_id: 'session-closed', status: 'completed' },
  ]);
  if (version >= 2) expect(await db.getFirstAsync('SELECT title, site, notes, site_source FROM flights')).toMatchObject({
    title: 'Saved title', site: 'Saved site', notes: 'Private notes', ...(version < 6 ? { site_source: 'manual' } : {}),
  });
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  expect(readdirSync(harness.directory)).toEqual([]);
});

it.each([
  [1, 'DROP TABLE exports', 'exports'],
  [2, 'ALTER TABLE flights DROP COLUMN notes', 'notes'],
  [3, 'DROP INDEX location_fixes_eligible_receipt_order', 'location_fixes_eligible_receipt_order'],
  [4, 'DROP TABLE session_recovery_attempts', 'session_recovery_attempts'],
  [5, 'DROP TABLE flight_sync_state', 'flight_sync_state'],
  [6, 'DROP TABLE app_settings', 'app_settings'],
  [7, 'DROP TABLE flight_tracks', 'flight_tracks'],
] as const)('rejects incomplete version %i before modifying it', async (version, damage, missing) => {
  await schemaAt(db, version); await db.execAsync(damage);
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow(missing);
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: version });
  expect(harness.backupDatabaseAsync).not.toHaveBeenCalled();
});

it('rejects an unknown unversioned schema and a newer version', async () => {
  await db.execAsync('CREATE TABLE unrelated (id INTEGER)');
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('sessions');
  await db.execAsync('PRAGMA user_version = 99');
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('newer than supported');
});

it('rolls back failed migration SQL and retains a readable pre-migration backup', async () => {
  await schemaAt(db, 5); await seedSession(db); await seedEvidence(db);
  // Missing flight backfill fails the production postcondition after all DDL executed.
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('Migration backup retained');
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 5 });
  expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'flight_tracks'")).toBeNull();
  const [name] = readdirSync(harness.directory);
  const saved = new TestDatabase(join(harness.directory, name));
  try {
    expect(await saved.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 5 });
    expect(await saved.getFirstAsync('SELECT source_timestamp FROM location_fixes')).toEqual({ source_timestamp: 1100 });
  } finally { await saved.closeAsync(); }
});

it('abandons migration and deletes an incomplete backup on backup failure', async () => {
  await schemaAt(db, 5);
  harness.backupDatabaseAsync.mockRejectedValueOnce(new Error('disk full'));
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('disk full');
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 5 });
  expect(readdirSync(harness.directory)).toEqual([]);
});

it('reports cleanup failure while retaining the completed migration and backup', async () => {
  await schemaAt(db, 5);
  harness.deleteDatabaseAsync.mockRejectedValueOnce(new Error('cannot remove backup'));
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('Migration backup retained');
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 7 });
  expect(existsSync(join(harness.directory, readdirSync(harness.directory)[0]))).toBe(true);
});

it('rejects real foreign-key corruption in a current database', async () => {
  await schemaAt(db, 7);
  await db.execAsync("PRAGMA foreign_keys = OFF; INSERT INTO flight_tracks VALUES ('missing', '[]', 1, 0); PRAGMA foreign_keys = ON");
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('foreign_key_check');
});

import * as SQLite from 'expo-sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestDatabase, schemaAt, seedEvidence, seedSession, sqliteHarness } from '../../../tests/support/sqlite';
import { migrateDatabase } from '../database.native';
import { BACKFILL_FLIGHTS_SQL } from '../flight-repository-core';

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
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 10 });
  expect(await db.getFirstAsync('SELECT id, registration_id FROM pilot_profile')).toEqual({ id: 1, registration_id: null });
  expect(harness.backupDatabaseAsync).not.toHaveBeenCalled();
});

it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('upgrades version %i with all recording evidence intact', async (version) => {
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
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 10 });
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
  [8, 'DROP INDEX location_fixes_map_source_order', 'location_fixes_map_source_order'],
  [10, 'DROP TABLE social_capture_stamps', 'social_capture_stamps'],
  [10, 'DROP INDEX social_publication_retry_order', 'social_publication_retry_order'],
  [9, 'DROP TABLE archive_artifacts', 'archive_artifacts'],
  [9, 'DROP INDEX archive_flights_owner_order', 'archive_flights_owner_order'],
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
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 10 });
  expect(existsSync(join(harness.directory, readdirSync(harness.directory)[0]))).toBe(true);
});

it('rejects real foreign-key corruption in a current database', async () => {
  await schemaAt(db, 8);
  await db.execAsync("PRAGMA foreign_keys = OFF; INSERT INTO flight_tracks VALUES ('missing', '[]', 1, 0); PRAGMA foreign_keys = ON");
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('foreign_key_check');
});

it('backfills ownership only from a linked account with positive sync evidence and never claims old deletions', async () => {
  await schemaAt(db, 1); await seedSession(db, 'uploaded', 'completed'); await seedSession(db, 'never-uploaded', 'completed');
  const { getSchemaMigrationSteps } = jest.requireActual('../flight-repository-core');
  for (const step of getSchemaMigrationSteps(1, false).filter((step: { version: number }) => step.version <= 8)) {
    for (const sql of step.statements) await db.execAsync(sql);
  }
  await db.execAsync('PRAGMA user_version = 8');
  await db.runAsync("UPDATE cloud_link SET user_id = 'owner-a' WHERE id = 1");
  await db.runAsync("INSERT INTO flight_sync_state (flight_id, pushed_updated_at) VALUES ('uploaded', 2000)");
  await db.runAsync("INSERT INTO flight_sync_state (flight_id, last_error) VALUES ('never-uploaded', 'offline')");
  await db.runAsync("INSERT INTO flight_deletions (flight_id, recording_session_id, deleted_at) VALUES ('old', 'old-session', 1000)");
  await migrateDatabase(db.asExpo());
  expect(await db.getAllAsync('SELECT id, cloud_owner_user_id FROM flights ORDER BY id')).toEqual([
    { id: 'never-uploaded', cloud_owner_user_id: null }, { id: 'uploaded', cloud_owner_user_id: 'owner-a' },
  ]);
  expect(await db.getFirstAsync('SELECT owner_user_id FROM flight_deletions')).toEqual({ owner_user_id: null });
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 10 });
});

async function orphanedArchive(owner: string, id: string) {
  await db.execAsync('PRAGMA foreign_keys = OFF');
  await db.runAsync(`INSERT INTO archive_artifacts
    (owner_user_id, flight_id, sha256, artifact_version, byte_count, bytes, stored_at)
    VALUES (?, ?, 'original-hash', 1, 1, X'01', 1000)`, owner, id);
  await db.execAsync('PRAGMA foreign_keys = ON');
}

async function archiveDeletion(owner: string, id: string) {
  await db.runAsync(`INSERT INTO archive_deletions (owner_user_id, flight_id, deleted_at)
    VALUES (?, ?, 2000)`, owner, id);
}

it('finishes receipt-authorized orphan cleanup on restart with a readable backup and all other data intact', async () => {
  await schemaAt(db, 9); await seedSession(db); await seedEvidence(db);
  await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await orphanedArchive('A', 'deleted'); await archiveDeletion('A', 'deleted');
  await db.runAsync(`INSERT INTO archive_flights
    (owner_user_id, flight_id, recording_session_id, summary_json, started_at, client_updated_at, remote_updated_at, track_state)
    VALUES ('B', 'deleted', 'other-session', '{}', 1000, 1000, '2026-09-20', 'ready')`);
  await orphanedArchive('B', 'deleted');
  const tables = ['sessions', 'location_fixes', 'pressure_samples', 'events', 'exports', 'archive_deletions', 'archive_flights'];
  const before = await Promise.all(tables.map(table => db.getAllAsync(`SELECT * FROM ${table}`)));
  await migrateDatabase(db.asExpo());
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  expect(await db.getAllAsync('SELECT owner_user_id, hex(bytes) AS bytes FROM archive_artifacts')).toEqual([{ owner_user_id: 'B', bytes: '01' }]);
  for (const [index, table] of tables.entries()) expect(await db.getAllAsync(`SELECT * FROM ${table}`)).toEqual(before[index]);
  const [name] = readdirSync(harness.directory);
  expect(name).toContain('v9-to-v10-archive-cleanup');
  const backup = new TestDatabase(join(harness.directory, name));
  try {
    expect(await backup.getAllAsync('SELECT owner_user_id FROM archive_artifacts ORDER BY owner_user_id')).toEqual([{ owner_user_id: 'A' }, { owner_user_id: 'B' }]);
    expect(await backup.getAllAsync('SELECT * FROM location_fixes')).toEqual(before[1]);
  } finally { await backup.closeAsync(); }
  await migrateDatabase(db.asExpo());
  expect(harness.backupDatabaseAsync).toHaveBeenCalledTimes(2);
});

it.each([null, 'B'])('does not remove an orphan without an exact owner deletion receipt (%s)', async receiptOwner => {
  await schemaAt(db, 9); await orphanedArchive('A', 'unproven');
  if (receiptOwner) await archiveDeletion(receiptOwner, 'unproven');
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('foreign_key_check');
  expect(await db.getFirstAsync('SELECT hex(bytes) AS bytes FROM archive_artifacts')).toEqual({ bytes: '01' });
  expect(harness.backupDatabaseAsync).not.toHaveBeenCalled();
});

it('rolls back archive cleanup when another integrity violation remains', async () => {
  await schemaAt(db, 9); await orphanedArchive('A', 'deleted'); await archiveDeletion('A', 'deleted');
  await db.execAsync("PRAGMA foreign_keys = OFF; INSERT INTO flight_tracks VALUES ('missing', '[]', 1, 0); PRAGMA foreign_keys = ON");
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('Archive cleanup backup retained');
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toHaveLength(2);
  expect(readdirSync(harness.directory)).toHaveLength(1);
});

it('leaves an authorized orphan intact when its recovery backup cannot be written', async () => {
  await schemaAt(db, 9); await orphanedArchive('A', 'deleted'); await archiveDeletion('A', 'deleted');
  harness.backupDatabaseAsync.mockRejectedValueOnce(new Error('disk full'));
  await expect(migrateDatabase(db.asExpo())).rejects.toThrow('disk full');
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toHaveLength(1);
  expect(await db.getFirstAsync('SELECT hex(bytes) AS bytes FROM archive_artifacts')).toEqual({ bytes: '01' });
});

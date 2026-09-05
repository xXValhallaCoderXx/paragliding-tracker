import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSchemaMigrationSteps } from '@/recorder/flight-repository-core';

// Load Node's engine directly: jest-expo still owns transforms and native mocks.
const { DatabaseSync, backup } = process.getBuiltinModule('node:sqlite');

export class TestDatabase {
  readonly connection;
  constructor(readonly path = ':memory:') {
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = OFF');
  }
  async execAsync(sql: string) { this.connection.exec(sql); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.connection.prepare(sql).get(...params as SQLInputValue[]) as T) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.connection.prepare(sql).all(...params as SQLInputValue[]) as T[];
  }
  async runAsync(sql: string, ...params: unknown[]) {
    const result = this.connection.prepare(sql).run(...params as SQLInputValue[]);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }
  async withExclusiveTransactionAsync(task: (transaction: TestDatabase) => Promise<void>) {
    this.connection.exec('BEGIN IMMEDIATE');
    try { await task(this); this.connection.exec('COMMIT'); }
    catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  async closeAsync() { if (this.connection.isOpen) this.connection.close(); }
  asExpo(): SQLiteDatabase { return this as unknown as SQLiteDatabase; }
}

/** A private file directory also lets migration tests inspect retained real backups. */
export function sqliteHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'xc-sqlite-'));
  const databases = new Map<string, TestDatabase>();
  const openDatabaseAsync = jest.fn(async (name: string) => {
    const database = new TestDatabase(join(directory, name));
    databases.set(name, database);
    return database.asExpo();
  });
  const backupDatabaseAsync = jest.fn(async ({ sourceDatabase, destDatabase }: {
    sourceDatabase: TestDatabase; destDatabase: TestDatabase;
  }) => { await backup(sourceDatabase.connection, destDatabase.path); });
  const deleteDatabaseAsync = jest.fn(async (name: string) => {
    await databases.get(name)?.closeAsync();
    rmSync(join(directory, name), { force: true });
  });
  return {
    directory, databases, openDatabaseAsync, backupDatabaseAsync, deleteDatabaseAsync,
    async dispose() {
      for (const database of databases.values()) await database.closeAsync();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Build historical databases from shipped SQL, never from expected-schema constants. */
export async function schemaAt(database: TestDatabase, version: number) {
  for (const step of getSchemaMigrationSteps(0, true).filter((step) => step.version <= version)) {
    for (const statement of step.statements) await database.execAsync(statement);
  }
  await database.execAsync(`PRAGMA user_version = ${version}`);
}

export async function seedSession(database: TestDatabase, id = 'session-1', status = 'recording', start = 1000) {
  await database.runAsync(`INSERT INTO sessions
    (id, status, started_at, updated_at, platform, device_metadata_json, app_metadata_json, start_power_json)
    VALUES (?, ?, ?, ?, 'android', '{}', '{}', '{}')`, id, status, start, start);
}

export async function seedEvidence(database: TestDatabase, id = 'session-1') {
  await database.runAsync(`INSERT INTO location_fixes
    (session_id, sequence, callback_id, batch_index, source_timestamp, receipt_timestamp, latitude, longitude)
    VALUES (?, 1, 'initial', 0, 1100, 1200, 46, 8)`, id);
  await database.runAsync(`INSERT INTO pressure_samples
    (session_id, sequence, native_timestamp, receipt_timestamp, pressure) VALUES (?, 1, 1100, 1200, 1000)`, id);
  await database.runAsync(`INSERT INTO events
    (session_id, event_type, occurred_at, payload_json) VALUES (?, 'location_callback', 1200, '{}')`, id);
  await database.runAsync(`INSERT INTO exports
    (session_id, kind, artifact_version, path, sha256, byte_count, eligible_fix_count, created_at)
    VALUES (?, 'igc', 1, '/private/flight.igc', 'digest', 123, 1, 1200)`, id);
  await database.runAsync('UPDATE sessions SET location_sequence = 1, last_fix_at = 1100 WHERE id = ?', id);
}

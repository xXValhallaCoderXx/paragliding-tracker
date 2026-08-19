import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The client push payload and the server schema have to agree exactly, and nothing else
 * checks that: a column the app sends but the table lacks fails at runtime as an opaque
 * PostgREST error, on a real device, only once a flight is actually pushed.
 *
 * These tests read both sides from source and compare them, so the drift is caught here
 * instead of in the field.
 */

const MIGRATIONS = join('supabase', 'migrations');

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

/** Column names from a `create table public.<name> ( ... );` block. */
function tableColumns(sql: string, table: string): Set<string> {
  const start = sql.indexOf(`create table public.${table} (`);
  if (start < 0) throw new Error(`No create table for public.${table}`);
  const body = sql.slice(start + `create table public.${table} (`.length);
  const end = body.indexOf('\n);');
  if (end < 0) throw new Error(`Unterminated create table for public.${table}`);

  const columns = new Set<string>();
  for (const rawLine of body.slice(0, end).split('\n')) {
    const line = rawLine.replace(/--.*$/, '').trim();
    if (line.length === 0) continue;
    // Skip table-level constraints and index-ish clauses.
    if (/^(constraint|unique|primary key|foreign key|check)\b/i.test(line)) continue;
    const name = /^([a-z_][a-z0-9_]*)\s/.exec(line)?.[1];
    if (name) columns.add(name);
  }
  return columns;
}

/** Keys of the object literal returned by `flightRow` in the sync engine. */
function flightRowKeys(): string[] {
  const source = readFileSync('src/cloud/sync-engine.native.ts', 'utf8');
  const start = source.indexOf('function flightRow(');
  expect(start).toBeGreaterThanOrEqual(0);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^\s{4}([a-z_][a-z0-9_]*):/gm)].map((match) => match[1]!);
}

describe('client push payload matches the server schema', () => {
  const sql = migrationSql();

  it('every column the app writes to flights exists on the table', () => {
    const columns = tableColumns(sql, 'flights');
    const keys = flightRowKeys();

    // Sanity: the parser found a real payload and a real table, not empty sets.
    expect(keys.length).toBeGreaterThan(20);
    expect(columns.size).toBeGreaterThan(20);

    expect(keys.filter((key) => !columns.has(key))).toEqual([]);
  });

  it('every column the app writes to profiles exists on the table', () => {
    const columns = tableColumns(sql, 'profiles');
    for (const column of ['id', 'pilot_name', 'glider_type', 'glider_id', 'home_site', 'client_updated_at']) {
      expect({ column, present: columns.has(column) }).toEqual({ column, present: true });
    }
  });

  it('the IGC columns updated after upload exist', () => {
    const columns = tableColumns(sql, 'flights');
    for (const column of ['igc_object_path', 'igc_sha256', 'igc_byte_count', 'igc_artifact_version']) {
      expect({ column, present: columns.has(column) }).toEqual({ column, present: true });
    }
  });

  it('the columns the pull query selects exist', () => {
    const columns = tableColumns(sql, 'flights');
    for (const column of ['id', 'title', 'site', 'notes', 'client_updated_at', 'updated_at']) {
      expect({ column, present: columns.has(column) }).toEqual({ column, present: true });
    }
  });

  it('the app never sends the server-owned pull cursor', () => {
    // updated_at is maintained by a trigger. A client that wrote it could stamp a value
    // another device's cursor has already passed, and that flight would never be pulled.
    expect(flightRowKeys()).not.toContain('updated_at');
    expect(flightRowKeys()).not.toContain('created_at');
  });

  it('the storage bucket the engine writes to is the one the migration creates', () => {
    const config = readFileSync('src/cloud/config.ts', 'utf8');
    const bucket = /igcBucket:\s*'([^']+)'/.exec(config)?.[1];
    expect(bucket).toBe('flight-igc');
    expect(sql).toContain(`values (\n  '${bucket}',`);
  });

  it('RLS is enabled on every table the app touches', () => {
    // Without this the publishable key, which ships in the bundle, would read everything.
    expect(sql).toContain('alter table public.profiles enable row level security');
    expect(sql).toContain('alter table public.flights  enable row level security');
    expect(sql).toContain('revoke all on public.profiles from anon');
    expect(sql).toContain('revoke all on public.flights  from anon');
  });
});

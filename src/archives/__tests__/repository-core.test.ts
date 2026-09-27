import { flightMutationGuard, storedFlightMetadata } from '../../lib/flight-mutations';
import { setFlightAuthIdentity, setFlightJournalOwner } from '../../lib/flight-scope';
import { createHash } from 'node:crypto';
import { TestDatabase, schemaAt, seedSession } from '../../../tests/support/sqlite';
import { BACKFILL_FLIGHTS_SQL } from '../../recorder/flight-repository-core';
import { ArchiveRepositoryCore, type ArchiveRepositoryDependencies } from '../repository-core';
import type { ArchiveRemoteFlight } from '../types';

const bytes = new Uint8Array([65, 66, 67]);
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const remote = (overrides: Partial<ArchiveRemoteFlight> = {}): ArchiveRemoteFlight => ({
  id: 'flight-1', user_id: 'owner-a', recording_session_id: 'session-remote', status: 'completed',
  started_at: 1000, ended_at: 2000, client_created_at: 1000, client_updated_at: 2000,
  created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', title: 'Original', site: null, site_source: null, notes: null,
  device_platform: 'android', recorder_schema_version: 8, timezone_offset_minutes: 480,
  duration_ms: 1000, track_distance_metres: 120, fix_count: 2, metrics_algorithm_version: 1, metrics_computed_at: 2000,
  min_gps_altitude: null, max_gps_altitude: null, max_ground_speed: null, median_source_gap_ms: null, p95_source_gap_ms: null,
  max_source_gap_ms: null, quality: 'healthy', igc_object_path: 'owner-a/flight-1.igc', igc_sha256: sha(bytes), igc_byte_count: bytes.length,
  igc_artifact_version: 1, ...overrides,
});
let db: TestDatabase;
let repository: ArchiveRepositoryCore;
const makeRepository = (overrides: Partial<ArchiveRepositoryDependencies> = {}) => new ArchiveRepositoryCore({
  database: {
    read: operation => operation(db),
    write: async operation => { let result!: Awaited<ReturnType<typeof operation>>;
      await db.withExclusiveTransactionAsync(async transaction => { result = await operation(transaction); }); return result; },
  },
  sha256: async value => sha(value), now: () => 3000, deriveTrack: () => [[1, 2, 3, 4]], ...overrides,
});
beforeEach(async () => { db = new TestDatabase(); await schemaAt(db, 9); repository = makeRepository(); });
afterEach(async () => db.closeAsync());

it('restores the frozen equipment snapshot independently of inventory and preserves it through metadata editing', async () => {
  const equipment = { version: 1, capturedAt: 1000, aircraftId: 'aircraft', sport: 'speedflying', model: 'Wing', size: '12', registrationId: null };
  await repository.upsertRemote('owner-a', remote({ equipment_snapshot: equipment }));
  expect((await repository.get('owner-a', 'flight-1'))?.equipmentSnapshot).toEqual(equipment);
  await repository.updateMetadata('owner-a', 'flight-1', { title: 'New title' });
  expect((await repository.get('owner-a', 'flight-1'))?.equipmentSnapshot).toEqual(equipment);
  await expect(repository.upsertRemote('owner-a', remote({ equipment_snapshot: { ...equipment, version: 9 } }))).rejects.toThrow('snapshot');
});

it('restores summaries without inventing sessions or raw capture evidence and isolates owners', async () => {
  await repository.upsertRemote('owner-a', remote());
  expect(await repository.get('owner-a', 'flight-1')).toMatchObject({ source: 'archive', session: null, sessionStatus: null,
    recordingSessionId: 'session-remote', archive: { trackState: 'pending' } });
  expect(await repository.list('owner-b')).toEqual([]);
  expect(await repository.readIgc('owner-b', 'flight-1')).toBeNull();
  await expect(repository.upsertRemote('owner-b', remote())).rejects.toThrow('another account');
  for (const table of ['sessions', 'location_fixes', 'pressure_samples', 'events', 'exports']) expect(await db.getAllAsync(`SELECT * FROM ${table}`)).toEqual([]);
  await seedSession(db, 'session-remote', 'completed'); await db.execAsync(BACKFILL_FLIGHTS_SQL);
  expect(await repository.list('owner-a')).toEqual([]);
  expect(await repository.listPendingDownloads('owner-a')).toEqual([]);
});

it('atomically commits only hash-verified bytes and derives thumbnails before taking a write lock', async () => {
  await repository.upsertRemote('owner-a', remote());
  await expect(repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), new Uint8Array([1, 2, 3]))).rejects.toThrow('integrity');
  expect(await repository.readIgc('owner-a', 'flight-1')).toBeNull();
  expect(await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes, 1)).toBe(true);
  expect(await repository.readIgc('owner-a', 'flight-1')).toEqual(bytes);
  expect(await repository.listTracks('owner-a')).toEqual({ 'flight-1': [[1, 2, 3, 4]] });
  expect(await repository.getTrack('owner-a', 'flight-1')).toEqual([[1, 2, 3, 4]]);
  expect(await repository.listPendingDownloads('owner-a')).toEqual([]);
  expect((await repository.get('owner-a', 'flight-1'))?.archive).toEqual({ trackState: 'ready', downloadedAt: 3000, error: null });
});

it('retains the previous verified export and thumbnail across replacement failures', async () => {
  await repository.upsertRemote('owner-a', remote()); await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes);
  const replacement = new Uint8Array([68, 69, 70]);
  await repository.upsertRemote('owner-a', remote({ igc_sha256: sha(replacement), igc_artifact_version: 2, updated_at: '2026-09-20T00:01:00Z' }));
  await expect(repository.storeVerifiedIgc('owner-a', 'flight-1', sha(replacement), bytes, 2)).rejects.toThrow('integrity');
  await repository.recordDownloadFailure('owner-a', 'flight-1', 'interrupted');
  expect(await repository.readIgc('owner-a', 'flight-1')).toEqual(bytes);
  expect(await repository.getTrack('owner-a', 'flight-1')).toEqual([[1, 2, 3, 4]]);
  expect((await repository.get('owner-a', 'flight-1'))?.archive).toEqual({ trackState: 'error', downloadedAt: 3000, error: 'interrupted' });
  expect(await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(replacement), replacement, 2)).toBe(true);
  expect(await repository.readIgc('owner-a', 'flight-1')).toEqual(replacement);
});

it('keeps verified originals when their IGC cannot produce a replay', async () => {
  repository = makeRepository({ deriveTrack: () => { throw new Error('Malformed IGC'); } });
  await repository.upsertRemote('owner-a', remote()); await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes);
  expect(await repository.readIgc('owner-a', 'flight-1')).toEqual(bytes);
  expect(await repository.getTrack('owner-a', 'flight-1')).toEqual([]);
});

it('rejects a commit if its manifest changed while verification was in progress', async () => {
  repository = makeRepository({ sha256: async value => {
    await repository.upsertRemote('owner-a', remote({ igc_artifact_version: 2, updated_at: '2026-09-20T00:01:00Z' })); return sha(value);
  } });
  await repository.upsertRemote('owner-a', remote());
  expect(await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes, 1)).toBe(false);
  expect(await repository.readIgc('owner-a', 'flight-1')).toBeNull();
});

it('guards cancellation immediately before commit and cannot resurrect a deletion during hashing', async () => {
  await repository.upsertRemote('owner-a', remote());
  expect(await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes, 1, () => false)).toBe(false);
  repository = makeRepository({ sha256: async value => { await repository.deleteLocal('owner-a', 'flight-1'); return sha(value); } });
  expect(await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes, 1)).toBe(false);
  expect(await repository.upsertRemote('owner-a', remote({ updated_at: '2026-09-21T00:00:00Z' }))).toBe(false);
  expect(await repository.readIgc('owner-a', 'flight-1')).toBeNull();
});

it('preserves edits made during upload and adopts canonical server ties only for the uploaded version', async () => {
  await repository.upsertRemote('owner-a', remote());
  const first = await repository.updateMetadata('owner-a', 'flight-1', { title: ' Local ', site: ' New site ' });
  expect(first).toMatchObject({ title: 'Local', site: 'New site', siteSource: 'manual', updatedAt: 3000 });
  await repository.upsertRemote('owner-a', remote({ title: 'Server tie', client_updated_at: 3000 }));
  expect((await repository.get('owner-a', 'flight-1'))?.title).toBe('Local');
  const second = await repository.updateMetadata('owner-a', 'flight-1', { title: 'Second' });
  await repository.upsertRemote('owner-a', remote({ title: 'Server tie', client_updated_at: 3000 }), first.updatedAt);
  await repository.markMetadataPushed('owner-a', 'flight-1', first.updatedAt, '2026-09-20T00:00:01Z');
  expect((await repository.listDirtyMetadata('owner-a'))[0]).toMatchObject({ title: 'Second', dirtyUpdatedAt: second.updatedAt });
  await repository.upsertRemote('owner-a', remote({ title: 'Canonical', client_updated_at: second.updatedAt }), second.updatedAt);
  expect((await repository.get('owner-a', 'flight-1'))?.title).toBe('Canonical');
  expect(await repository.listDirtyMetadata('owner-a')).toEqual([]);
});

it('preserves an edit made during upload even if the canonical server row has a later client clock', async () => {
  await repository.upsertRemote('owner-a', remote());
  const dispatched = await repository.updateMetadata('owner-a', 'flight-1', { title: 'Uploading' });
  const editedAgain = await repository.updateMetadata('owner-a', 'flight-1', { title: 'Keep this draft', notes: 'New note' });
  await repository.upsertRemote('owner-a', remote({ title: 'Ahead on another phone', client_updated_at: 99_000,
    updated_at: '2026-09-20T00:01:00Z' }), dispatched.updatedAt);
  await repository.markMetadataPushed('owner-a', 'flight-1', dispatched.updatedAt, '2026-09-20T00:01:00Z');
  await repository.upsertRemote('owner-a', remote({ title: 'Ahead on another phone', client_updated_at: 99_000,
    updated_at: '2026-09-20T00:01:00Z' }));
  expect((await repository.listDirtyMetadata('owner-a'))[0]).toMatchObject({ title: 'Keep this draft', notes: 'New note', dirtyUpdatedAt: editedAgain.updatedAt });
});

it('durably scopes deletion receipts and outbox retries to the owner', async () => {
  await repository.upsertRemote('owner-a', remote()); await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes);
  await repository.deleteLocal('owner-a', 'flight-1');
  expect(await db.getAllAsync('SELECT * FROM archive_artifacts')).toEqual([]);
  expect(await repository.listPendingDeletions('owner-b')).toEqual([]);
  await repository.recordDeletionFailure('owner-a', 'flight-1', 'offline', 5000);
  expect(await repository.listPendingDeletions('owner-a')).toEqual([]);
  expect(await repository.listPendingDeletions('owner-a', 10, 3000, true)).toMatchObject([{ attemptCount: 1, lastError: 'offline' }]);
  await repository.acknowledgeDeletion('owner-b', 'flight-1', 3000);
  expect(await repository.listPendingDeletions('owner-a', 10, 5000)).toHaveLength(1);
  await repository.acknowledgeDeletion('owner-a', 'flight-1', 3000);
  expect(await repository.listPendingDeletions('owner-a', 10, 5000)).toEqual([]);
  expect(await repository.upsertRemote('owner-a', remote())).toBe(false);
  await repository.applyRemoteDeletion('owner-b', 'absent', null, 4000);
  expect(await repository.listPendingDeletions('owner-b')).toEqual([]);
});

it.each(['local', 'remote'] as const)('deletes %s archive bytes without depending on connection-local foreign keys', async (origin) => {
  for (const owner of ['owner-a', 'owner-b']) {
    await repository.upsertRemote(owner, remote({ user_id: owner, igc_object_path: `${owner}/flight-1.igc` }));
    await repository.storeVerifiedIgc(owner, 'flight-1', sha(bytes), bytes);
  }
  // Expo's exclusive transaction opens a connection that does not inherit the main connection's PRAGMA.
  await db.execAsync('PRAGMA foreign_keys = OFF');
  if (origin === 'local') await repository.deleteLocal('owner-a', 'flight-1');
  else await repository.applyRemoteDeletion('owner-a', 'flight-1', 'session-remote', 3000);
  await db.execAsync('PRAGMA foreign_keys = ON');
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
  expect(await db.getAllAsync('SELECT owner_user_id, flight_id FROM archive_artifacts')).toEqual([
    { owner_user_id: 'owner-b', flight_id: 'flight-1' },
  ]);
  expect(await repository.readIgc('owner-b', 'flight-1')).toEqual(bytes);
  expect(await repository.get('owner-a', 'flight-1')).toBeNull();
  expect(await repository.upsertRemote('owner-a', remote())).toBe(false);
});

it.each(['local', 'remote'] as const)('rolls back %s archive deletion when its summary cannot be removed', async (origin) => {
  await repository.upsertRemote('owner-a', remote());
  await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes);
  await db.execAsync(`PRAGMA foreign_keys = OFF;
    CREATE TRIGGER reject_archive_delete BEFORE DELETE ON archive_flights BEGIN SELECT RAISE(ABORT, 'delete failed'); END`);
  const deletion = origin === 'local'
    ? repository.deleteLocal('owner-a', 'flight-1')
    : repository.applyRemoteDeletion('owner-a', 'flight-1', 'session-remote', 3000);
  await expect(deletion).rejects.toThrow('delete failed');
  await db.execAsync('PRAGMA foreign_keys = ON');
  expect(await repository.readIgc('owner-a', 'flight-1')).toEqual(bytes);
  expect((await repository.get('owner-a', 'flight-1'))?.archive.trackState).toBe('ready');
  expect(await db.getAllAsync('SELECT * FROM archive_deletions')).toEqual([]);
  expect(await db.getAllAsync('PRAGMA foreign_key_check')).toEqual([]);
});

it('suppresses a late captured-upload response using its owner-qualified recorder deletion receipt', async () => {
  await db.runAsync(`INSERT INTO flight_deletions (flight_id, recording_session_id, deleted_at, owner_user_id)
    VALUES ('flight-1', 'session-remote', 3000, 'owner-a')`);
  expect(await repository.upsertRemote('owner-a', remote())).toBe(false);
  expect(await repository.list('owner-a')).toEqual([]);
  // A receipt for another account cannot suppress this owner's separately scoped archive.
  await repository.upsertRemote('owner-b', remote({ user_id: 'owner-b', igc_object_path: 'owner-b/flight-1.igc' }));
  expect(await repository.list('owner-b')).toHaveLength(1);
  await repository.upsertRemote('owner-a', remote({ id: 'flight-2', recording_session_id: 'session-2', igc_object_path: 'owner-a/flight-2.igc' }));
  await db.runAsync(`INSERT INTO flight_deletions (flight_id, recording_session_id, deleted_at, owner_user_id)
    VALUES ('flight-2', 'session-2', 3000, 'owner-a')`);
  expect(await repository.list('owner-a')).toEqual([]);
  expect(await repository.listPendingDownloads('owner-a')).toEqual([]);
  expect(await repository.get('owner-a', 'flight-2')).toBeNull();
});

it('resumes interrupted transfers after reopening and persists owner-specific pause and cursors', async () => {
  await repository.upsertRemote('owner-a', remote()); await repository.markDownloadStarted('owner-a', 'flight-1');
  await repository.rememberOwner('owner-a'); await repository.setRestorePaused('owner-a', true);
  await repository.setCursor('owner-a', { updatedAt: '2026-09-20T00:00:00Z', flightId: 'flight-1' });
  repository = makeRepository();
  expect(await repository.listPendingDownloads('owner-a')).toMatchObject([{ flightId: 'flight-1', artifactVersion: 1 }]);
  expect(await repository.getRestorePaused('owner-a')).toBe(true); expect(await repository.getRestorePaused('owner-b')).toBe(false);
  expect(await repository.getLastOwner()).toBe('owner-a'); expect(await repository.getCursor('owner-b')).toBeNull();
  expect(await repository.getCursor('owner-a')).toEqual({ updatedAt: '2026-09-20T00:00:00Z', flightId: 'flight-1' });
});

it('rolls back the artifact if marking it ready fails, and enforces the storage reserve before writes', async () => {
  await repository.upsertRemote('owner-a', remote());
  await db.execAsync("CREATE TRIGGER disk_full BEFORE UPDATE OF track_state ON archive_flights WHEN NEW.track_state = 'ready' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
  await expect(repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes)).rejects.toThrow('disk full');
  expect(await repository.readIgc('owner-a', 'flight-1')).toBeNull();
  repository = makeRepository({ checkStorage: () => { throw new Error('reserve'); } });
  await expect(repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes)).rejects.toThrow('reserve');
  expect(await db.getAllAsync('SELECT * FROM archive_artifacts')).toEqual([]);
});

it('guards archived metadata conflicts, preserves newer untouched fields and keeps original bytes', async () => {
  setFlightJournalOwner('owner-a'); setFlightAuthIdentity(null);
  await repository.upsertRemote('owner-a', remote()); await repository.storeVerifiedIgc('owner-a', 'flight-1', sha(bytes), bytes);
  const initial = (await repository.get('owner-a', 'flight-1'))!;
  const guard = { ...flightMutationGuard(initial), original: storedFlightMetadata(initial) };
  await repository.updateMetadata('owner-a', 'flight-1', { notes: 'Newer note' });
  expect(await repository.updateMetadata('owner-a', 'flight-1', { title: 'Mine' }, guard)).toMatchObject({ title: 'Mine', notes: 'Newer note' });
  await expect(repository.updateMetadata('owner-a', 'flight-1', { title: 'Conflict' }, guard)).rejects.toMatchObject({ code: 'flight_metadata_conflict', fields: ['title'] });
  expect(await repository.readIgc('owner-a', 'flight-1')).toEqual(bytes);
});
it('rejects archived edits/deletions after owner transitions and when a captured source shadows the archive', async () => {
  setFlightJournalOwner('owner-a'); setFlightAuthIdentity(null);
  await repository.upsertRemote('owner-a', remote()); const initial = (await repository.get('owner-a', 'flight-1'))!;
  const guard = { ...flightMutationGuard(initial), original: storedFlightMetadata(initial) };
  setFlightJournalOwner('owner-b'); setFlightJournalOwner('owner-a');
  await expect(repository.updateMetadata('owner-a', 'flight-1', { title: 'Wrong' }, guard)).rejects.toThrow('account changed');
  await expect(repository.deleteLocal('owner-a', 'flight-1', guard)).rejects.toThrow('account changed');
  const current = { ...flightMutationGuard(initial), original: storedFlightMetadata(initial) };
  await seedSession(db, 'session-remote', 'completed'); await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await expect(repository.updateMetadata('owner-a', 'flight-1', { title: 'Wrong' }, current)).rejects.toThrow('source changed');
  await expect(repository.deleteLocal('owner-a', 'flight-1', current)).rejects.toThrow('source changed');
});

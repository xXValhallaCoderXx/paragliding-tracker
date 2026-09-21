import type { ArchiveCursor, ArchiveRemoteFlight } from '@/archives/types';
import type { Tables } from '../database.types';
import { flight } from '../../../tests/support/fixtures';
import { CLOUD_CONFIG } from '../config';

type Query = { table: string; filters: Record<string, unknown>; orders: { key: string; ascending: boolean }[]; limit?: number; continuation?: string; after?: string };
let mockArchives: Record<string, jest.Mock>;
let mockRecorder: Record<string, jest.Mock>;
const mockQuery = jest.fn();
const mockRpc = jest.fn();
const mockRemove = jest.fn();
const mockNotify = jest.fn();
jest.mock('@/archives/repository', () => ({ archiveRepository: mockArchives }));
jest.mock('@/recorder/database.native', () => mockRecorder);
jest.mock('@/journal/context', () => ({ notifyJournal: (...args: unknown[]) => mockNotify(...args) }));
jest.mock('../supabase', () => ({ getSupabase: () => ({
  from: (table: string) => {
    const request: Query = { table, filters: {}, orders: [] };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { request.filters[key] = value; return query; },
      order: (key: string, options: { ascending: boolean }) => { request.orders.push({ key, ascending: options.ascending }); return query; },
      limit: (limit: number) => { request.limit = limit; return query; },
      or: (continuation: string) => { request.continuation = continuation; return query; },
      gt: (_key: string, after: string) => { request.after = after; return query; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(mockQuery(request)).then(resolve, reject),
    };
    return query;
  },
  rpc: (...args: unknown[]) => mockRpc(...args),
  storage: { from: () => ({ remove: (...args: unknown[]) => mockRemove(...args) }) },
}) }));

const OWNER = '11111111-1111-4111-8111-111111111111';
const TIME = '2026-09-20T00:00:00.000Z';
const id = (number: number) => `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`;
function remote(number = 1, patch: Partial<ArchiveRemoteFlight> = {}): ArchiveRemoteFlight {
  return {
    id: id(number), user_id: OWNER, recording_session_id: `session-${number}`, status: 'completed',
    started_at: 1000, ended_at: 3000, timezone_offset_minutes: -480, title: 'Ridge', site: 'Launch', site_source: 'osm', notes: 'Cloud note',
    client_created_at: 1000, client_updated_at: 5000, created_at: TIME, updated_at: TIME,
    device_platform: 'android', recorder_schema_version: 9, metrics_algorithm_version: 3,
    duration_ms: 2000, track_distance_metres: 900, min_gps_altitude: 300, max_gps_altitude: 500,
    max_ground_speed: 18, fix_count: 3, median_source_gap_ms: 1000, p95_source_gap_ms: 1000,
    max_source_gap_ms: 1000, quality: 'healthy', metrics_computed_at: 5000,
    igc_object_path: `${OWNER}/${id(number)}.igc`, igc_sha256: 'a'.repeat(64), igc_byte_count: 350, igc_artifact_version: 1,
    ...patch,
  };
}
function marker(number = 1, patch: Partial<Tables<'private_flight_deletions'>> = {}): Tables<'private_flight_deletions'> {
  return { flight_id: id(number), user_id: OWNER, recording_session_id: `session-${number}`, deleted_at: TIME,
    storage_object_path: `${OWNER}/${id(number)}.igc`, storage_cleanup_pending: false,
    storage_cleanup_attempts: 0, storage_cleanup_last_error: null, storage_cleaned_at: null, ...patch };
}
const guard = jest.fn();
let sync: typeof import('../archive-sync.native');
let cursor: ArchiveCursor | null;

beforeEach(() => {
  jest.clearAllMocks();
  cursor = null;
  mockArchives = Object.fromEntries(['upsertRemote', 'applyRemoteDeletion', 'markMetadataPushed', 'recordMetadataFailure',
    'acknowledgeDeletion', 'recordDeletionFailure'].map((name) => [name, jest.fn(async () => undefined)]));
  Object.assign(mockArchives, {
    getCursor: jest.fn(async () => cursor),
    setCursor: jest.fn(async (_owner, next) => { cursor = next; }),
    listPendingDeletions: jest.fn(async () => []), listDirtyMetadata: jest.fn(async () => []),
  });
  mockRecorder = {
    getFlightDetail: jest.fn(async () => null), markFlightCloudOwner: jest.fn(async () => undefined),
    applyRemoteFlightMetadata: jest.fn(async () => undefined), deleteCompletedFlight: jest.fn(async () => undefined),
  };
  mockQuery.mockReset().mockResolvedValue({ data: [], error: null });
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockRemove.mockReset().mockResolvedValue({ error: null });
  guard.mockReset();
  jest.isolateModules(() => { sync = jest.requireActual('../archive-sync.native'); });
});

function catalogue(rows: ArchiveRemoteFlight[]) {
  mockQuery.mockImplementation(async (query: Query) => {
    let remaining = rows.filter((row) => row.user_id === query.filters.user_id);
    if (query.continuation) {
      const timestamp = query.continuation.match(/^updated_at\.gt\.([^,]+),/)![1]!;
      const flightId = query.continuation.match(/id\.gt\.([^\)]+)\)$/)![1]!;
      remaining = remaining.filter((row) => row.updated_at > timestamp || (row.updated_at === timestamp && row.id > flightId));
    }
    return { data: remaining.slice(0, query.limit), error: null };
  });
}

it('restores 501 flights across pages without dropping equal-timestamp rows at the boundary', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => remote(index + 1, { updated_at: index < 450 ? TIME : '2026-09-20T00:00:01.000Z' }));
  catalogue(rows);
  await sync.pullArchiveCatalogue(OWNER, guard);
  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockArchives.upsertRemote.mock.calls.map(([, row]) => row.id)).toEqual(rows.map((row) => row.id));
  expect(new Set(mockArchives.upsertRemote.mock.calls.map(([, row]) => row.id)).size).toBe(501);
  for (const [query] of mockQuery.mock.calls) {
    expect(query).toMatchObject({ table: 'flights', filters: { user_id: OWNER }, orders: [{ key: 'updated_at', ascending: true }, { key: 'id', ascending: true }], limit: CLOUD_CONFIG.pullPageSize });
  }
  expect(mockQuery.mock.calls[1]![0].continuation).toBe(`updated_at.gt.${TIME},and(updated_at.eq.${TIME},id.gt.${id(200)})`);
  expect(cursor).toEqual({ updatedAt: rows[500]!.updated_at, flightId: id(501) });
});

it('can reconcile the whole catalogue from an existing checkpoint without treating absent rows as deletions', async () => {
  cursor = { updatedAt: '2026-09-20T00:00:10.000Z', flightId: id(500) };
  catalogue([remote(1), remote(2)]);
  await sync.pullArchiveCatalogue(OWNER, guard, true);
  expect(mockQuery.mock.calls[0]![0].continuation).toBeUndefined();
  expect(mockArchives.upsertRemote).toHaveBeenCalledTimes(2);
  expect(mockArchives.applyRemoteDeletion).not.toHaveBeenCalled();
  expect(mockRecorder.deleteCompletedFlight).not.toHaveBeenCalled();
});

it('checkpoints only durable rows and resumes a failed page without skipping its failed row', async () => {
  catalogue([remote(1), remote(2), remote(3)]);
  mockArchives.upsertRemote.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('Disk write failed'));
  await expect(sync.pullArchiveCatalogue(OWNER, guard)).rejects.toThrow('Disk write failed');
  expect(cursor).toEqual({ updatedAt: TIME, flightId: id(1) });
  expect(mockArchives.setCursor).toHaveBeenCalledTimes(1);
  expect(mockArchives.upsertRemote.mock.invocationCallOrder[0]).toBeLessThan(mockArchives.setCursor.mock.invocationCallOrder[0]!);
  await sync.pullArchiveCatalogue(OWNER, guard);
  expect(mockArchives.upsertRemote.mock.calls.map(([, row]) => row.id)).toEqual([id(1), id(2), id(2), id(3)]);
  expect(cursor?.flightId).toBe(id(3));
});

it('does not advance a cursor while its upsert is pending or after account eligibility is revoked', async () => {
  catalogue([remote()]);
  let resolve!: () => void;
  mockArchives.upsertRemote.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  const pending = sync.pullArchiveCatalogue(OWNER, guard);
  while (!resolve) await Promise.resolve();
  expect(mockArchives.setCursor).not.toHaveBeenCalled();
  guard.mockImplementation(() => { throw new Error('Owner changed'); });
  resolve();
  await expect(pending).rejects.toThrow('Owner changed');
  expect(mockArchives.setCursor).not.toHaveBeenCalled();
});

it('rejects a foreign-owner catalogue row before local persistence', async () => {
  mockQuery.mockResolvedValue({ data: [remote(1, { user_id: 'other-owner' })], error: null });
  await expect(sync.pullArchiveCatalogue(OWNER, guard)).rejects.toThrow('another account');
  expect(mockArchives.upsertRemote).not.toHaveBeenCalled();
  expect(mockArchives.setCursor).not.toHaveBeenCalled();
});

it('ignores an old account response that arrives after eligibility is revoked', async () => {
  let resolve!: (result: { data: ArchiveRemoteFlight[]; error: null }) => void;
  mockQuery.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = sync.pullArchiveCatalogue(OWNER, guard);
  while (!resolve) await Promise.resolve();
  guard.mockImplementation(() => { throw new Error('Owner changed'); });
  resolve({ data: [remote()], error: null });
  await expect(pending).rejects.toThrow('Owner changed');
  expect(mockArchives.upsertRemote).not.toHaveBeenCalled();
  expect(mockArchives.setCursor).not.toHaveBeenCalled();
});

it('merges only metadata into a matching recorded flight and never substitutes cloud metrics for raw evidence', async () => {
  mockRecorder.getFlightDetail.mockResolvedValue(flight({ id: id(1), recordingSessionId: 'session-1' }));
  await sync.mergeRemoteFlight(OWNER, remote(), guard, 1234);
  expect(mockArchives.upsertRemote).not.toHaveBeenCalled();
  expect(mockRecorder.applyRemoteFlightMetadata).toHaveBeenCalledWith({ flightId: id(1), title: 'Ridge', site: 'Launch',
    siteSource: 'osm', notes: 'Cloud note', clientUpdatedAt: 5000, expectedLocalUpdatedAt: 1234 }, TIME);
  await expect(sync.mergeRemoteFlight(OWNER, remote(1, { recording_session_id: 'different-session' }), guard)).rejects.toThrow('conflicting recording identity');
  expect(mockRecorder.applyRemoteFlightMetadata).toHaveBeenCalledTimes(1);
});

it('never infers deletion from an empty catalogue response', async () => {
  await sync.pullArchiveCatalogue(OWNER, guard);
  expect(mockArchives.applyRemoteDeletion).not.toHaveBeenCalled();
  expect(mockRecorder.deleteCompletedFlight).not.toHaveBeenCalled();
});

it('pulls 201 explicit deletion markers by id and persists each receipt before deleting its original recording', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => marker(index + 1));
  mockQuery.mockImplementation(async (query: Query) => ({ data: rows.filter((row) => !query.after || row.flight_id > query.after).slice(0, query.limit), error: null }));
  mockRecorder.getFlightDetail.mockImplementation(async (flightId) => flight({ id: flightId, recordingSessionId: `session-${Number(flightId.slice(-12))}` }));
  expect(await sync.pullFlightDeletions(OWNER, guard)).toEqual([]);
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1]![0]).toMatchObject({ table: 'private_flight_deletions', filters: { user_id: OWNER }, after: id(200) });
  expect(mockArchives.applyRemoteDeletion).toHaveBeenCalledTimes(201);
  expect(mockRecorder.deleteCompletedFlight).toHaveBeenCalledTimes(201);
  for (let index = 0; index < rows.length; index += 1) {
    expect(mockArchives.applyRemoteDeletion.mock.invocationCallOrder[index]).toBeLessThan(mockRecorder.deleteCompletedFlight.mock.invocationCallOrder[index]!);
  }
  expect(mockRecorder.deleteCompletedFlight).toHaveBeenNthCalledWith(1, id(1), Date.parse(TIME), { remoteOwnerUserId: OWNER, recordingSessionId: 'session-1' });
});

it('rejects another account’s deletion marker before persisting or deleting a local recording', async () => {
  mockQuery.mockResolvedValue({ data: [marker(1, { user_id: 'other-owner' })], error: null });
  await expect(sync.pullFlightDeletions(OWNER, guard)).rejects.toThrow();
  expect(mockArchives.applyRemoteDeletion).not.toHaveBeenCalled();
  expect(mockRecorder.deleteCompletedFlight).not.toHaveBeenCalled();
});

it('does not delete raw evidence whose recording identity conflicts with a marker', async () => {
  mockQuery.mockResolvedValue({ data: [marker()], error: null });
  mockRecorder.getFlightDetail.mockResolvedValue(flight({ id: id(1), recordingSessionId: 'different-session' }));
  await sync.pullFlightDeletions(OWNER, guard);
  expect(mockArchives.applyRemoteDeletion).toHaveBeenCalledWith(OWNER, id(1), 'session-1', Date.parse(TIME));
  expect(mockRecorder.deleteCompletedFlight).not.toHaveBeenCalled();
});

it('keeps original evidence and skips cleanup when its durable deletion receipt cannot be saved', async () => {
  mockQuery.mockResolvedValue({ data: [marker(1, { storage_cleanup_pending: true })], error: null });
  mockArchives.applyRemoteDeletion.mockRejectedValueOnce(new Error('Receipt write failed'));
  mockRecorder.getFlightDetail.mockResolvedValue(flight({ id: id(1), recordingSessionId: 'session-1' }));
  await expect(sync.pullFlightDeletions(OWNER, guard)).rejects.toThrow('Receipt write failed');
  expect(mockRecorder.deleteCompletedFlight).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it.each([{ flight_id: id(2) }, { user_id: 'other-owner' }])('rejects an unrelated deletion RPC reply: %o', async (patch) => {
  mockRpc.mockResolvedValue({ data: marker(1, patch), error: null });
  await expect(sync.deleteRemoteFlight(OWNER, id(1), guard)).rejects.toThrow();
  expect(mockArchives.applyRemoteDeletion).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it('keeps durable deletion receipts and processes the next marker when storage cleanup fails', async () => {
  mockQuery.mockResolvedValue({ data: [marker(1, { storage_cleanup_pending: true }), marker(2)], error: null });
  const storageError = { message: 'Storage unavailable' };
  mockRemove.mockResolvedValueOnce({ error: storageError });
  expect(await sync.pullFlightDeletions(OWNER, guard)).toEqual([storageError]);
  expect(mockArchives.applyRemoteDeletion).toHaveBeenCalledTimes(2);
  expect(mockRpc).toHaveBeenCalledWith('acknowledge_private_flight_cleanup', { p_flight_id: id(1), p_error: 'Storage unavailable' });
  expect(mockArchives.applyRemoteDeletion.mock.invocationCallOrder[0]).toBeLessThan(mockRemove.mock.invocationCallOrder[0]!);
});

it('retains the local deletion when removal succeeded but its server cleanup acknowledgement failed', async () => {
  mockQuery.mockResolvedValue({ data: [marker(1, { storage_cleanup_pending: true }), marker(2)], error: null });
  const acknowledgementError = { message: 'Acknowledgement unavailable' };
  mockRpc.mockResolvedValueOnce({ error: acknowledgementError });
  expect(await sync.pullFlightDeletions(OWNER, guard)).toEqual([acknowledgementError]);
  expect(mockArchives.applyRemoteDeletion).toHaveBeenCalledTimes(2);
  expect(mockRemove).toHaveBeenCalledWith([`${OWNER}/${id(1)}.igc`]);
  expect(mockRpc).toHaveBeenCalledWith('acknowledge_private_flight_cleanup', { p_flight_id: id(1) });
  expect(mockArchives.upsertRemote).not.toHaveBeenCalled();
});

it('reports cleanup as pending when Storage returned success but the server still finds the file', async () => {
  mockQuery.mockResolvedValue({ data: [marker(1, { storage_cleanup_pending: true })], error: null });
  mockRpc.mockResolvedValue({ data: marker(1, { storage_cleanup_pending: true, storage_cleanup_last_error: 'The archived file still exists.' }), error: null });
  const failures = await sync.pullFlightDeletions(OWNER, guard);
  expect(failures).toHaveLength(1);
  expect((failures[0] as Error).message).toBe('The archived file still exists.');
});

it('accepts verified cleanup only after the server confirms the exact artifact is absent', async () => {
  mockRpc.mockResolvedValue({ data: marker(), error: null });
  await expect(sync.cleanDeletedArtifact(id(1), `${OWNER}/${id(1)}.igc`, guard)).resolves.toBeUndefined();
  mockRpc.mockResolvedValue({ data: marker(2), error: null });
  await expect(sync.cleanDeletedArtifact(id(1), `${OWNER}/${id(1)}.igc`, guard)).rejects.toThrow('could not be verified');
});

it('deletes locally from the canonical marker before cleanup, and does not acknowledge a failed cleanup queue item', async () => {
  mockArchives.listPendingDeletions.mockResolvedValue([{ flightId: id(1), deletedAt: 5000, attemptCount: 0 }]);
  mockRpc.mockImplementation(async (name) => ({ data: name === 'delete_private_flight' ? marker(1, { storage_cleanup_pending: true }) : null, error: null }));
  mockRemove.mockResolvedValueOnce({ error: { message: 'Storage unavailable' } });
  expect(await sync.pushArchiveChanges(OWNER, guard, true)).toHaveLength(1);
  expect(mockArchives.applyRemoteDeletion).toHaveBeenCalledWith(OWNER, id(1), 'session-1', Date.parse(TIME));
  expect(mockArchives.acknowledgeDeletion).not.toHaveBeenCalled();
  expect(mockArchives.recordDeletionFailure).toHaveBeenCalledWith(OWNER, id(1), 'Storage unavailable', expect.any(Number));
});

it('sends only editable metadata and merges the canonical response before acknowledging its exact dirty revision', async () => {
  const original = remote();
  mockArchives.listDirtyMetadata.mockResolvedValue([{ ...flight({ id: original.id }), title: 'Edited', site: 'Launch', siteSource: 'manual', notes: 'Draft', dirtyUpdatedAt: 7000 }]);
  const canonical = remote(1, { title: 'Canonical', client_updated_at: 7000, updated_at: '2026-09-20T00:00:10.000Z' });
  mockRpc.mockResolvedValue({ data: canonical, error: null });
  expect(await sync.pushArchiveChanges(OWNER, guard, true)).toEqual([]);
  expect(mockRpc).toHaveBeenCalledWith('write_private_flight', { p_metadata_only: true,
    p_flight: { id: id(1), title: 'Edited', site: 'Launch', site_source: 'manual', notes: 'Draft', client_updated_at: 7000 } });
  expect(mockArchives.upsertRemote).toHaveBeenCalledWith(OWNER, canonical, 7000);
  expect(mockArchives.markMetadataPushed).toHaveBeenCalledWith(OWNER, id(1), 7000, canonical.updated_at);
  expect(mockArchives.upsertRemote.mock.invocationCallOrder[0]).toBeLessThan(mockArchives.markMetadataPushed.mock.invocationCallOrder[0]!);
});

it.each([{ id: id(2) }, { user_id: 'other-owner' }])('does not acknowledge an unrelated canonical reply: %o', async (patch) => {
  mockArchives.listDirtyMetadata.mockResolvedValue([{ ...flight({ id: id(1) }), dirtyUpdatedAt: 7000 }]);
  mockRpc.mockResolvedValue({ data: remote(1, patch), error: null });
  expect(await sync.pushArchiveChanges(OWNER, guard, true)).toHaveLength(1);
  expect(mockArchives.upsertRemote).not.toHaveBeenCalled();
  expect(mockArchives.markMetadataPushed).not.toHaveBeenCalled();
  expect(mockArchives.recordMetadataFailure).toHaveBeenCalled();
});

it('keeps edited metadata dirty after persistence fails and never acknowledges an unmerged canonical row', async () => {
  mockArchives.listDirtyMetadata.mockResolvedValue([{ ...flight({ id: id(1) }), dirtyUpdatedAt: 7000 }]);
  mockRpc.mockResolvedValue({ data: remote(), error: null });
  mockArchives.upsertRemote.mockRejectedValueOnce(new Error('Disk write failed'));
  expect(await sync.pushArchiveChanges(OWNER, guard, false)).toHaveLength(1);
  expect(mockArchives.markMetadataPushed).not.toHaveBeenCalled();
});

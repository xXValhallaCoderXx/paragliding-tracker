import { flight, metrics, profile } from '../../../tests/support/fixtures';
import type { AuthSnapshot, CloudSyncEngine } from '../types';
import type { FlightSyncCandidate } from '@/recorder/types';
import type { ArchiveDownloadCandidate } from '@/archives/types';

jest.mock('../config', () => ({ ...jest.requireActual('../config'), cloudConfigured: true }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async () => 'digest' }));
jest.mock('@/recorder/igc', () => ({ buildUnsignedIgc: () => ({ content: 'IGC bytes' }) }));
let mockRepository: Record<string, jest.Mock>;
let mockArchives: Record<string, jest.Mock>;
let mockActions: Record<string, jest.Mock>;
let mockAuth: AuthSnapshot;
const mockSignOut = jest.fn();
jest.mock('@/recorder/database.native', () => mockRepository);
jest.mock('@/archives/repository', () => ({ archiveRepository: mockArchives }));
jest.mock('../archive-sync.native', () => ({
  deleteRemoteFlight: (...args: unknown[]) => mockActions.deleteRemoteFlight(...args),
  mergeRemoteFlight: (...args: unknown[]) => mockActions.mergeRemoteFlight(...args),
  pullArchiveCatalogue: (...args: unknown[]) => mockActions.pullArchiveCatalogue(...args),
  pullFlightDeletions: (...args: unknown[]) => mockActions.pullFlightDeletions(...args),
  pushArchiveChanges: (...args: unknown[]) => mockActions.pushArchiveChanges(...args),
}));
const mockDownload = jest.fn();
jest.mock('../archive-download.native', () => ({ downloadArchiveIgc: (...args: unknown[]) => mockDownload(...args) }));
jest.mock('../auth-service', () => ({ cloudAuthService: { getSnapshot: () => mockAuth, signOut: () => mockSignOut() } }));
const mockRequest = jest.fn();
const mockRpc = jest.fn();
const mockUpload = jest.fn();
jest.mock('../supabase', () => ({ getSupabase: () => ({
  rpc: (...args: unknown[]) => mockRpc(...args),
  from: (table: string) => {
    const request: { table: string; operation: string; body?: unknown } = { table, operation: 'select' };
    const query = {
      upsert(body: unknown) { request.operation = 'upsert'; request.body = body; return query; },
      update(body: unknown) { request.operation = 'update'; request.body = body; return query; },
      select: () => query, eq: () => query, single: () => query, maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(mockRequest(request)).then(resolve, reject),
    };
    return query;
  },
  storage: { from: () => ({ upload: mockUpload }) },
}) }));

let engine: CloudSyncEngine;
let journal: typeof import('@/journal/context');
const NOW = 100_000;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let step = 0; step < 200 && !predicate(); step += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}
function queuedArchive() {
  const archive: ArchiveDownloadCandidate = { ownerUserId: 'A', flightId: 'archive', recordingSessionId: 'original-session',
    title: 'Saved flight', startedAt: 1000, endedAt: 2000, objectPath: 'A/archive.igc', sha256: 'a'.repeat(64), byteCount: 3, artifactVersion: 1, attemptCount: 0 };
  let complete = false;
  mockArchives.list.mockImplementation(async () => [{ archive: { trackState: complete ? 'ready' : 'pending' } }]);
  mockArchives.listPendingDownloads.mockImplementation(async () => complete ? [] : [archive]);
  mockArchives.storeVerifiedIgc.mockImplementation(async (_owner, _id, _sha, _bytes, _version, guard) => {
    if (!guard()) return false; complete = true; return true;
  });
  return archive;
}
const candidate = (id = 'f', tracked = false): FlightSyncCandidate => ({
  ...flight({ id, recordingSessionId: `${id}-session`, updatedAt: 1000 }), metrics: tracked ? metrics({ flightId: id }) : null,
  pushedUpdatedAt: null, igcSha256: null, igcObjectPath: null, attemptCount: 0, nextAttemptAt: 0,
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  mockAuth = { status: 'signed_in', userId: 'A', email: 'a@example.test', lastError: null };
  const link = { userId: 'A', lastSyncAt: null, lastSyncError: null, flightsCursor: null };
  mockRepository = Object.fromEntries(['markFlightPushed', 'markFlightIgcPushed', 'recordFlightSyncFailure', 'recordFlightDeletionFailure',
    'clearFlightDeletion', 'bindCloudLink', 'resetCloudLink', 'markPilotProfilePushed', 'updatePilotProfile', 'markFlightCloudOwner']
    .map(name => [name, jest.fn(async () => {})]));
  Object.assign(mockRepository, {
    getCloudLink: jest.fn(async () => link), getUnfinishedSession: jest.fn(async () => null),
    getPilotProfile: jest.fn(async () => profile({ updatedAt: 1000, pushedUpdatedAt: 1000 })),
    listDirtyFlights: jest.fn(async () => []), listPendingFlightDeletions: jest.fn(async () => []),
    countPendingSync: jest.fn(async () => ({ flights: 0, deletions: 0 })),
    setCloudCursors: jest.fn(async patch => { Object.assign(link, patch); }),
    getSessionExportData: jest.fn(async () => ({ session: {}, locations: [] })),
    getFlightDetail: jest.fn(async id => ({ ...candidate(id), session: {} })),
  });
  mockArchives = {
    list: jest.fn(async () => []), listPendingDownloads: jest.fn(async () => []),
    listDirtyMetadata: jest.fn(async () => []), listPendingDeletions: jest.fn(async () => []),
    getRestorePaused: jest.fn(async () => false), setRestorePaused: jest.fn(async () => {}),
    rememberOwner: jest.fn(async () => {}), getLastOwner: jest.fn(async () => 'A'),
    markDownloadStarted: jest.fn(async () => {}), storeVerifiedIgc: jest.fn(async () => true), recordDownloadFailure: jest.fn(async () => {}),
  };
  mockActions = {
    deleteRemoteFlight: jest.fn(async () => {}), mergeRemoteFlight: jest.fn(async () => {}),
    pullArchiveCatalogue: jest.fn(async () => {}), pullFlightDeletions: jest.fn(async () => []), pushArchiveChanges: jest.fn(async () => []),
  };
  mockRequest.mockReset().mockResolvedValue({ data: null, error: null });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRpc.mockReset().mockImplementation(async (_name, args) => ({ data: { ...args.p_flight, updated_at: '2026-09-20T00:00:00Z' }, error: null }));
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockDownload.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  jest.isolateModules(() => {
    engine = jest.requireActual('../sync-engine.native').cloudSyncEngine;
    journal = jest.requireActual('@/journal/context');
  });
  engine.setEnvironment({ foreground: true, recorderReady: true, recorderBusy: false, network: 'wifi' });
});
afterEach(() => { engine.setEnvironment({ foreground: false }); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

it('sends explicit deletions before catalogue restore and uses guarded recorded writes', async () => {
  mockRepository.listDirtyFlights.mockResolvedValue([candidate()]);
  mockRepository.listPendingFlightDeletions.mockResolvedValue([{ flightId: 'deleted', ownerUserId: 'A', attemptCount: 0 }]);
  const result = await engine.requestSync('manual');
  expect(result.phase).toBe('idle');
  expect(mockActions.deleteRemoteFlight).toHaveBeenCalledWith('A', 'deleted', expect.any(Function));
  expect(mockActions.deleteRemoteFlight.mock.invocationCallOrder[0]).toBeLessThan(mockActions.pullArchiveCatalogue.mock.invocationCallOrder[0]);
  expect(mockActions.pullFlightDeletions.mock.invocationCallOrder[0]).toBeLessThan(mockRpc.mock.invocationCallOrder[0]);
  expect(mockRpc).toHaveBeenCalledWith('write_private_flight', expect.objectContaining({ p_metadata_only: false, p_flight: expect.objectContaining({ id: 'f', user_id: 'A' }) }));
  expect(mockActions.mergeRemoteFlight).toHaveBeenCalledWith('A', expect.objectContaining({ id: 'f' }), expect.any(Function), 1000);
});
it('does not acknowledge a tracked flight until IGC upload succeeds on retry', async () => {
  mockRepository.listDirtyFlights.mockResolvedValue([candidate('f', true)]);
  mockUpload.mockResolvedValueOnce({ error: { message: 'Upload failed' } });
  expect((await engine.requestSync('manual')).phase).toBe('error');
  expect(mockRepository.markFlightPushed).not.toHaveBeenCalled();
  expect(mockRepository.recordFlightSyncFailure).toHaveBeenCalled();
  expect((await engine.requestSync('manual')).phase).toBe('idle');
  expect(mockRepository.markFlightIgcPushed.mock.invocationCallOrder[0]).toBeLessThan(mockRepository.markFlightPushed.mock.invocationCallOrder[0]);
});
it('restores B without rebinding or uploading the captured logbook linked to A', async () => {
  mockAuth.userId = 'B';
  const result = await engine.requestSync('manual');
  expect(result).toMatchObject({ phase: 'blocked', blockedBy: 'account_mismatch' });
  expect(mockActions.pullArchiveCatalogue).toHaveBeenCalledWith('B', expect.any(Function), true);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledWith('B', expect.any(Function), true);
  expect(mockRepository.listDirtyFlights).not.toHaveBeenCalled();
  expect(mockRepository.resetCloudLink).not.toHaveBeenCalled();
});
it('never rebinds an old pending deletion or a positively owned recording', async () => {
  mockRepository.listPendingFlightDeletions.mockResolvedValue([{ flightId: 'old', ownerUserId: 'B' }, { flightId: 'unknown', ownerUserId: null }]);
  mockRepository.listDirtyFlights.mockResolvedValue([{ ...candidate(), cloudOwnerUserId: 'B' }]);
  await engine.requestSync('manual');
  expect(mockActions.deleteRemoteFlight).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
});
it('pulls the profile before any push and never uploads untouched fresh-install defaults', async () => {
  mockRepository.getPilotProfile.mockResolvedValue(profile({ updatedAt: 0, pushedUpdatedAt: null }));
  await engine.requestSync('manual');
  expect(mockRequest.mock.calls.some(([request]) => request.table === 'profiles' && request.operation === 'upsert')).toBe(false);
});
it('blocks network work during capture and recorder recovery', async () => {
  engine.setEnvironment({ recorderBusy: true });
  await engine.requestSync('manual');
  expect(mockActions.pullArchiveCatalogue).not.toHaveBeenCalled();
  engine.setEnvironment({ recorderBusy: false, recorderReady: false });
  await engine.requestSync('manual');
  expect(mockActions.pullArchiveCatalogue).not.toHaveBeenCalled();
});
it('does not sign B out when an obsolete request from A fails authentication', async () => {
  let reject!: (reason: unknown) => void;
  mockActions.pullArchiveCatalogue.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const oldCycle = engine.requestSync('manual');
  while (!reject) await Promise.resolve();
  mockAuth = { ...mockAuth, userId: 'B' };
  await engine.authChanged();
  reject({ status: 401, message: 'Old token expired' });
  await oldCycle;
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(engine.getSnapshot().lastError).toBeNull();
});
it('continues independent rows but never reports a successful sync over failed work', async () => {
  mockRepository.listDirtyFlights.mockResolvedValue([candidate('bad'), candidate('good')]);
  mockRpc.mockImplementation(async (_name, args) => args.p_flight.id === 'bad'
    ? { error: { message: 'Bad flight' } }
    : { data: { ...args.p_flight, updated_at: '2026-09-20T00:00:00Z' }, error: null });
  expect((await engine.requestSync('manual')).phase).toBe('error');
  expect(mockRepository.markFlightPushed).toHaveBeenCalledTimes(1);
  expect(mockRepository.markFlightPushed).toHaveBeenCalledWith(expect.objectContaining({ flightId: 'good' }));
});

it('joins account initialization before syncing and honors the persisted restore pause', async () => {
  queuedArchive();
  const paused = deferred<boolean>();
  mockArchives.getRestorePaused.mockReturnValue(paused.promise);
  const initializing = engine.authChanged();
  const syncing = engine.requestSync('foreground');
  await until(() => mockArchives.getRestorePaused.mock.calls.length === 1);
  await Promise.resolve();
  expect(mockActions.pullArchiveCatalogue).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
  paused.resolve(true);
  await Promise.all([initializing, syncing]);
  expect(mockArchives.getRestorePaused).toHaveBeenCalledTimes(1);
  expect(mockArchives.rememberOwner).toHaveBeenCalledWith('A');
  expect(mockActions.pullArchiveCatalogue).toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
  expect(engine.getSnapshot().restore).toMatchObject({ phase: 'paused', pauseReason: 'user' });
});

it('retries failed account initialization and reloads the persisted pause before any transfer', async () => {
  queuedArchive();
  mockArchives.getRestorePaused.mockRejectedValueOnce(new Error('Database temporarily busy')).mockResolvedValue(true);
  await expect(engine.authChanged()).rejects.toThrow('Database temporarily busy');
  expect(mockActions.pullArchiveCatalogue).not.toHaveBeenCalled();
  await engine.requestSync('foreground');
  expect(mockArchives.getRestorePaused).toHaveBeenCalledTimes(2);
  expect(mockDownload).not.toHaveBeenCalled();
  expect(engine.getSnapshot().restore).toMatchObject({ phase: 'paused', pauseReason: 'user' });
});

it('does not publish old account pending counts after switching owners', async () => {
  await engine.authChanged();
  const pending = deferred<{ flights: number; deletions: number }>();
  mockRepository.countPendingSync.mockReturnValueOnce(pending.promise);
  const unsubscribe = engine.subscribe(() => {});
  try {
    await until(() => mockRepository.countPendingSync.mock.calls.length === 1);
    mockAuth = { ...mockAuth, userId: 'B' };
    await engine.authChanged();
    pending.resolve({ flights: 99, deletions: 22 });
    await Promise.resolve(); await Promise.resolve();
    expect(engine.getSnapshot()).toMatchObject({ pendingFlights: 0, pendingDeletions: 0 });
  } finally { unsubscribe(); }
});

it('restores remembered offline visibility after auth restoration finishes signed out', async () => {
  mockAuth = { ...mockAuth, status: 'restoring', userId: null };
  await engine.authChanged();
  expect(journal.journalOwner()).toBeNull();
  expect(mockArchives.getLastOwner).not.toHaveBeenCalled();
  mockAuth = { ...mockAuth, status: 'signed_out' };
  await engine.authChanged();
  expect(mockArchives.getLastOwner).toHaveBeenCalledTimes(1);
  expect(journal.journalOwner()).toBe('A');
  await engine.requestSync('foreground');
  expect(mockActions.pullArchiveCatalogue).not.toHaveBeenCalled();
});

it('does not overwrite a newly signed-in owner with a late remembered-owner lookup', async () => {
  const previous = deferred<string>();
  mockArchives.getLastOwner.mockReturnValue(previous.promise);
  mockAuth = { ...mockAuth, status: 'signed_out', userId: null };
  const remembering = engine.authChanged();
  await until(() => mockArchives.getLastOwner.mock.calls.length === 1);
  mockAuth = { ...mockAuth, status: 'signed_in', userId: 'B' };
  await engine.authChanged();
  expect(journal.journalOwner()).toBe('B');
  previous.resolve('A'); await remembering;
  expect(journal.journalOwner()).toBe('B');
});

it('does not publish a late initialization failure from the previous account', async () => {
  const oldPause = deferred<boolean>();
  mockArchives.getRestorePaused.mockReturnValueOnce(oldPause.promise).mockResolvedValue(false);
  const oldRequest = engine.requestSync('foreground');
  await until(() => mockArchives.getRestorePaused.mock.calls.length === 1);
  mockAuth = { ...mockAuth, userId: 'B' };
  await engine.authChanged();
  oldPause.reject(new Error('Previous account database failed'));
  await oldRequest;
  expect(journal.journalOwner()).toBe('B');
  expect(engine.getSnapshot().lastError).toBeNull();
});

it.each(['foreground', 'recorder'] as const)('resumes automatically when %s becomes eligible before an aborted transfer settles', async cause => {
  queuedArchive();
  const first = deferred<Uint8Array>();
  mockDownload.mockReturnValueOnce(first.promise);
  const running = engine.requestSync('foreground');
  await until(() => mockDownload.mock.calls.length === 1);
  const signal = mockDownload.mock.calls[0][1] as AbortSignal;
  engine.setEnvironment(cause === 'foreground' ? { foreground: false } : { recorderBusy: true });
  expect(signal.aborted).toBe(true);
  engine.setEnvironment(cause === 'foreground' ? { foreground: true } : { recorderBusy: false });
  first.resolve(new Uint8Array([1, 2, 3]));
  await running;
  await until(() => engine.getSnapshot().restore?.completed === 1);
  expect(mockDownload).toHaveBeenCalledTimes(2);
  expect(mockArchives.storeVerifiedIgc).toHaveBeenCalledTimes(1);
  expect(engine.getSnapshot().restore).toMatchObject({ phase: 'idle', completed: 1, total: 1 });
});

it('runs a manual resume after the paused cycle has released its slot', async () => {
  queuedArchive();
  const first = deferred<Uint8Array>();
  mockDownload.mockReturnValueOnce(first.promise);
  const running = engine.requestSync('foreground');
  await until(() => mockDownload.mock.calls.length === 1);
  engine.pauseRestore();
  engine.resumeRestore({ allowMobileData: false });
  await until(() => mockArchives.setRestorePaused.mock.calls.some(([, paused]) => paused === false));
  first.resolve(new Uint8Array([1, 2, 3]));
  await running;
  await until(() => engine.getSnapshot().restore?.completed === 1);
  expect(mockDownload).toHaveBeenCalledTimes(2);
  expect(mockArchives.storeVerifiedIgc).toHaveBeenCalledTimes(1);
});

it('claims capture ownership before the first RPC and does not recreate bookkeeping if deleted during upload', async () => {
  mockRepository.listDirtyFlights.mockResolvedValue([candidate()]);
  const reply = deferred<unknown>();
  mockRpc.mockReturnValue(reply.promise);
  const syncing = engine.requestSync('manual');
  await until(() => mockRpc.mock.calls.length === 1);
  expect(mockRepository.markFlightCloudOwner.mock.invocationCallOrder[0]).toBeLessThan(mockRpc.mock.invocationCallOrder[0]);
  mockRepository.getFlightDetail.mockResolvedValue(null);
  reply.resolve({ data: { id: 'f', user_id: 'A', client_updated_at: 1000, updated_at: '2026-09-20T00:00:00Z' }, error: null });
  await syncing;
  expect(mockRepository.markFlightPushed).not.toHaveBeenCalled();
  expect(mockRepository.recordFlightSyncFailure).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
});

it('keeps already-queued transfers eligible during metadata backoff and retries metadata later', async () => {
  mockActions.pullArchiveCatalogue.mockRejectedValueOnce(new Error('Network request failed'));
  expect((await engine.requestSync('foreground')).phase).toBe('error');
  queuedArchive();
  expect((await engine.requestSync('foreground')).blockedBy).toBe('backoff');
  expect(engine.getSnapshot().restore).toMatchObject({ completed: 1 });
  expect(mockDownload).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(30_000);
  await until(() => engine.getSnapshot().phase === 'idle');
  expect(mockActions.pullArchiveCatalogue.mock.calls.length).toBeGreaterThan(1);
});

it('counts all owner archive edits and deletions, including rows waiting for retry', async () => {
  mockRepository.countPendingSync.mockResolvedValue({ flights: 2, deletions: 3 });
  mockArchives.listDirtyMetadata.mockImplementation(async owner => owner === 'A' ? Array(125).fill({}) : []);
  mockArchives.listPendingDeletions.mockImplementation(async owner => owner === 'A' ? Array(126).fill({}) : []);
  engine.setEnvironment({ recorderBusy: true });
  expect(await engine.requestSync('post-save')).toMatchObject({ pendingFlights: 127, pendingDeletions: 129 });
  expect(mockArchives.listDirtyMetadata).toHaveBeenCalledWith('A', Number.MAX_SAFE_INTEGER, NOW, true);
  expect(mockArchives.listPendingDeletions).toHaveBeenCalledWith('A', Number.MAX_SAFE_INTEGER, NOW, true);
  mockAuth = { ...mockAuth, userId: 'B' };
  expect(await engine.requestSync('post-save')).toMatchObject({ pendingFlights: 2, pendingDeletions: 3 });
  expect(mockArchives.listDirtyMetadata).toHaveBeenLastCalledWith('B', Number.MAX_SAFE_INTEGER, NOW, true);
});

it('does not publish delayed archive counts from the previous account', async () => {
  await engine.authChanged();
  const counts = deferred<unknown[]>();
  mockArchives.listDirtyMetadata.mockReturnValueOnce(counts.promise);
  const unsubscribe = engine.subscribe(() => {});
  try {
    await until(() => mockArchives.listDirtyMetadata.mock.calls.length === 1);
    mockAuth = { ...mockAuth, userId: 'B' };
    await engine.authChanged();
    counts.resolve(Array(9).fill({}));
    await Promise.resolve(); await Promise.resolve();
    expect(engine.getSnapshot()).toMatchObject({ pendingFlights: 0, pendingDeletions: 0 });
  } finally { unsubscribe(); }
});

it('sends an archive deletion immediately after a successful sync without waiting for navigation', async () => {
  await engine.requestSync('manual');
  let pending = true;
  mockArchives.listPendingDeletions.mockImplementation(async () => pending ? [{}] : []);
  mockActions.pushArchiveChanges.mockImplementation(async () => { pending = false; return []; });
  expect(await engine.requestSync('post-save')).toMatchObject({ phase: 'idle', pendingDeletions: 0 });
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(2);
  expect(pending).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('coalesces mutations after a cycle read its queues into one follow-up pass', async () => {
  const readingCatalogue = deferred<void>();
  mockActions.pullArchiveCatalogue.mockReturnValueOnce(readingCatalogue.promise);
  const first = engine.requestSync('foreground');
  await until(() => mockActions.pullArchiveCatalogue.mock.calls.length === 1);
  let pending = true;
  mockArchives.listPendingDeletions.mockImplementation(async () => pending ? [{}] : []);
  mockActions.pushArchiveChanges.mockImplementation(async () => { pending = false; return []; });
  const saved = engine.requestSync('post-save');
  const anotherSave = engine.requestSync('post-save');
  await until(() => mockArchives.listPendingDeletions.mock.calls.length >= 2);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(1);
  readingCatalogue.resolve();
  await Promise.all([first, saved, anotherSave]);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(2);
  expect(pending).toBe(false);
  expect(engine.getSnapshot()).toMatchObject({ phase: 'idle', pendingDeletions: 0 });
  expect(jest.getTimerCount()).toBe(0);
});

it('refreshes throttled pending counts and retries at the deadline without another user action', async () => {
  await engine.requestSync('manual');
  let pending = true;
  mockArchives.listPendingDeletions.mockImplementation(async () => pending ? [{}] : []);
  mockActions.pushArchiveChanges.mockImplementation(async () => { pending = false; return []; });
  expect(await engine.requestSync('foreground')).toMatchObject({ blockedBy: 'throttled', pendingDeletions: 1 });
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(29_999);
  expect(pending).toBe(true);
  await jest.advanceTimersByTimeAsync(1);
  await until(() => engine.getSnapshot().pendingDeletions === 0);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

it('defers a throttle deadline while recording and resumes when the recorder is idle', async () => {
  await engine.requestSync('manual');
  let pending = true;
  mockArchives.listPendingDeletions.mockImplementation(async () => pending ? [{}] : []);
  mockActions.pushArchiveChanges.mockImplementation(async () => { pending = false; return []; });
  await engine.requestSync('foreground');
  engine.setEnvironment({ recorderBusy: true });
  await jest.advanceTimersByTimeAsync(30_000);
  expect(pending).toBe(true);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(1);
  engine.setEnvironment({ recorderBusy: false });
  await until(() => engine.getSnapshot().pendingDeletions === 0);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(2);
});

it('preserves failure backoff for new saves and does not spin follow-up cycles', async () => {
  mockActions.pushArchiveChanges.mockResolvedValueOnce([new Error('Network unavailable')]);
  expect((await engine.requestSync('manual')).phase).toBe('error');
  mockArchives.listDirtyMetadata.mockResolvedValue([{}]);
  expect(await engine.requestSync('post-save')).toMatchObject({ blockedBy: 'backoff', pendingFlights: 1 });
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(29_999);
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(1);
  mockArchives.listDirtyMetadata.mockResolvedValue([]);
  await jest.advanceTimersByTimeAsync(1);
  await until(() => engine.getSnapshot().phase === 'idle');
  expect(mockActions.pushArchiveChanges).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

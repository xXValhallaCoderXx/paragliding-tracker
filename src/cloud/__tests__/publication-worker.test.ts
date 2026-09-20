import { TestDatabase, schemaAt, seedSession } from '../../../tests/support/sqlite';
import { BACKFILL_FLIGHTS_SQL } from '@/recorder/flight-repository-core';
import { PublicationRepository, stampCapture, enqueueFinalizedPublication, cancelDeletedPublication } from '@/recorder/publication-repository-core';
import type { FeedService, PreparedShare, SharedReplayArtifactV1 } from '@/social/feed-types';
import { SocialError } from '@/social/types';
import { PublicationWorker } from '../publication-worker';

let db: TestDatabase;
let repository: PublicationRepository;
let owner: string | null;
let worker: PublicationWorker;
let now: number;
const artifact: SharedReplayArtifactV1 = { schemaVersion: 1, provenance: 'recorded', bounds: { startedAt: 1000, endedAt: 2000 }, partial: false, points: [] };
const prepared: PreparedShare = { activityId: 'activity', revision: 1, uploadToken: 'token', alreadyPublished: false };
const remote = { prepareShare: jest.fn(), uploadShare: jest.fn(), hideFlight: jest.fn() };
const sourceExists = jest.fn();
const backupReady = jest.fn();
const changed = jest.fn();
const makeRepository = () => new PublicationRepository({ read: operation => operation(db), write: async operation => {
  let result!: Awaited<ReturnType<typeof operation>>;
  await db.withExclusiveTransactionAsync(async tx => { result = await operation(tx); }); return result;
} }, () => now);
function makeWorker() {
  return new PublicationWorker({ repository, remote: remote as unknown as FeedService, owner: () => owner,
    sourceExists, backupReady, artifact: async () => artifact, changed, now: () => now });
}
async function run() {
  worker.setEnvironment({ foreground: true, online: true, recorderReady: true, recorderBusy: false });
  await worker.requestSync();
}
async function seedFinal(id = 'flight') {
  await seedSession(db, id, 'completed');
  await db.runAsync('UPDATE sessions SET ended_at = 2000, completion_reason = ? WHERE id = ?', 'stopped', id);
  await db.execAsync(BACKFILL_FLIGHTS_SQL);
  await db.runAsync(`INSERT INTO flight_metrics (flight_id, algorithm_version, duration_ms, track_distance_metres,
    fix_count, quality, computed_at) VALUES (?, 1, 1000, 0, 0, 'no_track', 2000)`, id);
}
async function automatic(id = 'flight', generation = 'consent-1') {
  await seedFinal(id);
  await repository.setPreferences('A', { enabled: true, generation });
  await stampCapture(db, id, { ownerUserId: 'A', generation, operationId: `auto-${id}` }, 1000);
  await enqueueFinalizedPublication(db, id, now);
}
beforeEach(async () => {
  jest.useFakeTimers(); now = 3000; owner = 'A'; db = new TestDatabase(); await schemaAt(db, 10);
  repository = makeRepository(); worker = makeWorker();
  remote.prepareShare.mockResolvedValue(prepared);
  remote.uploadShare.mockResolvedValue({ flightId: 'flight', activityId: 'activity', revision: 1, state: 'shared' });
  remote.hideFlight.mockResolvedValue({ flightId: 'flight', activityId: 'activity', revision: 2, state: 'hidden' });
  sourceExists.mockResolvedValue(true); backupReady.mockResolvedValue(true);
});
afterEach(async () => { worker.invalidate(); jest.clearAllTimers(); jest.useRealTimers(); await db.closeAsync(); jest.resetAllMocks(); });

it('never backfills old recordings and requires matching known consent at capture and finalization', async () => {
  await seedFinal();
  await repository.setPreferences('A', { enabled: true, generation: 'new' });
  await enqueueFinalizedPublication(db, 'flight', now);
  expect(await repository.listPending('A')).toEqual([]);
  await stampCapture(db, 'flight', { ownerUserId: 'A', generation: 'old', operationId: 'op' }, 1000);
  expect(await db.getAllAsync('SELECT * FROM social_capture_stamps')).toEqual([]);
  await stampCapture(db, 'flight', { ownerUserId: 'A', generation: 'new', operationId: 'op' }, 1000);
  await repository.setPreferences('A', { enabled: false, generation: 'disabled' });
  await enqueueFinalizedPublication(db, 'flight', now);
  expect(await repository.listPending('A')).toEqual([]);
});

it('queues once after final metrics and does not resurrect a hidden flight on re-finalization or restart', async () => {
  await automatic();
  expect(await repository.get('A', 'flight')).toMatchObject({ operationId: 'auto-flight', expectedRevision: 0, mode: 'automatic' });
  await repository.queueHide('A', 'flight', 'hide');
  await run();
  repository = makeRepository();
  await enqueueFinalizedPublication(db, 'flight', now);
  expect(await repository.get('A', 'flight')).toMatchObject({ operationId: 'hide', state: 'hidden' });
  expect(remote.prepareShare).not.toHaveBeenCalled();
});

it('invalidates old consent permanently while retaining another owner’s pending intents', async () => {
  await automatic();
  await repository.queueManual('B', 'flight', 'b-op', 9);
  await repository.setPreferences('A', { enabled: false, generation: 'consent-2' });
  await repository.setPreferences('A', { enabled: true, generation: 'consent-3' });
  await enqueueFinalizedPublication(db, 'flight', now);
  await run();
  expect((await repository.get('A', 'flight'))?.state).toBe('cancelled');
  expect((await repository.get('B', 'flight'))?.state).toBe('pending');
  expect(remote.prepareShare).not.toHaveBeenCalled();
});

it('waits for successful backup and does no work during recording or recovery', async () => {
  await automatic();
  worker.setEnvironment({ foreground: true, online: true, recorderReady: false });
  await worker.requestSync(); expect(remote.prepareShare).not.toHaveBeenCalled();
  worker.setEnvironment({ recorderReady: true, recorderBusy: true });
  await worker.requestSync(); expect(remote.prepareShare).not.toHaveBeenCalled();
  backupReady.mockResolvedValue(false); await run();
  expect(remote.prepareShare).not.toHaveBeenCalled();
  expect(await repository.get('A', 'flight')).toMatchObject({ state: 'pending', nextAttemptAt: 33000, attemptCount: 0 });
  now = 33000; backupReady.mockResolvedValue(true); await worker.requestSync();
  expect(await repository.get('A', 'flight')).toMatchObject({ state: 'shared', activityId: 'activity' });
});

it('retries the same operation and frozen revision after a lost upload response and process restart', async () => {
  await repository.queueManual('A', 'flight', 'manual-op', 7);
  remote.uploadShare.mockRejectedValueOnce(new Error('Connection interrupted.'));
  await run();
  expect(await repository.get('A', 'flight')).toMatchObject({ state: 'pending', attemptCount: 1, nextAttemptAt: 33000 });
  await worker.requestSync(); expect(remote.prepareShare).toHaveBeenCalledTimes(1);
  worker.invalidate(); repository = makeRepository(); worker = makeWorker(); now = 33000;
  remote.prepareShare.mockResolvedValue({ ...prepared, alreadyPublished: true });
  await run();
  expect(remote.prepareShare.mock.calls.map(call => call[0])).toEqual([
    { flightId: 'flight', operationId: 'manual-op', mode: 'manual', expectedRevision: 7, consentGeneration: null },
    { flightId: 'flight', operationId: 'manual-op', mode: 'manual', expectedRevision: 7, consentGeneration: null },
  ]);
  expect(remote.uploadShare).toHaveBeenCalledTimes(1);
  expect((await repository.get('A', 'flight'))?.state).toBe('shared');
});

it('does not advance an old owner’s intent after auth changes while prepare is in flight', async () => {
  await automatic();
  let resolve!: (value: PreparedShare) => void;
  remote.prepareShare.mockImplementation(() => new Promise<PreparedShare>(yes => { resolve = yes; }));
  worker.setEnvironment({ foreground: true, online: true, recorderReady: true });
  const running = worker.requestSync();
  while (!resolve) await Promise.resolve();
  owner = 'B'; worker.invalidate(); resolve(prepared); await running;
  expect(remote.uploadShare).not.toHaveBeenCalled();
  expect((await repository.get('A', 'flight'))?.state).toBe('pending');
});

it('honors a durable hide arriving during upload and never lets its late acknowledgement erase suppression', async () => {
  await automatic();
  let resolve!: (value: unknown) => void;
  remote.uploadShare.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  worker.setEnvironment({ foreground: true, online: true, recorderReady: true });
  const running = worker.requestSync(); while (!resolve) await Promise.resolve();
  worker.invalidate(); await repository.queueHide('A', 'flight', 'hide-op');
  resolve({ flightId: 'flight', activityId: 'activity', revision: 1, state: 'shared' }); await running;
  await worker.requestSync();
  expect(await repository.get('A', 'flight')).toMatchObject({ operationId: 'hide-op', state: 'hidden' });
  expect(remote.hideFlight).toHaveBeenCalledTimes(1);
});

it('cancels deleted evidence before upload and persists captured deletion cancellation', async () => {
  await automatic();
  remote.prepareShare.mockImplementation(async () => { sourceExists.mockResolvedValue(false); return prepared; });
  await run();
  expect(remote.uploadShare).not.toHaveBeenCalled();
  expect((await repository.get('A', 'flight'))?.state).toBe('cancelled');
  await cancelDeletedPublication(db, 'flight', now);
  expect(await db.getAllAsync('SELECT * FROM social_capture_stamps')).toEqual([]);
});

it('backs off a remote stale/auth rejection instead of looping and cancels obsolete server revisions', async () => {
  await repository.queueManual('A', 'flight', 'op', 4);
  remote.prepareShare.mockRejectedValueOnce(new SocialError('stale', 'Sign in again.'));
  await run(); await worker.requestSync();
  expect(remote.prepareShare).toHaveBeenCalledTimes(1);
  expect(await repository.get('A', 'flight')).toMatchObject({ attemptCount: 1, nextAttemptAt: 33000 });
  now = 33000;
  remote.prepareShare.mockRejectedValueOnce(new SocialError('publication_changed', 'Changed on another device.'));
  await worker.requestSync();
  expect((await repository.get('A', 'flight'))?.state).toBe('cancelled');
  expect(await repository.nextAttempt('A')).toBeNull();
});

it('rolls back a queued mutation if its owner is revoked before the database transaction commits', async () => {
  let checks = 0;
  await expect(repository.queueManual('A', 'flight', 'op', 3, () => {
    checks += 1;
    if (checks === 2) throw new Error('Owner changed.');
  })).rejects.toThrow('Owner changed');
  expect(await repository.get('A', 'flight')).toBeNull();
});

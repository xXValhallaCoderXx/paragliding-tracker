import { RestoreTransfer, type RestoreTransferDependencies } from '../restore-transfer';
import type { ArchiveDownloadCandidate } from '@/archives/types';
import type { RestoreSnapshot } from '../restore-plan';

const candidate = (id: string): ArchiveDownloadCandidate => ({ ownerUserId: 'A', flightId: id, recordingSessionId: `s-${id}`,
  title: id, startedAt: 0, endedAt: 1000, objectPath: `A/${id}.igc`, sha256: 'hash', byteCount: 3, artifactVersion: 1, attemptCount: 0 });
function fixture() {
  let queue = [candidate('first'), candidate('second')];
  let snapshot!: RestoreSnapshot;
  const deps: RestoreTransferDependencies = {
    list: jest.fn(async () => [...queue]),
    counts: jest.fn(async () => ({ total: 2, completed: 2 - queue.length })),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async (item, _bytes, valid) => { if (valid()) queue = queue.filter(other => other.flightId !== item.flightId); }),
    fail: jest.fn(async () => {}),
    download: jest.fn(async (_item, _signal, progress) => { progress(3); return new Uint8Array([1, 2, 3]); }),
    getPaused: jest.fn(async () => false), setPaused: jest.fn(async () => {}), changed: jest.fn(), publish: value => { snapshot = value; },
  };
  const transfer = new RestoreTransfer(deps);
  transfer.setEnvironment({ foreground: true, recorderReady: true, recorderBusy: false, network: 'wifi' });
  return { transfer, deps, snapshot: () => snapshot };
}

it('automatically restores every queued file once and reports only committed progress', async () => {
  const { transfer, deps, snapshot } = fixture();
  await transfer.setOwner('A');
  await transfer.run(() => true);
  expect(deps.commit).toHaveBeenCalledTimes(2);
  expect(snapshot()).toMatchObject({ phase: 'idle', total: 2, completed: 2, allowMobileData: false });
  await transfer.run(() => true);
  expect(deps.download).toHaveBeenCalledTimes(2);
});
it('waits on cellular until deliberate consent and forgets permission when the run completes', async () => {
  const { transfer, deps, snapshot } = fixture();
  await transfer.setOwner('A');
  transfer.setEnvironment({ network: 'other' });
  await transfer.run(() => true);
  expect(deps.download).not.toHaveBeenCalled();
  expect(snapshot()).toMatchObject({ phase: 'paused', pauseReason: 'wifi' });
  await transfer.resume(true);
  await transfer.run(() => true);
  expect(deps.download).toHaveBeenCalledTimes(2);
  expect(snapshot().allowMobileData).toBe(false);
});
it('aborts on recorder activation and rejects a late download completion', async () => {
  const { transfer, deps, snapshot } = fixture();
  let finish!: (bytes: Uint8Array) => void;
  let signal!: AbortSignal;
  (deps.download as jest.Mock).mockImplementation(async (_item, activeSignal) => {
    signal = activeSignal;
    return new Promise(resolve => { finish = resolve; });
  });
  await transfer.setOwner('A');
  const running = transfer.run(() => true);
  while (!finish) await Promise.resolve();
  transfer.setEnvironment({ recorderBusy: true });
  expect(signal.aborted).toBe(true);
  finish(new Uint8Array([1, 2, 3]));
  await running;
  expect(deps.commit).not.toHaveBeenCalled();
  expect(snapshot()).toMatchObject({ phase: 'paused', pauseReason: 'recording' });
});
it('changing account revokes the old response and its progress callbacks', async () => {
  const { transfer, deps, snapshot } = fixture();
  let finish!: (bytes: Uint8Array) => void;
  let progress!: (bytes: number) => void;
  (deps.download as jest.Mock).mockImplementation(async (_item, _signal, report) => {
    progress = report;
    return new Promise(resolve => { finish = resolve; });
  });
  await transfer.setOwner('A');
  const running = transfer.run(() => true);
  while (!finish) await Promise.resolve();
  await transfer.setOwner('B');
  progress(3); finish(new Uint8Array([1, 2, 3]));
  await running;
  expect(deps.commit).not.toHaveBeenCalled();
  expect(snapshot()).toMatchObject({ phase: 'idle', completed: 0, currentFlightTitle: null });
});
it('persists user pause and restores it after restart', async () => {
  const { transfer, deps, snapshot } = fixture();
  (deps.getPaused as jest.Mock).mockResolvedValue(true);
  await transfer.setOwner('A');
  await transfer.run(() => true);
  expect(deps.download).not.toHaveBeenCalled();
  expect(snapshot().pauseReason).toBe('user');
  await transfer.resume(false);
  expect(deps.setPaused).toHaveBeenCalledWith('A', false);
  await transfer.pause();
  expect(deps.setPaused).toHaveBeenLastCalledWith('A', true);
});
it('continues after one broken artifact and reports the failure without claiming completion', async () => {
  const { transfer, deps, snapshot } = fixture();
  (deps.download as jest.Mock).mockRejectedValueOnce(new Error('Hash mismatch'));
  await transfer.setOwner('A');
  await transfer.run(() => true);
  expect(deps.fail).toHaveBeenCalledWith('A', 'first', 'Hash mismatch');
  expect(deps.commit).toHaveBeenCalledTimes(1);
  expect(snapshot()).toMatchObject({ phase: 'error', completed: 1, lastError: 'Hash mismatch' });
});

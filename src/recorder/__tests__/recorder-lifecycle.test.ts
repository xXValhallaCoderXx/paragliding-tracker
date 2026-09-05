import type { RecorderService, RecorderSnapshot, SessionRecord, PendingSessionRecoveryAttempt } from '../types';
import { RECORDER_CONFIG } from '../config';

// Only native/repository boundaries are replaced. The service, FIFO and recovery policies execute.
let service: RecorderService;
let session: SessionRecord;
let pending: PendingSessionRecoveryAttempt | null;
let nativeStarted: boolean;
let latest: RecorderSnapshot;
let unsubscribe: () => void;
const db = {
  getUnfinishedSession: jest.fn(), getLatestSession: jest.fn(), getSession: jest.fn(),
  getFlightBySessionId: jest.fn(), getSessionSnapshotMetrics: jest.fn(),
  getPendingSessionRecoveryAttempt: jest.fn(), getFinalSessionRecoveryAttempt: jest.fn(),
  beginSessionRecoveryAttempt: jest.fn(), confirmSessionRecoveryAttempt: jest.fn(),
  requestSessionStop: jest.fn(), completeSession: jest.fn(), markSessionInterrupted: jest.fn(), recordEvent: jest.fn(),
};
const native = { start: jest.fn(), stop: jest.fn() };
const proof = { sequence: 2, sourceTimestamp: 99_000, receiptTimestamp: 100_000 };
function storedAttempt(overrides: Partial<PendingSessionRecoveryAttempt> = {}): PendingSessionRecoveryAttempt {
  return { attemptId: 'persisted-attempt', sessionId: 'session', kind: 'automatic', attemptStartedAt: 90_000,
    deadlineAt: 110_000, maximumCachedFixAgeMs: 5000, baselineLocationSequence: 1, provingFix: null, ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function settle() { await jest.advanceTimersByTimeAsync(0); }

beforeEach(() => {
  jest.resetModules(); jest.resetAllMocks(); jest.useFakeTimers(); jest.setSystemTime(100_000);
  nativeStarted = true; pending = null;
  session = { id: 'session', status: 'recording', startedAt: 1000, endedAt: null, manualStopAt: null,
    locationSequence: 1, lastFixAt: 99_000, lastLocationCallbackAt: 99_000 } as SessionRecord;
  db.getUnfinishedSession.mockImplementation(async () => session.status === 'completed' ? null : { ...session });
  db.getLatestSession.mockImplementation(async () => ({ ...session }));
  db.getSession.mockImplementation(async () => ({ ...session }));
  db.getFlightBySessionId.mockResolvedValue({ id: 'flight' });
  db.getSessionSnapshotMetrics.mockImplementation(async () => ({ fixCount: 1, pressureCount: 0, lastLocationCallbackAt: 99_000,
    latestEligibleFixSourceAt: 99_000, latestEligibleFixReceiptAt: 99_000 }));
  db.getPendingSessionRecoveryAttempt.mockImplementation(async () => pending);
  db.getFinalSessionRecoveryAttempt.mockImplementation(async () => pending);
  db.requestSessionStop.mockImplementation(async (_id, stoppedAt) => {
    session = { ...session, status: 'interrupted', manualStopAt: session.manualStopAt ?? stoppedAt };
    pending = null; return session.manualStopAt;
  });
  db.completeSession.mockImplementation(async (_id, endedAt) => { session = { ...session, status: 'completed', endedAt }; });
  db.beginSessionRecoveryAttempt.mockImplementation(async (input) => {
    pending = { ...input, baselineLocationSequence: 1, provingFix: null };
    session = { ...session, status: 'recording' };
    return { ...pending };
  });
  db.confirmSessionRecoveryAttempt.mockImplementation(async () => { pending = null; });
  db.markSessionInterrupted.mockImplementation(async () => { session = { ...session, status: 'interrupted' }; });
  db.recordEvent.mockResolvedValue(undefined);
  native.start.mockImplementation(async () => { nativeStarted = true; });
  native.stop.mockImplementation(async () => { nativeStarted = false; });
  const granted = { status: 'granted', granted: true, android: { accuracy: 'fine' }, ios: { accuracy: 'full' } };
  jest.doMock('../database.native', () => db);
  jest.doMock('../flight-repository.native', () => ({ finalizeFlightForSession: jest.fn(async () => ({ id: 'flight' })) }));
  jest.doMock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: jest.fn() } }));
  jest.doMock('expo-location', () => ({
    Accuracy: { BestForNavigation: 6 }, ActivityType: { Airborne: 5 }, PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined' },
    hasStartedLocationUpdatesAsync: async () => nativeStarted, stopLocationUpdatesAsync: native.stop, startLocationUpdatesAsync: native.start,
    hasServicesEnabledAsync: async () => true, getProviderStatusAsync: async () => ({ locationServicesEnabled: true, gpsAvailable: true }),
    getForegroundPermissionsAsync: async () => granted, getBackgroundPermissionsAsync: async () => granted,
    requestForegroundPermissionsAsync: async () => granted, requestBackgroundPermissionsAsync: async () => granted,
  }));
  jest.doMock('expo-task-manager', () => ({ isAvailableAsync: async () => true, getTaskOptionsAsync: async () => ({ accuracy: 6 }) }));
  jest.doMock('expo-battery', () => ({ isAvailableAsync: async () => false }));
  jest.doMock('expo-sensors', () => ({ Barometer: { isAvailableAsync: async () => false } }));
  jest.doMock('expo-sharing', () => ({ isAvailableAsync: async () => true }));
  jest.doMock('expo-crypto', () => ({ randomUUID: () => 'new-attempt' }));
  jest.doMock('expo-constants', () => ({ expoConfig: {} }));
  jest.doMock('expo-device', () => ({}));
  jest.doMock('expo-file-system', () => ({}));
  jest.isolateModules(() => { service = jest.requireActual('../recorder-service.native').recorderService; });
  unsubscribe = service.subscribe((snapshot) => { latest = snapshot; });
});
afterEach(() => { unsubscribe(); jest.clearAllTimers(); jest.useRealTimers(); });

it('starts persisting Stop immediately even while recovery occupies the lifecycle queue', async () => {
  await service.recover();
  pending = storedAttempt();
  const recovering = service.recover(); await settle();
  const stopping = service.stop();
  expect(db.requestSessionStop).toHaveBeenCalledWith('session', 100_000);
  expect(service.stop()).toBe(stopping);
  await jest.advanceTimersByTimeAsync(RECORDER_CONFIG.reacquisitionPollIntervalMs);
  await recovering; await stopping;
  expect(db.completeSession).toHaveBeenCalledWith('session', 100_000, 'stopped', expect.any(Object));
  expect(latest.state).toBe('completed');
});

it('keeps native capture alive until Stop is durable', async () => {
  await service.recover(); const claim = deferred<number>();
  db.requestSessionStop.mockReturnValueOnce(claim.promise);
  const stopping = service.stop(); await settle();
  expect(native.stop).not.toHaveBeenCalled(); expect(db.completeSession).not.toHaveBeenCalled();
  session = { ...session, status: 'interrupted', manualStopAt: 100_000 }; claim.resolve(100_000);
  await stopping;
  expect(native.stop).toHaveBeenCalledTimes(1); expect(latest.state).toBe('completed');
});

it('leaves capture intact if Stop persistence fails and lets the user retry', async () => {
  await service.recover(); db.requestSessionStop.mockRejectedValueOnce(new Error('disk full'));
  await expect(service.stop()).rejects.toThrow('disk full');
  expect(native.stop).not.toHaveBeenCalled(); expect(latest.state).toBe('recording');
  expect(latest.lastError).toMatchObject({ code: 'storage_error' });
  await service.stop(); expect(latest.state).toBe('completed');
});

it('retries failed completion using the original durable Stop timestamp', async () => {
  await service.recover(); db.completeSession.mockRejectedValueOnce(new Error('disk full'));
  await expect(service.stop()).rejects.toThrow('disk full');
  expect(latest.state).toBe('stopping');
  jest.setSystemTime(200_000); await service.stop();
  expect(db.completeSession.mock.calls.map((call) => call[1])).toEqual([100_000, 100_000]);
  expect(latest).toMatchObject({ state: 'completed', endedAt: 100_000 });
});

it('finishes persisted Stop before inspecting recovery or restarting native capture', async () => {
  session = { ...session, status: 'interrupted', manualStopAt: 80_000 }; pending = storedAttempt({ provingFix: proof });
  await service.recover();
  expect(db.getPendingSessionRecoveryAttempt).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled(); expect(db.confirmSessionRecoveryAttempt).not.toHaveBeenCalled();
  expect(db.completeSession).toHaveBeenCalledWith('session', 80_000, 'stopped', expect.any(Object));
  expect(latest.state).toBe('completed');
});

it('reconciles an existing proven attempt without creating an attempt or restarting capture', async () => {
  pending = storedAttempt({ provingFix: proof }); await service.recover();
  expect(db.confirmSessionRecoveryAttempt).toHaveBeenCalledWith('persisted-attempt', 100_000);
  expect(db.beginSessionRecoveryAttempt).not.toHaveBeenCalled(); expect(native.start).not.toHaveBeenCalled();
  expect(latest.state).toBe('recording');
});

it.each([false, true])('accepts a final queued proof when native task present is %s', async (taskPresent) => {
  nativeStarted = taskPresent; pending = storedAttempt({ deadlineAt: 100_000 });
  const final = deferred<PendingSessionRecoveryAttempt>(); db.getFinalSessionRecoveryAttempt.mockReturnValueOnce(final.promise);
  const recovering = service.recover(); await jest.advanceTimersByTimeAsync(500);
  expect(db.getFinalSessionRecoveryAttempt).toHaveBeenCalledWith('persisted-attempt');
  expect(db.markSessionInterrupted).not.toHaveBeenCalled();
  final.resolve({ ...pending!, provingFix: proof }); await recovering;
  expect(db.confirmSessionRecoveryAttempt).toHaveBeenCalledWith('persisted-attempt', 100_500);
  expect(db.markSessionInterrupted).not.toHaveBeenCalled(); expect(native.start).not.toHaveBeenCalled();
});

it('interrupts recovery only after the final read confirms there is no proof', async () => {
  nativeStarted = false; pending = storedAttempt();
  const recovering = service.recover(); await jest.advanceTimersByTimeAsync(500); await recovering;
  expect(db.getFinalSessionRecoveryAttempt).toHaveBeenCalled();
  expect(db.markSessionInterrupted).toHaveBeenCalledWith('session', 100_500, expect.stringContaining('lost its native location task'), { recoveryFailed: true });
  expect(latest.state).toBe('interrupted');
});

it('tears down the old task, waits for a durable recovery claim, then starts once and proves it', async () => {
  db.getSessionSnapshotMetrics.mockResolvedValue({ lastLocationCallbackAt: 80_000, latestEligibleFixSourceAt: 80_000, latestEligibleFixReceiptAt: 80_000 });
  const claim = deferred<PendingSessionRecoveryAttempt>(); db.beginSessionRecoveryAttempt.mockReturnValueOnce(claim.promise);
  const recovering = service.recover(); await settle();
  expect(native.stop).toHaveBeenCalledTimes(1); expect(db.beginSessionRecoveryAttempt).toHaveBeenCalledTimes(1);
  expect(native.start).not.toHaveBeenCalled();
  pending = storedAttempt({ attemptId: 'new-attempt', attemptStartedAt: 100_000, deadlineAt: 120_000 });
  claim.resolve(pending); await settle();
  expect(native.start).toHaveBeenCalledTimes(1);
  pending = { ...pending, provingFix: proof }; await jest.advanceTimersByTimeAsync(500); await recovering;
  expect(db.confirmSessionRecoveryAttempt).toHaveBeenCalledWith('new-attempt', 100_500);
  expect(latest.state).toBe('recording');
});

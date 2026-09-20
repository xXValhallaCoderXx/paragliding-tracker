import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { NetworkStateType, type NetworkState } from 'expo-network';

import type { AuthSnapshot, SyncSnapshot } from '@/cloud/types';
import { EMPTY_RESTORE } from '@/cloud/restore-plan';
import type { JournalChange } from '@/journal/context';
import type { RecorderActivity } from '@/recorder/types';
import { act, create } from '../../../../tests/support/renderer';
import { CloudSyncProvider, useCloudSync } from '../cloud-sync-provider';

jest.mock('@/cloud/config', () => ({ cloudConfigured: true }));
let mockAuth: AuthSnapshot;
let mockRecorder: { ready: boolean; recovering: boolean; recoveryError: string | null; recoveryVersion: number };
jest.mock('../auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('@/features/record/recorder-lifecycle', () => ({ useRecorderLifecycle: () => mockRecorder }));

let mockSnapshot: SyncSnapshot;
const mockListeners = new Set<(snapshot: SyncSnapshot) => void>();
const mockRequestSync = jest.fn();
const mockAuthChanged = jest.fn();
const mockSetEnvironment = jest.fn();
const mockPauseRestore = jest.fn();
const mockResumeRestore = jest.fn();
const mockRetryRestore = jest.fn();
const mockNetworkRead = jest.fn();
const mockNetworkListeners = new Set<(state: NetworkState) => void>();
const mockActivityListeners = new Set<(activity: RecorderActivity) => void>();
const mockJournalListeners = new Set<(change: JournalChange) => void>();
const mockDispatch = jest.fn();
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', NONE: 'NONE' },
  getNetworkStateAsync: () => mockNetworkRead(),
  addNetworkStateListener: (listener: (state: NetworkState) => void) => {
    mockNetworkListeners.add(listener);
    return { remove: () => mockNetworkListeners.delete(listener) };
  },
}));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: {
  subscribeActivity: (listener: (activity: RecorderActivity) => void) => {
    mockActivityListeners.add(listener);
    listener({ state: 'idle', lifecycleBusy: false });
    return () => mockActivityListeners.delete(listener);
  },
} }));
jest.mock('@/journal/context', () => ({
  subscribeJournal: (listener: (change: JournalChange) => void) => {
    mockJournalListeners.add(listener);
    return () => mockJournalListeners.delete(listener);
  },
}));
jest.mock('@/store', () => ({ store: { dispatch: (action: unknown) => mockDispatch(action) } }));
jest.mock('@/store/api', () => ({ api: { util: {
  resetApiState: () => ({ type: 'api/reset' }),
  invalidateTags: (payload: unknown) => ({ type: 'api/invalidate', payload }),
} } }));
jest.mock('@/cloud/sync-engine', () => ({
  cloudSyncEngine: {
    getSnapshot: () => mockSnapshot,
    subscribe: (listener: (snapshot: SyncSnapshot) => void) => {
      mockListeners.add(listener);
      listener(mockSnapshot);
      return () => mockListeners.delete(listener);
    },
    requestSync: (...args: unknown[]) => mockRequestSync(...args),
    authChanged: (...args: unknown[]) => mockAuthChanged(...args),
    setEnvironment: (...args: unknown[]) => mockSetEnvironment(...args),
    pauseRestore: (...args: unknown[]) => mockPauseRestore(...args),
    resumeRestore: (...args: unknown[]) => mockResumeRestore(...args),
    retryRestore: (...args: unknown[]) => mockRetryRestore(...args),
  },
}));

let observed: ReturnType<typeof useCloudSync>;
function Observer() {
  const value = useCloudSync();
  React.useEffect(() => { observed = value; }, [value]);
  return null;
}
const tree = () => React.createElement(CloudSyncProvider, null, React.createElement(Observer));
let rendered: { update: (element: React.ReactElement) => void; unmount: () => void } | null;
async function render() {
  await act(async () => {
    if (rendered) rendered.update(tree());
    else rendered = create(tree());
  });
}
function publish(patch: Partial<SyncSnapshot>) {
  mockSnapshot = { ...mockSnapshot, ...patch };
  for (const listener of mockListeners) listener(mockSnapshot);
  return mockSnapshot;
}
function pendingCycle() {
  let resolve!: (snapshot: SyncSnapshot) => void;
  const promise = new Promise<SyncSnapshot>((done) => { resolve = done; });
  return { promise, resolve };
}
function pendingNetwork() {
  let resolve!: (state: NetworkState) => void;
  const promise = new Promise<NetworkState>((done) => { resolve = done; });
  return { promise, resolve };
}
const wifi = (): NetworkState => ({ type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: true });
const mobile = (): NetworkState => ({ type: NetworkStateType.CELLULAR, isConnected: true, isInternetReachable: true });
function environment() {
  return Object.assign({}, ...mockSetEnvironment.mock.calls.map(([patch]) => patch));
}
function appState(state: AppStateStatus) {
  AppState.currentState = state;
  for (const listener of mockAppListeners) listener(state);
}

beforeEach(() => {
  rendered = null;
  mockListeners.clear();
  mockAuth = { status: 'signed_in', userId: 'pilot', email: 'pilot@example.test', lastError: null };
  mockRecorder = { ready: false, recovering: false, recoveryError: null, recoveryVersion: 0 };
  mockSnapshot = {
    phase: 'blocked', blockedBy: 'recovering', lastSyncAt: null,
    pendingFlights: 1, pendingDeletions: 0, cloudOnlyFlights: 0,
    linkedUserId: 'pilot', lastError: null,
  };
  mockRequestSync.mockReset().mockImplementation(async () => publish({
    phase: 'idle', blockedBy: null, pendingFlights: 0, lastSyncAt: 1000,
  }));
  mockAuthChanged.mockReset().mockResolvedValue(undefined);
  mockSetEnvironment.mockReset();
  mockPauseRestore.mockReset();
  mockResumeRestore.mockReset();
  mockRetryRestore.mockReset();
  mockDispatch.mockReset();
  mockNetworkRead.mockReset().mockImplementation(() => new Promise(() => {}));
  mockNetworkListeners.clear();
  mockActivityListeners.clear();
  mockJournalListeners.clear();
  mockAppListeners.clear();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    mockAppListeners.add(listener);
    return { remove: () => { mockAppListeners.delete(listener); } };
  });
});
afterEach(async () => {
  if (rendered) await act(async () => rendered?.unmount());
  jest.restoreAllMocks();
});

it('starts backup when cold-launch recovery finishes and keeps the request callback stable', async () => {
  await render();
  const request = observed.requestSync;
  expect(mockRequestSync).not.toHaveBeenCalled();
  mockRecorder = { ...mockRecorder, recovering: true };
  await render();
  expect(mockRequestSync).not.toHaveBeenCalled();

  mockRecorder = { ...mockRecorder, ready: true, recovering: false };
  await render();

  expect(mockRequestSync).toHaveBeenCalledTimes(1);
  expect(mockRequestSync).toHaveBeenCalledWith('post-sign-in', { recorderRecovering: false });
  expect(observed).toMatchObject({ phase: 'idle', pendingFlights: 0, lastSyncAt: 1000 });
  expect(observed.requestSync).toBe(request);
  await render();
  expect(mockRequestSync).toHaveBeenCalledTimes(1);
});

it('retries after a completed recovery request joins an older blocked cycle', async () => {
  const blocked = pendingCycle();
  mockRequestSync.mockReturnValueOnce(blocked.promise).mockReturnValueOnce(blocked.promise);
  mockRecorder = { ...mockRecorder, ready: true, recovering: true };
  await render();
  await act(async () => observed.requestSync('foreground'));
  expect(mockRequestSync).toHaveBeenLastCalledWith('foreground', { recorderRecovering: true });

  mockRecorder = { ...mockRecorder, recovering: false };
  await render();
  expect(mockRequestSync).toHaveBeenCalledTimes(2);
  expect(observed.phase).toBe('blocked');

  await act(async () => blocked.resolve(mockSnapshot));

  expect(mockRequestSync).toHaveBeenCalledTimes(3);
  expect(mockRequestSync).toHaveBeenLastCalledWith('post-sign-in', { recorderRecovering: false });
  expect(observed).toMatchObject({ phase: 'idle', blockedBy: null, pendingFlights: 0 });
});

it.each(['sign-out', 'recovery', 'unmount'] as const)(
  'cancels the follow-up when %s occurs before the older cycle settles',
  async (change) => {
    const blocked = pendingCycle();
    mockRequestSync.mockReturnValueOnce(blocked.promise);
    mockRecorder = { ...mockRecorder, ready: true, recovering: false };
    await render();
    expect(mockRequestSync).toHaveBeenCalledTimes(1);

    if (change === 'sign-out') {
      mockAuth = { ...mockAuth, status: 'signed_out', userId: null, email: null };
      await render();
    } else if (change === 'recovery') {
      mockRecorder = { ...mockRecorder, recovering: true };
      await render();
    } else {
      await act(async () => rendered?.unmount());
      rendered = null;
    }
    await act(async () => blocked.resolve(mockSnapshot));
    expect(mockRequestSync).toHaveBeenCalledTimes(1);
  },
);

it('does not start a backup for a signed-out pilot when recovery finishes', async () => {
  mockAuth = { ...mockAuth, status: 'signed_out', userId: null, email: null };
  mockRecorder.recovering = true;
  await render();
  mockRecorder = { ...mockRecorder, ready: true, recovering: false };
  await render();
  expect(mockRequestSync).not.toHaveBeenCalled();
});

it('gives restoration the passive recorder and foreground policy without starting sensors', async () => {
  mockRecorder = { ...mockRecorder, ready: true };
  mockNetworkRead.mockResolvedValueOnce(wifi());
  await render();
  expect(environment()).toMatchObject({ foreground: true, recorderReady: true, recorderBusy: false, network: 'wifi' });

  // Arming revokes eligibility synchronously, before a recorder operation awaits anything.
  for (const listener of mockActivityListeners) listener({ state: 'idle', lifecycleBusy: true });
  expect(environment().recorderBusy).toBe(true);
  for (const listener of mockActivityListeners) listener({ state: 'recording', lifecycleBusy: false });
  expect(environment().recorderBusy).toBe(true);
  for (const listener of mockActivityListeners) listener({ state: 'completed', lifecycleBusy: false });
  expect(environment().recorderBusy).toBe(false);
  await act(async () => appState('background'));
  expect(environment().foreground).toBe(false);
});

it('restores readiness after a fast foreground recovery batches back to the same flags', async () => {
  mockRecorder = { ...mockRecorder, ready: true, recoveryVersion: 1 };
  await render();
  await act(async () => { appState('background'); appState('active'); });
  expect(environment().recorderReady).toBe(false);
  mockRecorder = { ...mockRecorder, recoveryVersion: 2 };
  await render();
  expect(environment().recorderReady).toBe(true);
  mockRecorder = { ...mockRecorder, recoveryError: 'Recovery failed', recoveryVersion: 3 };
  await render();
  expect(environment().recorderReady).toBe(false);
});

it('lets a newer native network event supersede a pending connectivity read', async () => {
  const oldRead = pendingNetwork();
  mockNetworkRead.mockReturnValueOnce(oldRead.promise);
  await render();
  await act(async () => {
    for (const listener of mockNetworkListeners) listener(mobile());
  });
  expect(environment().network).toBe('other');
  await act(async () => oldRead.resolve(wifi()));
  expect(environment().network).toBe('other');
});

it('rechecks connectivity on foreground and ignores an older overlapping read', async () => {
  const oldRead = pendingNetwork();
  const currentRead = pendingNetwork();
  mockNetworkRead.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(currentRead.promise);
  await render();
  await act(async () => { appState('background'); appState('active'); });
  expect(mockNetworkRead).toHaveBeenCalledTimes(2);
  await act(async () => currentRead.resolve(mobile()));
  await act(async () => oldRead.resolve(wifi()));
  expect(environment().network).toBe('other');
});

it('refreshes account ownership on auth changes and resets only owner-scoped query caches', async () => {
  await render();
  expect(mockAuthChanged).toHaveBeenCalledTimes(1);
  await act(async () => {
    for (const listener of mockJournalListeners) listener({ kind: 'artifact', flightId: 'flight-a' });
  });
  expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'api/invalidate', payload: [
    { type: 'Flight', id: 'LIST' }, { type: 'Flight', id: 'flight-a' },
    { type: 'FlightTrack', id: 'LIST' }, { type: 'FlightTrack', id: 'flight-a' },
    { type: 'FlightReplay', id: 'flight-a' },
  ] });

  mockAuth = { ...mockAuth, status: 'signed_out', userId: null, email: null };
  await render();
  expect(mockAuthChanged).toHaveBeenCalledTimes(2);
  // Cached visibility is decided by the journal. A sign-out alone does not purge it.
  expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'api/reset' });
  mockAuth = { ...mockAuth, status: 'signed_in', userId: 'other-pilot' };
  await render();
  expect(mockAuthChanged).toHaveBeenCalledTimes(3);
  await act(async () => {
    for (const listener of mockJournalListeners) listener({ kind: 'owner' });
  });
  expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'api/reset' });
});

it('forwards explicit pause, resume and retry choices and supplies a safe empty restore snapshot', async () => {
  await render();
  expect(observed.restore).toEqual(EMPTY_RESTORE);
  observed.pauseRestore();
  observed.resumeRestore({ allowMobileData: true });
  observed.retryRestore({ allowMobileData: false });
  expect(mockPauseRestore).toHaveBeenCalledTimes(1);
  expect(mockResumeRestore).toHaveBeenCalledWith({ allowMobileData: true });
  expect(mockRetryRestore).toHaveBeenCalledWith({ allowMobileData: false });
  await act(async () => { publish({ restore: { ...EMPTY_RESTORE, phase: 'restoring', total: 3, completed: 1 } }); });
  expect(observed.restore).toMatchObject({ phase: 'restoring', total: 3, completed: 1 });
});

it('unsubscribes all boundaries and ignores a connectivity read that finishes after unmount', async () => {
  const pending = pendingNetwork();
  mockNetworkRead.mockReturnValueOnce(pending.promise);
  await render();
  expect(mockNetworkListeners.size).toBe(1);
  expect(mockActivityListeners.size).toBe(1);
  expect(mockJournalListeners.size).toBe(1);
  await act(async () => rendered?.unmount());
  rendered = null;
  expect(mockNetworkListeners.size).toBe(0);
  expect(mockActivityListeners.size).toBe(0);
  expect(mockJournalListeners.size).toBe(0);
  expect(mockListeners.size).toBe(0);
  expect(mockAppListeners.size).toBe(0);
  expect(environment().foreground).toBe(false);
  const callCount = mockSetEnvironment.mock.calls.length;
  await act(async () => pending.resolve(wifi()));
  expect(mockSetEnvironment).toHaveBeenCalledTimes(callCount);
});

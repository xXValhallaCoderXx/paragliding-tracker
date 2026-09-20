import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';

import { act, create } from '../../../tests/support/renderer';
import type { RecorderActivity } from '@/recorder/types';
import type { OfflineEnvironment, OfflineMapSnapshot } from '../types';
import { OfflineMapsProvider, useOfflineMaps } from '../runtime';

let mockLifecycle: { ready: boolean; recovering: boolean; recoveryError: string | null; recoveryVersion: number };
jest.mock('@/features/record/recorder-lifecycle', () => ({ useRecorderLifecycle: () => mockLifecycle }));
jest.mock('../backend', () => ({ nativeOfflineBackend: {} }));
jest.mock('../registry', () => ({ createOfflineRegistry: () => ({}) }));
jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', NONE: 'NONE', UNKNOWN: 'UNKNOWN' },
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: jest.fn(),
}));

const mockActivityListeners = new Set<(activity: RecorderActivity) => void>();
let mockActivity: RecorderActivity;
const mockSubscribeActivity = jest.fn((listener: (activity: RecorderActivity) => void) => {
  mockActivityListeners.add(listener);
  listener(mockActivity);
  return jest.fn(() => { mockActivityListeners.delete(listener); });
});
jest.mock('@/recorder/recorder-service', () => ({
  recorderService: { subscribeActivity: (listener: (activity: RecorderActivity) => void) => mockSubscribeActivity(listener) },
}));

let mockSnapshot: OfflineMapSnapshot;
const mockSnapshotListeners = new Set<(snapshot: OfflineMapSnapshot) => void>();
const mockService = {
  getSnapshot: () => mockSnapshot,
  subscribe: (listener: (snapshot: OfflineMapSnapshot) => void) => {
    mockSnapshotListeners.add(listener);
    listener(mockSnapshot);
    return () => { mockSnapshotListeners.delete(listener); };
  },
  initialize: jest.fn(async () => undefined),
  refresh: jest.fn(async () => undefined),
  setEnvironment: jest.fn((_environment: OfflineEnvironment) => undefined),
  dispose: jest.fn(),
};
jest.mock('../service', () => ({ OfflineMapService: jest.fn(() => mockService) }));

let observed: ReturnType<typeof useOfflineMaps>;
function Observer() {
  const value = useOfflineMaps();
  React.useEffect(() => { observed = value; }, [value]);
  return null;
}
const tree = (strict = false) => {
  const provider = React.createElement(OfflineMapsProvider, null, React.createElement(Observer));
  return strict ? React.createElement(React.StrictMode, null, provider) : provider;
};
let rendered: { update: (element: React.ReactElement) => void; unmount: () => void } | null;
const appListeners = new Set<(state: AppStateStatus) => void>();
const networkListeners = new Set<(state: Network.NetworkState) => void>();
const appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
const wifi: Network.NetworkState = { type: Network.NetworkStateType.WIFI, isConnected: true, isInternetReachable: true };
const cellular: Network.NetworkState = { ...wifi, type: Network.NetworkStateType.CELLULAR };
const disconnected: Network.NetworkState = { type: Network.NetworkStateType.NONE, isConnected: false, isInternetReachable: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function appState(state: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
  for (const listener of appListeners) listener(state);
}
function activity(value: RecorderActivity) {
  mockActivity = value;
  for (const listener of mockActivityListeners) listener(value);
}
async function render(strict = false) {
  await act(async () => {
    if (rendered) rendered.update(tree(strict));
    else rendered = create(tree(strict));
  });
}

beforeEach(() => {
  rendered = null;
  appListeners.clear(); networkListeners.clear(); mockActivityListeners.clear(); mockSnapshotListeners.clear();
  mockLifecycle = { ready: true, recovering: false, recoveryError: null, recoveryVersion: 1 };
  mockActivity = { state: 'idle', lifecycleBusy: false };
  mockSnapshot = { initialized: true, loading: false, regions: [], storage: null, error: null };
  mockService.initialize.mockClear(); mockService.refresh.mockClear(); mockService.setEnvironment.mockClear(); mockService.dispose.mockClear();
  mockSubscribeActivity.mockClear();
  jest.replaceProperty(Platform, 'OS', 'android');
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appListeners.add(listener);
    return { remove: jest.fn(() => { appListeners.delete(listener); }) };
  });
  jest.mocked(Network.getNetworkStateAsync).mockReset().mockResolvedValue(wifi);
  jest.mocked(Network.addNetworkStateListener).mockReset().mockImplementation((listener) => {
    networkListeners.add(listener);
    return { remove: jest.fn(() => { networkListeners.delete(listener); }) };
  });
});
afterEach(async () => {
  if (rendered) await act(async () => rendered?.unmount());
  rendered = null;
  Object.defineProperty(AppState, 'currentState', appStateDescriptor);
  jest.restoreAllMocks();
});

it('a completed recovery version restores readiness after a batched fast foreground recovery', async () => {
  await render();
  expect(observed.environment).toMatchObject({ recorderReady: true, recorderBusy: false, network: 'wifi' });
  mockService.refresh.mockClear(); mockService.setEnvironment.mockClear();
  await act(async () => {
    appState('background');
    appState('active');
    // The recovering=true intermediate render was batched away. Only this completion
    // version differs from the previous context, reproducing a fast successful recover.
    mockLifecycle = { ...mockLifecycle, recoveryVersion: 2 };
    rendered!.update(tree());
  });
  const readiness = mockService.setEnvironment.mock.calls.map(([environment]) => environment.recorderReady);
  expect(readiness).toContain(false);
  expect(observed.environment).toMatchObject({ foreground: true, recorderReady: true, recorderBusy: false });
  expect(mockService.refresh).toHaveBeenCalledTimes(2); // Foreground reconciliation, then eligible cleanup.
  expect(mockService.setEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ recorderReady: true }));
});

it('foreground reconciliation defers eligible cleanup until recorder recovery and activity both settle', async () => {
  await render(); mockService.refresh.mockClear();
  await act(async () => {
    appState('background');
    activity({ state: 'completed', lifecycleBusy: true });
    appState('active');
    mockLifecycle = { ...mockLifecycle, recoveryVersion: 2 };
    rendered!.update(tree());
  });
  expect(observed.environment).toMatchObject({ recorderReady: true, recorderBusy: true });
  expect(mockService.refresh).toHaveBeenCalledTimes(1);
  await act(async () => { activity({ state: 'completed', lifecycleBusy: false }); });
  expect(mockService.refresh).toHaveBeenCalledTimes(2);
  expect(observed.environment.recorderBusy).toBe(false);
});

it('failed foreground recovery keeps downloads ineligible and does not trigger cleanup', async () => {
  await render(); mockService.refresh.mockClear();
  await act(async () => {
    appState('active');
    mockLifecycle = { ...mockLifecycle, recoveryVersion: 2, recoveryError: 'Storage unavailable' };
    rendered!.update(tree());
  });
  expect(observed.environment.recorderReady).toBe(false);
  expect(mockService.refresh).toHaveBeenCalledTimes(1);
});

it('a stale initial network read cannot replace the newer foreground read', async () => {
  const initial = deferred<Network.NetworkState>();
  const foreground = deferred<Network.NetworkState>();
  jest.mocked(Network.getNetworkStateAsync).mockReturnValueOnce(initial.promise).mockReturnValueOnce(foreground.promise);
  await render();
  await act(async () => { appState('active'); foreground.resolve(cellular); });
  expect(observed.environment.network).toBe('other');
  await act(async () => { initial.resolve(wifi); });
  expect(observed.environment.network).toBe('other');
});

it('a network event supersedes pending reads and their later errors', async () => {
  const pending = deferred<Network.NetworkState>();
  jest.mocked(Network.getNetworkStateAsync).mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => { for (const listener of networkListeners) listener(disconnected); });
  expect(observed.environment.network).toBe('offline');
  await act(async () => { pending.reject(new Error('stale read failed')); });
  expect(observed.environment.network).toBe('offline');
});

it('genuine unmount removes external listeners, pauses immediately and disposes before stale network results', async () => {
  const pending = deferred<Network.NetworkState>();
  jest.mocked(Network.getNetworkStateAsync).mockReturnValueOnce(pending.promise);
  await render();
  expect(appListeners.size).toBe(1); expect(networkListeners.size).toBe(1); expect(mockActivityListeners.size).toBe(1);
  await act(async () => { rendered!.unmount(); }); rendered = null;
  expect(mockService.setEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ foreground: false }));
  expect(mockService.dispose).toHaveBeenCalledTimes(1);
  expect(appListeners.size).toBe(0); expect(networkListeners.size).toBe(0); expect(mockActivityListeners.size).toBe(0);
  expect(mockSnapshotListeners.size).toBe(0);
  const calls = mockService.setEnvironment.mock.calls.length;
  await act(async () => { pending.resolve(wifi); });
  expect(mockService.setEnvironment).toHaveBeenCalledTimes(calls);
});

it('StrictMode effect reattachment keeps the current service alive, then disposes on real unmount', async () => {
  await render(true);
  // Assert the renderer actually exercised the detach/reattach lifecycle; otherwise
  // merely observing zero disposals would not test the race this guard prevents.
  expect(Network.addNetworkStateListener).toHaveBeenCalledTimes(2);
  expect(mockSubscribeActivity).toHaveBeenCalledTimes(2);
  expect(appListeners.size).toBe(1); expect(networkListeners.size).toBe(1); expect(mockActivityListeners.size).toBe(1);
  expect(mockService.dispose).not.toHaveBeenCalled();
  await act(async () => { for (const listener of networkListeners) listener(cellular); });
  expect(observed.environment).toMatchObject({ foreground: true, recorderReady: true, recorderBusy: false, network: 'other' });
  await act(async () => { rendered!.unmount(); }); rendered = null;
  expect(mockService.dispose).toHaveBeenCalledTimes(1);
});

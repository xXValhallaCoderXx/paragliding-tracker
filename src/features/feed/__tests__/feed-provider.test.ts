import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { NetworkState } from 'expo-network';
import type { AuthSnapshot } from '@/cloud/types';
import type { FeedContextValue } from '@/social/feed-types';
import { FeedProvider, useFeed } from '../feed-provider';
import { create, act } from '../../../../tests/support/renderer';
import { replayArtifact, sharedFlight } from './fixtures';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let mockAuth: AuthSnapshot;
let mockFriendsRevision = 0;
let mockLifecycle = { ready: true, recovering: false, recoveryError: null, recoveryVersion: 0 };
const mockAuthListeners = new Set<() => void>();
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
const mockNetworkListeners = new Set<(state: NetworkState) => void>();
const mockActivityListeners = new Set<(state: { lifecycleBusy: boolean; state: string }) => void>();
const mockNetworkRead = jest.fn();
const mockGetFeed = jest.fn();
const mockGetPreferences = jest.fn();
const mockSetAutoShare = jest.fn();
const mockGetDetail = jest.fn();
const mockGetReplay = jest.fn();
const mockGetPublication = jest.fn();
const mockRememberPreferences = jest.fn();
const mockPublicationAuth = jest.fn();
const mockPublicationEnvironment = jest.fn();
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => ({ revision: mockFriendsRevision }) }));
jest.mock('@/features/record/recorder-lifecycle', () => ({ useRecorderLifecycle: () => mockLifecycle }));
jest.mock('@/cloud/auth-service', () => ({ cloudAuthService: {
  getSnapshot: () => mockAuth,
  subscribe: (listener: () => void) => { mockAuthListeners.add(listener); listener(); return () => { mockAuthListeners.delete(listener); }; },
} }));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: {
  subscribeActivity: (listener: (state: { lifecycleBusy: boolean; state: string }) => void) => {
    mockActivityListeners.add(listener); listener({ lifecycleBusy: false, state: 'idle' });
    return () => { mockActivityListeners.delete(listener); };
  },
} }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => mockNetworkRead(),
  addNetworkStateListener: (listener: (state: NetworkState) => void) => { mockNetworkListeners.add(listener); return { remove: () => { mockNetworkListeners.delete(listener); } }; },
}));
jest.mock('@/social/feed-api', () => ({ feedService: {
  getFeed: (...args: unknown[]) => mockGetFeed(...args), getPreferences: (...args: unknown[]) => mockGetPreferences(...args),
  setAutoShare: (...args: unknown[]) => mockSetAutoShare(...args), getDetail: (...args: unknown[]) => mockGetDetail(...args),
  getReplay: (...args: unknown[]) => mockGetReplay(...args), getPublication: (...args: unknown[]) => mockGetPublication(...args),
} }));
jest.mock('@/cloud/publication-service', () => ({ publicationService: {
  setPreferences: (...args: unknown[]) => mockRememberPreferences(...args), authChanged: () => mockPublicationAuth(),
  setEnvironment: (...args: unknown[]) => mockPublicationEnvironment(...args),
} }));

const wifi = { isConnected: true, isInternetReachable: true } as NetworkState;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let latest: FeedContextValue;
let snapshots: FeedContextValue[];
function Observer() {
  const value = useFeed();
  React.useLayoutEffect(() => { latest = value; snapshots.push(value); }, [value]);
  return null;
}
const tree = () => React.createElement(FeedProvider, null, React.createElement(Observer));
let rendered: ReturnType<typeof create> | undefined;
async function run(operation: () => unknown) { await act(async () => { await operation(); }); }
async function render() { await run(() => { if (rendered) rendered.update(tree()); else rendered = create(tree()); }); }
beforeEach(() => {
  jest.clearAllMocks(); rendered = undefined; snapshots = []; mockFriendsRevision = 0;
  mockLifecycle = { ready: true, recovering: false, recoveryError: null, recoveryVersion: 0 };
  mockAuth = { status: 'signed_in', userId: A, email: 'a@example.test', lastError: null };
  mockAuthListeners.clear(); mockAppListeners.clear(); mockNetworkListeners.clear(); mockActivityListeners.clear();
  mockNetworkRead.mockReset().mockResolvedValue(wifi);
  mockGetFeed.mockReset().mockImplementation(async () => ({ items: [sharedFlight({ activityId: `post-${mockAuth.userId}` })], nextCursor: null }));
  mockGetPreferences.mockReset().mockResolvedValue({ enabled: false, generation: null });
  mockSetAutoShare.mockReset().mockResolvedValue({ enabled: true, generation: 'generation-1' });
  mockGetDetail.mockReset().mockResolvedValue(sharedFlight());
  mockGetReplay.mockReset().mockResolvedValue(replayArtifact());
  mockGetPublication.mockReset().mockResolvedValue({ flightId: 'flight-1', state: 'private', activityId: null, revision: 0 });
  mockRememberPreferences.mockReset().mockResolvedValue(undefined); mockPublicationAuth.mockReset().mockResolvedValue(undefined);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    mockAppListeners.add(listener); return { remove: () => { mockAppListeners.delete(listener); } };
  });
});
afterEach(async () => { if (rendered) await run(() => rendered!.unmount()); jest.restoreAllMocks(); });

it.each(['signout', 'switch'] as const)('clears old feed data in the first committed render after %s', async reason => {
  await render();
  expect(latest.items[0]?.activityId).toBe(`post-${A}`);
  snapshots = [];
  mockAuth = { ...mockAuth, status: reason === 'signout' ? 'signed_out' : 'signed_in', userId: reason === 'signout' ? null : B };
  await render();
  expect(snapshots[0].items).toEqual([]);
  expect(snapshots[0].preferences).toBeNull();
  expect(snapshots.every(value => value.items.every(item => item.activityId !== `post-${A}`))).toBe(true);
});

it('clears background memory and requires a fresh network read on foreground', async () => {
  await render();
  const reads = mockGetFeed.mock.calls.length;
  await run(() => { for (const listener of mockAppListeners) listener('background'); });
  expect(latest).toMatchObject({ available: false, items: [], preferences: null });
  expect(mockGetFeed).toHaveBeenCalledTimes(reads);
  const pending = deferred<NetworkState>(); mockNetworkRead.mockReturnValueOnce(pending.promise);
  await run(() => { for (const listener of mockAppListeners) listener('active'); });
  expect(latest.available).toBe(false);
  await run(() => pending.resolve(wifi));
  expect(latest.available).toBe(true);
  expect(mockGetFeed.mock.calls.length).toBeGreaterThan(reads);
});

it('does not let an older network read override a newer offline event', async () => {
  const pending = deferred<NetworkState>(); mockNetworkRead.mockReturnValueOnce(pending.promise);
  await render();
  await run(() => { for (const listener of mockNetworkListeners) listener({ isConnected: false } as NetworkState); pending.resolve(wifi); });
  expect(latest.available).toBe(false);
  expect(mockGetFeed).not.toHaveBeenCalled();
  await run(() => { for (const listener of mockNetworkListeners) listener(wifi); });
  expect(latest.available).toBe(true);
});

it('invalidates pending detail data after the accepted-friends revision changes', async () => {
  await render();
  const pending = deferred<ReturnType<typeof sharedFlight>>(); mockGetDetail.mockReturnValueOnce(pending.promise);
  let reading!: Promise<ReturnType<typeof sharedFlight>>;
  await run(() => { reading = latest.getDetail('activity-1'); });
  const rejected = expect(reading).rejects.toMatchObject({ code: 'stale' });
  const priorRevision = latest.revision;
  mockFriendsRevision += 1;
  await render();
  await run(() => pending.resolve(sharedFlight()));
  await rejected;
  expect(latest.revision).toBeGreaterThan(priorRevision);
});

it('aborts replay immediately when recorder activity arms and forwards the lifecycle gate', async () => {
  await render();
  const pending = deferred<ReturnType<typeof replayArtifact>>(); mockGetReplay.mockReturnValueOnce(pending.promise);
  let reading!: Promise<ReturnType<typeof replayArtifact>>;
  await run(() => { reading = latest.getReplay('activity-1', sharedFlight().artifact); });
  const rejected = expect(reading).rejects.toMatchObject({ code: 'stale' });
  const signal = mockGetReplay.mock.calls.at(-1)![2] as AbortSignal;
  await run(() => { for (const listener of mockActivityListeners) listener({ lifecycleBusy: true, state: 'idle' }); });
  expect(signal.aborted).toBe(true);
  expect(latest.recorderBusy).toBe(true);
  expect(mockPublicationEnvironment).toHaveBeenCalledWith({ recorderBusy: true });
  await run(() => pending.resolve(replayArtifact()));
  await rejected;
  mockLifecycle = { ...mockLifecycle, ready: false, recovering: true };
  await render();
  expect(mockPublicationEnvironment).toHaveBeenLastCalledWith({ recorderReady: false });
});

it('reasserts publication readiness after a fast batched recovery changes only its version', async () => {
  await render();
  mockPublicationEnvironment.mockClear();
  mockLifecycle = { ...mockLifecycle, recoveryVersion: mockLifecycle.recoveryVersion + 1 };
  await render();
  expect(mockPublicationEnvironment).toHaveBeenCalledWith({ recorderReady: true });
});

it('keeps callbacks stable through refreshes but rejects an old-account action', async () => {
  await render();
  const previous = latest;
  await run(() => latest.refresh());
  expect(latest.getDetail).toBe(previous.getDetail);
  expect(latest.getPublication).toBe(previous.getPublication);
  mockAuth = { ...mockAuth, userId: B };
  await render();
  await expect(previous.setAutoShare(true)).rejects.toMatchObject({ code: 'stale' });
  expect(mockSetAutoShare).not.toHaveBeenCalled();
});

it('removes every external listener and ignores late reads after unmount', async () => {
  const pending = deferred<NetworkState>(); mockNetworkRead.mockReturnValueOnce(pending.promise);
  await render();
  await run(() => rendered!.unmount()); rendered = undefined;
  expect(mockAuthListeners.size).toBe(0);
  expect(mockAppListeners.size).toBe(0);
  expect(mockNetworkListeners.size).toBe(0);
  expect(mockActivityListeners.size).toBe(0);
  await run(() => pending.resolve(wifi));
  expect(mockGetFeed).not.toHaveBeenCalled();
  expect(mockPublicationEnvironment).toHaveBeenLastCalledWith({ foreground: false, online: false });
});

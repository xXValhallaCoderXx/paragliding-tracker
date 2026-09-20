import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { NetworkState } from 'expo-network';
import type { AuthSnapshot } from '@/cloud/types';
import type { FriendsContextValue } from '../types';
import { act, create } from '../../../tests/support/renderer';
import { FriendsProvider, useFriends } from '@/features/friends/friends-provider';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let mockAuth: AuthSnapshot;
const mockAuthListeners = new Set<() => void>();
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
const mockNetworkListeners = new Set<(state: NetworkState) => void>();
const mockNetworkRead = jest.fn();
const mockGetState = jest.fn();
const mockSaveProfile = jest.fn();
const mockGetProfile = jest.fn();
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('@/cloud/auth-service', () => ({ cloudAuthService: {
  getSnapshot: () => mockAuth,
  subscribe: (listener: () => void) => { mockAuthListeners.add(listener); listener(); return () => mockAuthListeners.delete(listener); },
} }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => mockNetworkRead(),
  addNetworkStateListener: (listener: (state: NetworkState) => void) => {
    mockNetworkListeners.add(listener); return { remove: () => mockNetworkListeners.delete(listener) };
  },
}));
jest.mock('../api', () => ({ socialService: {
  getState: (...args: unknown[]) => mockGetState(...args), saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
  getFriendProfile: (...args: unknown[]) => mockGetProfile(...args),
} }));
const wifi = { isConnected: true, isInternetReachable: true };
const dto = (userId = A) => ({ profile: { userId, displayName: userId === A ? 'First pilot' : 'Second pilot', backedUpFlightCount: 1 }, inviteCode: 'ABCD2345EFGH', relationships: [] });
let observed: FriendsContextValue;
let renders: FriendsContextValue[];
function Observer() {
  const value = useFriends();
  // Observe each committed render before the provider's passive identity effect.
  React.useLayoutEffect(() => { observed = value; renders.push(value); }, [value]);
  return null;
}
const tree = () => React.createElement(FriendsProvider, null, React.createElement(Observer));
let rendered: ReturnType<typeof create> | undefined;
async function render() { await act(async () => { if (rendered) rendered.update(tree()); else rendered = create(tree()); }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  rendered = undefined; renders = [];
  mockAuth = { status: 'signed_in', userId: A, email: 'a@example.test', lastError: null };
  mockAuthListeners.clear(); mockAppListeners.clear(); mockNetworkListeners.clear();
  mockNetworkRead.mockReset().mockResolvedValue(wifi);
  mockGetState.mockReset().mockImplementation(async () => dto(mockAuth.userId!));
  mockSaveProfile.mockReset().mockResolvedValue(undefined);
  mockGetProfile.mockReset().mockResolvedValue(dto(B).profile);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    mockAppListeners.add(listener); return { remove: () => { mockAppListeners.delete(listener); } };
  });
});
afterEach(async () => { if (rendered) await act(async () => rendered!.unmount()); jest.restoreAllMocks(); });

it.each(['signout', 'switch'] as const)('hides A in the first render after %s before identity effects update the controller', async change => {
  await render();
  expect(observed.profile?.userId).toBe(A);
  renders = [];
  mockAuth = { ...mockAuth, status: change === 'signout' ? 'signed_out' : 'signed_in', userId: change === 'signout' ? null : B };
  await render();
  expect(renders[0].profile).toBeNull();
  expect(renders[0].inviteCode).toBeNull();
  expect(renders[0].relationships).toEqual([]);
  expect(renders.every(snapshot => snapshot.profile?.userId !== A)).toBe(true);
});
it('keeps read callbacks stable through cache revisions and rejects an old owner confirmation', async () => {
  await render();
  const old = observed;
  await act(async () => { await observed.refresh(); });
  expect(observed.refresh).toBe(old.refresh);
  expect(observed.getFriendProfile).toBe(old.getFriendProfile);
  expect(observed.revision).toBeGreaterThan(old.revision);
  mockAuth = { ...mockAuth, userId: B };
  await render();
  await expect(old.saveProfile('Wrong account')).rejects.toMatchObject({ code: 'stale' });
  expect(mockSaveProfile).not.toHaveBeenCalled();
});
it('clears memory in the background and fetches fresh state on foreground without polling', async () => {
  await render();
  const calls = mockGetState.mock.calls.length;
  await act(async () => {
    AppState.currentState = 'background';
    for (const listener of mockAppListeners) listener('background');
  });
  expect(observed).toMatchObject({ profile: null, inviteCode: null, available: false });
  expect(mockGetState).toHaveBeenCalledTimes(calls);
  await act(async () => {
    AppState.currentState = 'active';
    for (const listener of mockAppListeners) listener('active');
  });
  expect(observed).toMatchObject({ available: true, profile: dto().profile });
  expect(mockGetState.mock.calls.length).toBeGreaterThan(calls);
});
it('does not let a stale network read undo a newer offline event, and refreshes on reconnect', async () => {
  const read = deferred<unknown>();
  mockNetworkRead.mockReturnValueOnce(read.promise);
  await render();
  await act(async () => {
    for (const listener of mockNetworkListeners) listener({ isConnected: false } as NetworkState);
    read.resolve(wifi);
  });
  expect(observed.available).toBe(false);
  expect(mockGetState).not.toHaveBeenCalled();
  await act(async () => { for (const listener of mockNetworkListeners) listener(wifi as NetworkState); });
  expect(observed.profile?.userId).toBe(A);
});
it('rejects a pending mutation after unmount instead of delivering a stale success', async () => {
  await render();
  const reply = deferred<void>();
  mockSaveProfile.mockReturnValueOnce(reply.promise);
  let mutation!: Promise<void>;
  await act(async () => { mutation = observed.saveProfile('Draft'); });
  const rejected = expect(mutation).rejects.toMatchObject({ code: 'stale' });
  await act(async () => { rendered!.unmount(); rendered = undefined; reply.resolve(); });
  await rejected;
});

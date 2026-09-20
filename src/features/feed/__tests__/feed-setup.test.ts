import React from 'react';
import { AppState } from 'react-native';
import type { NetworkState } from 'expo-network';
import { Button, Input, LinkButton } from '@/components/ui';
import { FriendsProvider } from '@/features/friends/friends-provider';
import FriendsScreen from '@/features/friends/friends-screen';
import type { AuthSnapshot } from '@/cloud/types';
import type { SocialState } from '@/social/types';
import FeedScreen from '../feed-screen';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext } from './fixtures';

const OWNER = '11111111-1111-4111-8111-111111111111';
const mockAuth: AuthSnapshot = { status: 'signed_in', userId: OWNER, email: null, lastError: null };
let mockFeed = feedContext({ identityKey: OWNER });
const mockNetworkListeners = new Set<(state: NetworkState) => void>();
const mockGetState = jest.fn();
const mockSaveProfile = jest.fn();
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('@/cloud/auth-service', () => ({ cloudAuthService: {
  getSnapshot: () => mockAuth, subscribe: () => () => undefined,
} }));
jest.mock('@/social/api', () => ({ socialService: {
  getState: (...args: unknown[]) => mockGetState(...args), saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
} }));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: (listener: (state: NetworkState) => void) => {
    mockNetworkListeners.add(listener); return { remove: () => { mockNetworkListeners.delete(listener); } };
  },
}));
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('../automatic-sharing-card', () => ({ AutomaticSharingCard: () => null }));
jest.mock('../shared-flight-card', () => ({ SharedFlightCard: () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Avatar', 'BusyRow', 'Button', 'Card', 'Input', 'LinkButton', 'Notice', 'Screen', 'SectionLabel', 'TopBar',
].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type Request = { resolve(value: SocialState): void; reject(error: Error): void };
let requests: Request[];
let rendered: ReturnType<typeof create> | undefined;
type Node = { props: Record<string, any> };
const empty: SocialState = { profile: null, inviteCode: null, relationships: [] };
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
const input = () => (rendered!.root.findAllByType(Input) as Node[]).find(node => node.props.label === 'Display name');
const control = (label: string) => [...rendered!.root.findAllByType(Button), ...rendered!.root.findAllByType(LinkButton)]
  .find((node: Node) => node.props.label === label) as Node | undefined;
const finishReads = async (value = empty) => {
  const current = requests.splice(0);
  await run(() => { for (const request of current) request.resolve(value); });
};
async function mount() {
  await run(() => { rendered = create(React.createElement(FriendsProvider, null, React.createElement(FeedScreen))); });
}
beforeEach(() => {
  jest.clearAllMocks(); requests = []; mockNetworkListeners.clear();
  mockFeed = feedContext({ identityKey: OWNER, items: [] });
  mockGetState.mockReset().mockImplementation(() => new Promise<SocialState>((resolve, reject) => { requests.push({ resolve, reject }); }));
  mockSaveProfile.mockReset().mockResolvedValue(undefined);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(async () => { if (rendered) await run(() => rendered!.unmount()); rendered = undefined; jest.restoreAllMocks(); });

it('keeps the real setup mounted while its focus refresh loads and settles with no profile', async () => {
  await mount();
  const initialReads = mockGetState.mock.calls.length;
  expect(initialReads).toBeGreaterThan(0);
  expect(rendered!.root.findAllByType(FriendsScreen)).toHaveLength(1);
  await finishReads();
  expect(input()).toBeDefined();
  expect(mockGetState).toHaveBeenCalledTimes(initialReads);
  await run(() => Promise.resolve());
  expect(requests).toHaveLength(0);
  expect(mockFeed.refresh).not.toHaveBeenCalled();
  expect(mockSaveProfile).not.toHaveBeenCalled();
});

it('preserves the setup draft through refresh failure, offline and reconnect without remount-driven reads', async () => {
  await mount(); await finishReads();
  await run(() => input()!.props.onChangeText('Unpublished pilot'));
  await run(() => control('Refresh friends')!.props.onPress());
  expect(input()!.props.value).toBe('Unpublished pilot');
  await run(() => requests.splice(0).forEach(request => request.reject(new Error('Temporary failure'))));
  expect(input()!.props.value).toBe('Unpublished pilot');
  expect(control('Retry loading Friends')).toBeDefined();
  await run(() => { for (const listener of mockNetworkListeners) listener({ isConnected: false } as NetworkState); });
  expect(input()!.props.value).toBe('Unpublished pilot');
  expect(input()!.props.editable).toBe(false);
  await run(() => { for (const listener of mockNetworkListeners) listener({ isConnected: true, isInternetReachable: true } as NetworkState); });
  const reconnectReads = mockGetState.mock.calls.length;
  await finishReads();
  expect(input()!.props.value).toBe('Unpublished pilot');
  expect(input()!.props.editable).toBe(true);
  expect(mockGetState).toHaveBeenCalledTimes(reconnectReads);
  expect(mockSaveProfile).not.toHaveBeenCalled();
});

it('switches to the feed only after an explicitly created profile is confirmed', async () => {
  await mount(); await finishReads();
  await run(() => input()!.props.onChangeText('Consenting pilot'));
  await run(() => control('Create my Friends profile')!.props.onPress());
  expect(mockSaveProfile).toHaveBeenCalledWith('Consenting pilot', expect.any(AbortSignal));
  expect(rendered!.root.findAllByType(FriendsScreen)).toHaveLength(1);
  await finishReads({ ...empty, profile: { userId: OWNER, displayName: 'Consenting pilot', backedUpFlightCount: 0 } });
  expect(rendered!.root.findAllByType(FriendsScreen)).toHaveLength(0);
  expect(control('Manage friends')).toBeDefined();
  expect(mockFeed.refresh).toHaveBeenCalledTimes(1);
});

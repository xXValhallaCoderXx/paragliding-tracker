import React from 'react';
import { Text } from 'react-native';
import { Avatar, BusyRow, Button, Notice } from '@/components/ui';
import type { FriendsContextValue, SocialProfile } from '@/social/types';
import FriendProfileScreen from '../friend-profile-screen';
import { create, act } from '../../../../tests/support/renderer';

let mockFriends: FriendsContextValue;
jest.mock('../friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'friend-a' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Avatar', 'BusyRow', 'Button', 'Card', 'Notice', 'Screen', 'TopBar',
].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type Node = { props: Record<string, any> };
let rendered: { root: { findAllByType(type: unknown): Node[] }; update(element: React.ReactElement): void; unmount(): void };
const text = () => rendered.root.findAllByType(Text).map(node => node.props.children);
const button = (label: string) => rendered.root.findAllByType(Button).find(node => node.props.label === label)!;
async function mount() { await act(async () => { rendered = create(React.createElement(FriendProfileScreen)); }); }
async function run(operation: () => unknown) { await act(async () => { await operation(); }); }
async function update(patch: Partial<FriendsContextValue>) {
  mockFriends = { ...mockFriends, ...patch };
  await run(() => rendered.update(React.createElement(FriendProfileScreen)));
}
const profile: SocialProfile = { userId: 'friend-a', displayName: 'Amélie Wong', backedUpFlightCount: 17 };

beforeEach(() => {
  mockFriends = { status: 'ready', identityKey: 'owner-a', available: true, revision: 0, loading: false, busy: false, error: null,
    profile: null, inviteCode: null, relationships: [], refresh: jest.fn(), saveProfile: jest.fn(), rotateInviteCode: jest.fn(),
    requestFriend: jest.fn(), changeRelationship: jest.fn(), getFriendProfile: jest.fn().mockResolvedValue(profile),
  };
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); });

it('shows loading without a fabricated count and only renders server-provided profile facts', async () => {
  let resolve!: (value: SocialProfile) => void;
  jest.mocked(mockFriends.getFriendProfile).mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount();
  expect(rendered.root.findAllByType(BusyRow)[0].props.label).toBe('Loading friend profile…');
  expect(text()).not.toContain('0');
  await run(() => resolve(profile));
  expect(text()).toContain('17');
  expect(text()).toContain('Backed-up flights');
  expect(rendered.root.findAllByType(Avatar)[0].props.initials).toBe('AW');
  expect(mockFriends.getFriendProfile).toHaveBeenCalledWith('friend-a');
});

it('clears a previously loaded count during refresh and keeps it absent after access is revoked', async () => {
  await mount();
  expect(text()).toContain('17');
  let reject!: (reason: Error) => void;
  jest.mocked(mockFriends.getFriendProfile).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await run(() => button('Refresh profile').props.onPress());
  expect(text()).not.toContain('17');
  await run(() => reject(new Error('This profile is no longer available. Refresh Friends.')));
  expect(text()).not.toContain('17');
  expect(rendered.root.findAllByType(Notice)[0].props.children).toContain('no longer available');
  jest.mocked(mockFriends.getFriendProfile).mockResolvedValue({ ...profile, backedUpFlightCount: 0 });
  await run(() => button('Retry profile').props.onPress());
  expect(text()).toContain('0');
});

it('clears profiles while offline or backgrounded and re-reads on returning', async () => {
  await mount();
  expect(text()).toContain('17');
  await update({ available: false, revision: 1 });
  expect(text()).not.toContain('17');
  expect(rendered.root.findAllByType(Avatar)).toHaveLength(0);
  jest.mocked(mockFriends.getFriendProfile).mockResolvedValue({ ...profile, backedUpFlightCount: 18 });
  await update({ available: true, revision: 2 });
  expect(text()).toContain('18');
  expect(mockFriends.getFriendProfile).toHaveBeenCalledTimes(2);
});

it('ignores an old account response and clears profiles immediately on sign-out', async () => {
  let oldResolve!: (value: SocialProfile) => void;
  jest.mocked(mockFriends.getFriendProfile).mockImplementationOnce(() => new Promise(done => { oldResolve = done; }));
  await mount();
  jest.mocked(mockFriends.getFriendProfile).mockRejectedValue(new Error('This profile is no longer available.'));
  await update({ identityKey: 'owner-b', revision: 1 });
  await run(() => oldResolve(profile));
  expect(text()).not.toContain('17');
  expect(rendered.root.findAllByType(Avatar)).toHaveLength(0);
  await update({ status: 'signed_out', identityKey: null });
  expect(button('Open Account')).toBeDefined();
  expect(text()).not.toContain('Amélie Wong');
});

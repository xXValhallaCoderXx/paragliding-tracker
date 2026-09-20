import React from 'react';
import { Alert, Share, Text } from 'react-native';
import { Avatar, Button, Input, LinkButton, Notice } from '@/components/ui';
import type { FriendsContextValue, FriendshipSummary } from '@/social/types';
import FriendsScreen from '../friends-screen';
import { create, act } from '../../../../tests/support/renderer';

let mockFriends: FriendsContextValue;
const mockPush = jest.fn();
jest.mock('../friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Avatar', 'BusyRow', 'Button', 'Card', 'Input', 'LinkButton', 'Notice', 'Screen', 'SectionLabel',
].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type Node = { props: Record<string, any> };
let rendered: { root: { findAllByType(type: unknown): Node[]; findAll(predicate: (node: Node) => boolean): Node[] }; update(element: React.ReactElement): void; unmount(): void };
const control = (label: string) => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)]
  .find(node => node.props.label === label)!;
const input = (label: string) => rendered.root.findAllByType(Input).find(node => node.props.label === label)!;
const notices = () => rendered.root.findAllByType(Notice).map(node => node.props.children);
async function mount() { await act(async () => { rendered = create(React.createElement(FriendsScreen)); }); }
async function run(operation: () => unknown) { await act(async () => { await operation(); }); }
const relation = (state: FriendshipSummary['state']): FriendshipSummary => ({ id: `relation-${state}`, userId: `pilot-${state}`, displayName: `Pilot ${state}`, state });

beforeEach(() => {
  jest.clearAllMocks();
  mockFriends = { status: 'ready', identityKey: 'owner-a', available: true, revision: 0, loading: false, busy: false, error: null,
    profile: { userId: 'owner-a', displayName: 'My Name', backedUpFlightCount: 3 }, inviteCode: 'ABCD1234WXYZ', relationships: [],
    refresh: jest.fn().mockResolvedValue(undefined), saveProfile: jest.fn().mockResolvedValue(undefined),
    rotateInviteCode: jest.fn().mockResolvedValue('REPLACED1234'), requestFriend: jest.fn().mockResolvedValue('sent'),
    changeRelationship: jest.fn().mockResolvedValue(undefined), getFriendProfile: jest.fn(),
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); jest.restoreAllMocks(); });

it('directs signed-out pilots to Account and never exposes an old profile or invite code', async () => {
  mockFriends.status = 'signed_out';
  await mount();
  expect(rendered.root.findAllByType(Input)).toHaveLength(0);
  expect(control('Share friend code')).toBeUndefined();
  await run(() => control('Open Account').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/account');
});

it('preserves a chosen name and initials preview after profile creation fails', async () => {
  mockFriends.profile = null;
  jest.mocked(mockFriends.saveProfile).mockRejectedValue(new Error('No connection. Try again.'));
  await mount();
  await run(() => input('Display name').props.onChangeText('Ada Wong'));
  expect(rendered.root.findAllByType(Avatar)[0].props.initials).toBe('AW');
  await run(() => control('Create my Friends profile').props.onPress());
  mockFriends.error = 'No connection. Try again.';
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(input('Display name').props.value).toBe('Ada Wong');
  expect(notices()).toContain('No connection. Try again.');
  expect(rendered.root.findAllByType(Text).some(node => String(node.props.children).includes('Accepted friends can see'))).toBe(true);
  expect(rendered.root.findAllByType(Text).some(node => String(node.props.children).includes('including people outside your friends'))).toBe(true);
});

it('retains an unsuccessful invite code and clears it only after a successful request', async () => {
  jest.mocked(mockFriends.requestFriend).mockResolvedValueOnce('unavailable').mockResolvedValueOnce('sent');
  await mount();
  await run(() => input('Their friend code').props.onChangeText('ABCD 1234 WXYZ'));
  await run(() => control('Send friend request').props.onPress());
  expect(input('Their friend code').props.value).toBe('ABCD 1234 WXYZ');
  expect(notices()).toContain('Check the code with your friend and try again.');
  await run(() => control('Send friend request').props.onPress());
  expect(input('Their friend code').props.value).toBe('');
  expect(notices()).toContain('They can accept your request in Friends.');
});

it('shares the private code through the system sheet and confirms code replacement', async () => {
  await mount();
  await run(() => control('Share friend code').props.onPress());
  expect(Share.share).toHaveBeenCalledWith({ message: expect.stringContaining('ABCD1234WXYZ') });
  await run(() => control('Replace friend code').props.onPress());
  expect(mockFriends.rotateInviteCode).not.toHaveBeenCalled();
  const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe('Replace your friend code?');
  expect(message).toContain('old code will stop working');
  await run(() => buttons?.find(button => button.text === 'Replace code')?.onPress?.());
  expect(mockFriends.rotateInviteCode).toHaveBeenCalledTimes(1);
});

it('refreshes on demand and limits profile links to accepted friends', async () => {
  mockFriends.relationships = ['incoming', 'outgoing', 'accepted', 'blocked'].map(state => relation(state as FriendshipSummary['state']));
  await mount();
  const profileLinks = rendered.root.findAllByType(LinkButton).filter(node => String(node.props.label).startsWith('View '));
  expect(profileLinks).toHaveLength(1);
  await run(() => profileLinks[0].props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/friends/[id]', params: { id: 'pilot-accepted' } });
  await run(() => control('Refresh friends').props.onPress());
  expect(mockFriends.refresh).toHaveBeenCalledTimes(2);
  const accept = rendered.root.findAll(node => node.props.accessibilityLabel === 'Accept: Pilot incoming')[0];
  await run(() => accept.props.onPress());
  expect(mockFriends.changeRelationship).toHaveBeenCalledWith(relation('incoming'), 'accept');
});

it('confirms removal and preserves drafts across connection loss but clears them on account change', async () => {
  mockFriends.relationships = [relation('accepted')];
  await mount();
  await run(() => input('Their friend code').props.onChangeText('ABCD1234WXYZ'));
  const remove = rendered.root.findAll(node => node.props.accessibilityLabel === 'Remove friend: Pilot accepted')[0];
  await run(() => remove.props.onPress());
  expect(mockFriends.changeRelationship).not.toHaveBeenCalled();
  await run(() => jest.mocked(Alert.alert).mock.calls[0][2]?.find(button => button.text === 'Remove friend')?.onPress?.());
  expect(mockFriends.changeRelationship).toHaveBeenCalledWith(relation('accepted'), 'remove');
  const previousProfile = mockFriends.profile;
  mockFriends.available = false; mockFriends.profile = null; mockFriends.inviteCode = null; mockFriends.relationships = [];
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(input('Their friend code').props.value).toBe('ABCD1234WXYZ');
  expect(control('Send friend request').props.disabled).toBe(true);
  mockFriends.available = true; mockFriends.identityKey = 'owner-b'; mockFriends.profile = previousProfile;
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(input('Their friend code').props.value).toBe('');
});

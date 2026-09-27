import React from 'react';
import { Alert, Switch, Text } from 'react-native';
import { Avatar, Button, Input, LinkButton, Notice } from '@/components/ui';
import type { FriendsContextValue, FriendshipSummary } from '@/social/types';
import { friendsContext } from '@/features/feed/__tests__/fixtures';
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
const relation = (state: FriendshipSummary['state']): FriendshipSummary => ({ id: `relation-${state}`, userId: `pilot-${state}`, displayName: `Pilot ${state}`, username: `pilot_${state}`, state });

beforeEach(() => {
  jest.clearAllMocks();
  mockFriends = friendsContext();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); jest.restoreAllMocks(); });

it('directs signed-out pilots to Account and never exposes an old profile or profile fields', async () => {
  mockFriends.status = 'signed_out';
  await mount();
  expect(rendered.root.findAllByType(Input)).toHaveLength(0);
  expect(control('Share friend code')).toBeUndefined();
  await run(() => control('Open Pilot').props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/account');
});

it('preserves a chosen name and initials preview after profile creation fails', async () => {
  mockFriends.profile = null;
  jest.mocked(mockFriends.saveProfile).mockRejectedValue(new Error('No connection. Try again.'));
  await mount();
  await run(() => input('Display name').props.onChangeText('Ada Wong'));
  expect(rendered.root.findAllByType(Avatar)[0].props.initials).toBe('AW');
  await run(() => input('Username').props.onChangeText('ada_wong'));
  await run(() => control('Create my Friends profile').props.onPress());
  mockFriends.error = 'No connection. Try again.';
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(input('Display name').props.value).toBe('Ada Wong');
  expect(input('Username').props.value).toBe('ada_wong');
  expect(notices()).toContain('No connection. Try again.');
  expect(rendered.root.findAllByType(Text).some(node => String(node.props.children).includes('Accepted friends can see'))).toBe(true);
  expect(rendered.root.findAllByType(Text).some(node => String(node.props.children).includes('including people outside your friends'))).toBe(true);
});

it('discloses default visibility for new profiles and saves the explicitly chosen setting', async () => {
  mockFriends.profile = null;
  await mount();
  const visibility = () => rendered.root.findAllByType(Switch)[0];
  expect(visibility().props.value).toBe(true);
  expect(control('Create my Friends profile').props.disabled).toBe(true);
  await run(() => input('Display name').props.onChangeText('Ada Wong'));
  await run(() => input('Username').props.onChangeText('ADA_WONG'));
  await run(() => visibility().props.onValueChange(false));
  await run(() => control('Create my Friends profile').props.onPress());
  expect(mockFriends.saveProfile).toHaveBeenCalledWith({ displayName: 'Ada Wong', username: 'ada_wong', discoverable: false });
  expect(control('Share friend code')).toBeUndefined();
  expect(control('Replace friend code')).toBeUndefined();
});

it('opens completion for legacy profiles while preserving existing accepted relationships', async () => {
  mockFriends.profile = { ...mockFriends.profile!, username: null, discoverable: false };
  mockFriends.relationships = [relation('accepted')];
  await mount();
  expect(control('Find pilots').props.disabled).toBe(true);
  expect(control('View Pilot accepted’s profile')).toBeDefined();
  await run(() => control('Complete profile').props.onPress());
  expect(input('Display name').props.value).toBe('My Name');
  expect(input('Username').props.value).toBe('');
  expect(rendered.root.findAllByType(Switch)[0].props.value).toBe(false);
});

it('retains edited profile fields and visibility after a username conflict', async () => {
  jest.mocked(mockFriends.saveProfile).mockRejectedValue(new Error('That username is already taken.'));
  await mount();
  await run(() => control('Edit profile').props.onPress());
  await run(() => input('Username').props.onChangeText('taken_name'));
  await run(() => rendered.root.findAllByType(Switch)[0].props.onValueChange(false));
  await run(() => control('Save profile').props.onPress());
  expect(input('Username').props.value).toBe('taken_name');
  expect(rendered.root.findAllByType(Switch)[0].props.value).toBe(false);
  expect(notices()).toContain('That username is already taken.');
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
  await run(() => control('Edit profile').props.onPress());
  await run(() => input('Username').props.onChangeText('draft_name'));
  const remove = rendered.root.findAll(node => node.props.accessibilityLabel === 'Remove friend: Pilot accepted')[0];
  await run(() => remove.props.onPress());
  expect(mockFriends.changeRelationship).not.toHaveBeenCalled();
  await run(() => jest.mocked(Alert.alert).mock.calls[0][2]?.find(button => button.text === 'Remove friend')?.onPress?.());
  expect(mockFriends.changeRelationship).toHaveBeenCalledWith(relation('accepted'), 'remove');
  const previousProfile = mockFriends.profile;
  mockFriends.available = false; mockFriends.profile = null; mockFriends.relationships = [];
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(input('Username').props.value).toBe('draft_name');
  expect(control('Save profile').props.disabled).toBe(true);
  mockFriends.available = true; mockFriends.identityKey = 'owner-b'; mockFriends.profile = previousProfile;
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(input('Username')).toBeUndefined();
});

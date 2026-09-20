import React from 'react';
import { Alert, Text } from 'react-native';
import { Avatar, Button, Input, LinkButton, Notice } from '@/components/ui';
import { friendsContext } from '@/features/feed/__tests__/fixtures';
import type { FriendsContextValue, PilotSearchPage, PilotSearchResult } from '@/social/types';
import PilotSearchScreen from '../pilot-search-screen';
import { act, create } from '../../../../tests/support/renderer';

let mockFriends: FriendsContextValue;
let mockFocused = true;
const mockPush = jest.fn();
jest.mock('../friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Avatar', 'BusyRow', 'Button', 'Card', 'Input', 'LinkButton', 'Notice', 'Screen', 'TopBar',
].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
type Node = { props: Record<string, any> };
let rendered: ReturnType<typeof create> | undefined;
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
const input = () => (rendered!.root.findAllByType(Input) as Node[])[0];
const control = (label: string) => [...rendered!.root.findAllByType(Button), ...rendered!.root.findAllByType(LinkButton)]
  .find((node: Node) => node.props.label === label) as Node | undefined;
const texts = () => (rendered!.root.findAllByType(Text) as Node[]).map(node => node.props.children);
const notice = (title: string) => (rendered!.root.findAllByType(Notice) as Node[]).find(node => node.props.title === title);
const pilot = (patch: Partial<PilotSearchResult> = {}): PilotSearchResult => ({ userId: 'pilot-a', displayName: 'Ada Pilot', username: 'ada',
  relationshipId: null, relationshipState: 'none', ...patch });
const page = (items = [pilot()]): PilotSearchPage => ({ status: 'ok', items, nextCursor: null });
const tick = async (ms = 350) => run(() => jest.advanceTimersByTime(ms));
const mount = async () => run(() => { rendered = create(React.createElement(PilotSearchScreen)); });
const update = async (patch: Partial<FriendsContextValue> = {}) => {
  mockFriends = { ...mockFriends, ...patch };
  await run(() => rendered!.update(React.createElement(PilotSearchScreen)));
};
const search = async (query = 'ad') => { await run(() => input().props.onChangeText(query)); await tick(); };
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockFocused = true;
  mockFriends = friendsContext({ searchPilots: jest.fn().mockResolvedValue(page()) });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => { if (rendered) await run(() => rendered!.unmount()); rendered = undefined; jest.restoreAllMocks(); jest.useRealTimers(); });

it('requires two characters after @ and debounces exact query text before reading safe search rows', async () => {
  await mount(); await search('@a');
  expect(mockFriends.searchPilots).not.toHaveBeenCalled();
  expect(notice('Who are you looking for?')).toBeDefined();
  await run(() => input().props.onChangeText('@ad')); await tick(349);
  expect(mockFriends.searchPilots).not.toHaveBeenCalled();
  await tick(1);
  expect(mockFriends.searchPilots).toHaveBeenCalledWith('@ad', null, expect.any(AbortSignal));
  expect(texts()).toContain('Ada Pilot');
  expect(texts()).toContainEqual(['@', 'ada']);
  expect(rendered!.root.findAllByType(Avatar)[0].props.initials).toBe('AP');
  expect(control('Add friend: Ada Pilot')).toBeDefined();
  expect(control('View Ada Pilot’s profile')).toBeUndefined();
  expect(texts()).not.toContain('Backed-up flights');
});

it('aborts and ignores late results after changing the query', async () => {
  let resolve!: (value: PilotSearchPage) => void;
  jest.mocked(mockFriends.searchPilots).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(); await search('ad');
  const signal = jest.mocked(mockFriends.searchPilots).mock.calls[0][2]!;
  await run(() => input().props.onChangeText('bea'));
  expect(signal.aborted).toBe(true);
  await run(() => resolve(page()));
  expect(texts()).not.toContain('Ada Pilot');
  jest.mocked(mockFriends.searchPilots).mockResolvedValue(page([pilot({ displayName: 'Bea Pilot', username: 'bea' })]));
  await tick();
  expect(texts()).toContain('Bea Pilot');
});

it('paginates with the returned cursor and deduplicates repeated pilots', async () => {
  const cursor = { query: 'ad', rank: 1 as const, username: 'ada', userId: 'pilot-a' };
  jest.mocked(mockFriends.searchPilots).mockResolvedValueOnce({ ...page(), nextCursor: cursor })
    .mockResolvedValueOnce(page([pilot(), pilot({ userId: 'pilot-b', displayName: 'Adam', username: 'adam' })]));
  await mount(); await search();
  await run(() => control('Load more pilots')!.props.onPress());
  expect(mockFriends.searchPilots).toHaveBeenLastCalledWith('ad', cursor, expect.any(AbortSignal));
  expect(texts().filter(value => value === 'Ada Pilot')).toHaveLength(1);
  expect(texts()).toContain('Adam');
  expect(control('Load more pilots')).toBeUndefined();
});

it('preserves the query for retry, rate limits and offline but clears results and resets for another owner', async () => {
  await mount(); await search();
  await update({ available: false, profile: null, revision: 1 });
  expect(texts()).not.toContain('Ada Pilot');
  expect(input().props.value).toBe('ad');
  jest.mocked(mockFriends.searchPilots).mockRejectedValueOnce(new Error('Temporary connection failure'));
  await update({ available: true, profile: friendsContext().profile, revision: 2 }); await tick();
  expect(notice('Could not search pilots')).toBeDefined();
  jest.mocked(mockFriends.searchPilots).mockResolvedValueOnce({ status: 'rate_limited', items: [], nextCursor: null });
  await run(() => control('Retry search')!.props.onPress()); await tick();
  expect(notice('Please wait before searching again')).toBeDefined();
  expect(input().props.value).toBe('ad');
  await update({ identityKey: 'owner-b' });
  expect(input().props.value).toBe('');
  expect(texts()).not.toContain('Ada Pilot');
});

it('invalidates displayed rows on relationship revision and ignores a blurred read', async () => {
  await mount(); await search();
  let resolve!: (value: PilotSearchPage) => void;
  jest.mocked(mockFriends.searchPilots).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await update({ revision: 1 });
  expect(texts()).not.toContain('Ada Pilot');
  await tick();
  mockFocused = false; await update();
  await run(() => resolve(page()));
  expect(texts()).not.toContain('Ada Pilot');
  expect(input().props.value).toBe('ad');
});

it('requires mutual acceptance and restricts profile links to accepted results', async () => {
  jest.mocked(mockFriends.searchPilots).mockResolvedValue(page([
    pilot(), pilot({ userId: 'outgoing', displayName: 'Out Pilot', relationshipId: 'r-out', relationshipState: 'outgoing' }),
    pilot({ userId: 'incoming', displayName: 'In Pilot', relationshipId: 'r-in', relationshipState: 'incoming' }),
    pilot({ userId: 'accepted', displayName: 'Friend Pilot', relationshipId: 'r-friend', relationshipState: 'accepted' }),
  ]));
  await mount(); await search();
  expect(control('View Ada Pilot’s profile')).toBeUndefined();
  expect(control('View In Pilot’s profile')).toBeUndefined();
  await run(() => control('View Friend Pilot’s profile')!.props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/friends/[id]', params: { id: 'accepted' } });
  await run(() => control('Accept: In Pilot')!.props.onPress());
  expect(mockFriends.changeRelationship).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-in', userId: 'incoming' }), 'accept');
  await tick();
  await run(() => control('Cancel request: Out Pilot')!.props.onPress());
  expect(mockFriends.changeRelationship).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-out' }), 'cancel');
  await tick();
  await run(() => control('Add friend: Ada Pilot')!.props.onPress());
  expect(mockFriends.requestPilot).toHaveBeenCalledWith('pilot-a');
  expect(notice('Request sent')).toBeDefined();
});

it('confirms stranger blocking without placing their name in a native dialog and ignores it after blur', async () => {
  await mount(); await search();
  await run(() => control('Block: Ada Pilot')!.props.onPress());
  expect(mockFriends.blockPilot).not.toHaveBeenCalled();
  const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls[0];
  expect(`${title} ${message}`).not.toContain('Ada Pilot');
  mockFocused = false; await update();
  await run(() => buttons?.find(button => button.text === 'Block')?.onPress?.());
  expect(mockFriends.blockPilot).not.toHaveBeenCalled();
  mockFocused = true; await update(); await tick();
  await run(() => control('Block: Ada Pilot')!.props.onPress());
  await run(() => jest.mocked(Alert.alert).mock.calls[1][2]?.find(button => button.text === 'Block')?.onPress?.());
  expect(mockFriends.blockPilot).toHaveBeenCalledWith('pilot-a');
});

it('gates legacy profiles before search while offering profile completion', async () => {
  mockFriends.profile = { ...mockFriends.profile!, username: null };
  await mount();
  expect(input().props.editable).toBe(false);
  await tick();
  expect(mockFriends.searchPilots).not.toHaveBeenCalled();
  await run(() => control('Complete profile')!.props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/friends/manage');
});

it('waits for a pending connection mutation to finish before restarting search', async () => {
  await mount(); await search();
  expect(mockFriends.searchPilots).toHaveBeenCalledTimes(1);
  await update({ busy: true, revision: 1 });
  await tick(1000);
  expect(mockFriends.searchPilots).toHaveBeenCalledTimes(1);
  expect(texts()).not.toContain('Ada Pilot');
  expect(notice('Could not search pilots')).toBeUndefined();
  await update({ busy: false, revision: 2 }); await tick();
  expect(mockFriends.searchPilots).toHaveBeenCalledTimes(2);
  expect(texts()).toContain('Ada Pilot');
});

it('rejects an overlong query locally with guidance while retaining the text for editing', async () => {
  await mount(); await search('@' + 'a'.repeat(61));
  expect(mockFriends.searchPilots).not.toHaveBeenCalled();
  expect(notice('Search text is too long')).toBeDefined();
  expect(input().props.value).toHaveLength(62);
  await search('@' + 'a'.repeat(60));
  expect(mockFriends.searchPilots).toHaveBeenCalledTimes(1);
});

it('does not restart reads or publish request status after a mutation resolves on a blurred screen', async () => {
  let resolve!: (value: 'sent') => void;
  jest.mocked(mockFriends.requestPilot).mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await search();
  await run(() => control('Add friend: Ada Pilot')!.props.onPress());
  mockFocused = false; await update();
  await run(() => resolve('sent')); await tick(1000);
  expect(mockFriends.searchPilots).toHaveBeenCalledTimes(1);
  expect(texts()).not.toContain('Ada Pilot');
  expect(notice('Request sent')).toBeUndefined();
});

it('clears late paginated rows if a relationship mutation invalidates the result scope', async () => {
  const cursor = { query: 'ad', rank: 1 as const, username: 'ada', userId: 'pilot-a' };
  let resolve!: (value: PilotSearchPage) => void;
  jest.mocked(mockFriends.searchPilots).mockResolvedValueOnce({ ...page(), nextCursor: cursor })
    .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(); await search();
  await run(() => control('Load more pilots')!.props.onPress());
  await update({ busy: true, revision: 1 });
  await run(() => resolve(page([pilot({ userId: 'late', displayName: 'Late Pilot' })])));
  expect(texts()).not.toContain('Late Pilot');
  expect(texts()).not.toContain('Ada Pilot');
});

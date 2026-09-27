import React from 'react';
import { FlatList, Text } from 'react-native';
import { Avatar, Button, Notice } from '@/components/ui';
import type { KudosPage } from '@/social/feed-types';
import KudosScreen from '../kudos-screen';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext, friendsContext, sharedFlight } from './fixtures';

let mockFeed = feedContext();
let mockFriends = friendsContext();
let mockFocused = true;
let mockId: string | undefined = 'activity-1';
const mockPush = jest.fn();
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockId }), useIsFocused: () => mockFocused,
  useRouter: () => ({ push: mockPush, canGoBack: () => true, back: jest.fn() }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries(['Avatar', 'BusyRow', 'Button', 'Notice', 'Screen', 'TopBar']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type Node = { props: Record<string, any> };
let rendered: ReturnType<typeof create> | undefined;
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
async function render() { await run(() => { if (rendered) rendered.update(React.createElement(KudosScreen)); else rendered = create(React.createElement(KudosScreen)); }); }
const control = (label: string) => (rendered!.root.findAllByType(Button) as Node[]).find(node => node.props.label === label);
const names = () => (rendered!.root.findAllByType(Text) as Node[]).map(node => node.props.children).filter(value => typeof value === 'string' && value.startsWith('Supporter '));
const page = (patch: Partial<KudosPage> = {}): KudosPage => ({
  activityId: 'activity-1', count: 26, givenByMe: false,
  items: Array.from({ length: 25 }, (_, i) => ({ id: `supporter-${i}`, displayName: `Supporter ${i}` })),
  nextCursor: { createdAt: '2026-09-21T09:00:00Z', id: 'supporter-24' }, ...patch,
});
const seed = (value: KudosPage) => {
  mockFeed.kudosByActivity[value.activityId] = { summary: { count: value.count, givenByMe: value.givenByMe }, pending: false, error: null };
  return value;
};
beforeEach(() => {
  jest.clearAllMocks(); mockFeed = feedContext(); mockFriends = friendsContext(); mockFocused = true; mockId = 'activity-1';
  jest.mocked(mockFeed.getKudos).mockImplementation(async () => seed(page()));
});
afterEach(async () => { if (rendered) await run(() => rendered!.unmount()); rendered = undefined; });

it('loads 25 safe names and initials, then appends one page without duplicate people or profile links', async () => {
  await render();
  expect(mockFeed.getDetail).toHaveBeenCalledWith('activity-1');
  expect(rendered!.root.findAllByType(Text).map((node: Node) => node.props.children)).toContain('Evening ridge');
  expect(mockFeed.getKudos).toHaveBeenCalledWith('activity-1', null);
  expect(names()).toHaveLength(25);
  expect(rendered!.root.findAllByType(Avatar)).toHaveLength(25);
  expect((rendered!.root.findAllByType(Button) as Node[]).map(node => node.props.label)).toEqual(['Refresh kudos', 'Load more kudos']);
  jest.mocked(mockFeed.getKudos).mockImplementationOnce(async () => seed(page({ items: [page().items[24], { id: 'supporter-25', displayName: 'Supporter 25' }], nextCursor: null })));
  await run(() => control('Load more kudos')!.props.onPress());
  expect(mockFeed.getKudos).toHaveBeenLastCalledWith('activity-1', page().nextCursor);
  // FlatList keeps the next page outside its initial render window until scroll.
  expect(rendered!.root.findByType(FlatList).props.data).toHaveLength(26);
  expect(rendered!.root.findByType(FlatList).props.data.at(-1)).toEqual({ id: 'supporter-25', displayName: 'Supporter 25' });
  expect(control('Load more kudos')).toBeUndefined();
  expect(mockPush).not.toHaveBeenCalled();
});

it('does not reveal a title or request supporters after its initial detail loses access', async () => {
  jest.mocked(mockFeed.getDetail).mockRejectedValueOnce(new Error('Access removed.'));
  await render();
  expect(mockFeed.getKudos).not.toHaveBeenCalled();
  expect(names()).toEqual([]);
  expect(rendered!.root.findAllByType(Text).map((node: Node) => node.props.children)).not.toContain('Evening ridge');
});

it('ignores late flight context after leaving the screen and does not start a roster request', async () => {
  let complete!: (value: ReturnType<typeof sharedFlight>) => void;
  jest.mocked(mockFeed.getDetail).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await render();
  mockFocused = false; await render();
  await run(() => complete(sharedFlight()));
  expect(mockFeed.getKudos).not.toHaveBeenCalled();
  expect(names()).toEqual([]);
});

it('keeps unsupported kudos unavailable rather than presenting a zero count or roster', async () => {
  jest.mocked(mockFeed.getDetail).mockResolvedValueOnce(sharedFlight({ kudos: null }));
  await render();
  expect(mockFeed.getKudos).not.toHaveBeenCalled();
  expect(rendered!.root.findByType(Notice).props.children).toBe('Kudos are unavailable for this flight.');
});

it('does not issue duplicate pagination requests before the pending render commits', async () => {
  await render();
  let complete!: (value: KudosPage) => void;
  jest.mocked(mockFeed.getKudos).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const next = control('Load more kudos')!;
  await run(() => { next.props.onPress(); next.props.onPress(); });
  expect(mockFeed.getKudos).toHaveBeenCalledTimes(2);
  expect(control('Loading more kudos…')!.props.busy).toBe(true);
  await run(() => complete(seed(page({ items: [], nextCursor: null }))));
});

it('clears loaded names after a later page fails and retries from the first page', async () => {
  await render();
  jest.mocked(mockFeed.getKudos).mockRejectedValueOnce(new Error('This shared flight is no longer available.'));
  await run(() => control('Load more kudos')!.props.onPress());
  expect(names()).toEqual([]);
  expect(rendered!.root.findByType(Notice).props.children).toBe('This shared flight is no longer available.');
  await run(() => control('Retry kudos')!.props.onPress());
  expect(mockFeed.getKudos).toHaveBeenLastCalledWith('activity-1', null);
  expect(names()).toHaveLength(25);
});

it.each(['offline', 'blur', 'signout', 'account_switch'] as const)('releases supporter names and ignores a late page on %s', async reason => {
  await render();
  let complete!: (value: KudosPage) => void;
  jest.mocked(mockFeed.getKudos).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await run(() => control('Load more kudos')!.props.onPress());
  if (reason === 'offline') mockFeed.available = false;
  if (reason === 'blur') mockFocused = false;
  if (reason === 'signout') mockFriends.status = 'signed_out';
  if (reason === 'account_switch') mockFriends.identityKey = 'owner-b';
  await render();
  expect(names()).toEqual([]);
  await run(() => complete(page({ items: [{ id: 'late', displayName: 'Supporter late' }], nextCursor: null })));
  expect(names()).toEqual([]);
});

it('clears names when another authorized read discovers revocation without changing feed revision', async () => {
  await render();
  const revision = mockFeed.revision;
  mockFeed.kudosByActivity = {};
  await render();
  expect(mockFeed.revision).toBe(revision);
  expect(names()).toEqual([]);
  expect(control('Retry kudos')).toBeDefined();
});

it('rechecks after relationship revision changes and ignores an older first page', async () => {
  let complete!: (value: KudosPage) => void;
  jest.mocked(mockFeed.getKudos).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockRejectedValueOnce(new Error('Access removed.'));
  await render();
  mockFeed.revision += 1;
  await render();
  await run(() => complete(page()));
  expect(names()).toEqual([]);
  expect(rendered!.root.findByType(Notice).props.children).toBe('Access removed.');
});

it('shows a real empty result and rejects a missing route without a request', async () => {
  jest.mocked(mockFeed.getKudos).mockImplementationOnce(async () => seed(page({ count: 0, items: [], nextCursor: null })));
  await render();
  expect(rendered!.root.findByType(Notice).props.title).toBe('No kudos yet');
  expect(control('Load more kudos')).toBeUndefined();
  mockId = undefined;
  await render();
  expect(mockFeed.getKudos).toHaveBeenCalledTimes(1);
  expect(rendered!.root.findByType(Notice).props.title).toBe('Kudos unavailable');
});

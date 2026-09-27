import React from 'react';
import { FlatList, Text } from 'react-native';
import { JournalArt } from '@/components/ui/journal-art';
import FriendsScreen from '@/features/friends/friends-screen';
import FeedScreen from '../feed-screen';
import { SharedFlightCard } from '../shared-flight-card';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext, friendsContext, sharedFlight } from './fixtures';

let mockFeed = feedContext();
let mockFriends = friendsContext();
const mockPush = jest.fn();
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('@/features/friends/friends-screen', () => () => null);
jest.mock('../automatic-sharing-card', () => ({ AutomaticSharingCard: () => null }));
jest.mock('../shared-flight-card', () => ({ SharedFlightCard: () => null }));
jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries(['BusyRow', 'Button', 'Notice', 'Screen', 'TabGlyph']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
type Node = { props: Record<string, any> };
const control = (label: string) => (rendered.root.findAll((node: Node) => node.props.label === label, { deep: false }) as Node[])[0]
  ?? (rendered.root.findAll((node: Node) => node.props.accessibilityLabel === label, { deep: false }) as Node[])[0];
const text = () => (rendered.root.findAllByType(Text) as Node[]).map(node => node.props.children);
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
beforeEach(() => { jest.clearAllMocks(); mockFeed = feedContext(); mockFriends = friendsContext(); });
afterEach(async () => { if (rendered) await run(() => rendered.unmount()); });

it('preserves setup and signed-out entry through the existing Friends screen', async () => {
  mockFriends.profile = null;
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  expect(rendered.root.findAllByType(FriendsScreen)).toHaveLength(1);
  expect(rendered.root.findAllByType(SharedFlightCard)).toHaveLength(0);
  mockFriends.status = 'signed_out';
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(rendered.root.findAllByType(FriendsScreen)).toHaveLength(1);
});

it('includes own published flights, links authors correctly, and keeps management separate', async () => {
  mockFeed.items.push(sharedFlight({ activityId: 'own-post', author: { userId: 'owner-a', displayName: 'My Name' } }));
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  const cards = rendered.root.findAllByType(SharedFlightCard) as Node[];
  expect(cards).toHaveLength(2);
  expect(cards.map(node => node.props.own)).toEqual([false, true]);
  await run(() => cards[0].props.onOpen());
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/shared-flights/[id]', params: { id: 'activity-1' } });
  await run(() => cards[0].props.onAuthor());
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/friends/[id]', params: { id: 'friend-b' } });
  await run(() => cards[1].props.onAuthor());
  expect(mockPush).toHaveBeenLastCalledWith('/friends/manage');
  await run(() => control('Find pilots').props.onPress());
  expect(mockPush).toHaveBeenLastCalledWith('/friends/search');
  await run(() => control('Your circle').props.onPress());
  expect(mockPush).toHaveBeenLastCalledWith('/friends/manage');
});

it('offers pagination only while a server cursor exists and clears cards on connection/account changes', async () => {
  mockFeed.nextCursor = { publishedAt: '2026-09-21T09:00:00Z', activityId: 'older' };
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  await run(() => control('Load more flights').props.onPress());
  expect(mockFeed.loadMore).toHaveBeenCalledTimes(1);
  mockFeed.available = false;
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(rendered.root.findAllByType(SharedFlightCard)).toHaveLength(0);
  expect(control('Load more flights')).toBeUndefined();
  mockFeed.available = true; mockFriends.identityKey = 'owner-b';
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(rendered.root.findAllByType(SharedFlightCard)).toHaveLength(0);
});

it('keeps the existing feed available for a profile that still needs a username', async () => {
  mockFriends.profile = { ...mockFriends.profile!, username: null };
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  expect(rendered.root.findAllByType(FriendsScreen)).toHaveLength(0);
  expect(rendered.root.findAllByType(SharedFlightCard)).toHaveLength(1);
  expect(control('Your circle')).toBeDefined();
});

it('distinguishes an empty circle from friends who have not shared flights and opens the existing logbook', async () => {
  mockFeed.items = [];
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  expect(text()).toContain('Nobody here yet.');
  expect(rendered.root.findByType(JournalArt).props.scene).toBe('launch');
  expect(control('Find pilots').props.variant).toBe('primary');
  await run(() => control('Open logbook').props.onPress());
  expect(mockPush).toHaveBeenLastCalledWith('/(tabs)');
  mockFriends.relationships = [{ id: 'connection-1', userId: 'friend-b', displayName: 'Pilot B', username: 'pilot_b', state: 'accepted' }];
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(text()).toContain('No shared flights yet.');
  expect(text()).not.toContain('Nobody here yet.');
  expect(control('Open logbook').props.variant).toBe('primary');
  await run(() => control('Find pilots').props.onPress());
  expect(mockPush).toHaveBeenLastCalledWith('/friends/search');
});

it('keeps date headings merged when an older page extends the same publication day', async () => {
  mockFeed.items = [sharedFlight({ publishedAt: '2026-09-21T12:00:00Z' })];
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  mockFeed.items = [...mockFeed.items, sharedFlight({ activityId: 'page-two', publishedAt: '2026-09-21T11:00:00Z' })];
  await run(() => rendered.update(React.createElement(FeedScreen)));
  const rows = rendered.root.findByType(FlatList).props.data;
  expect(rows.map((row: { flight: { activityId: string } }) => row.flight.activityId)).toEqual(['activity-1', 'page-two']);
  expect(rows.filter((row: { heading: string | null }) => row.heading)).toHaveLength(1);
});

it('does not imply an empty circle before the friends snapshot is available', async () => {
  mockFeed.items = []; mockFriends.available = false;
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  expect(text()).not.toContain('Nobody here yet.');
  expect(text()).not.toContain('No shared flights yet.');
  expect(control('Checking your circle…')).toBeDefined();
  mockFriends.available = true;
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(text()).toContain('Nobody here yet.');
});

it('keeps explicit refresh and pull-to-refresh guarded during loading or unavailable state', async () => {
  await run(() => { rendered = create(React.createElement(FeedScreen)); });
  const refreshControls = () => rendered.root.findAll((node: Node) => node.props?.accessibilityLabel === 'Refresh shared flights', { deep: false });
  expect(refreshControls()).toHaveLength(1);
  jest.mocked(mockFeed.refresh).mockClear();
  await run(() => control('Refresh shared flights').props.onPress());
  await run(() => rendered.root.findByType(FlatList).props.onRefresh());
  expect(mockFeed.refresh).toHaveBeenCalledTimes(2);
  mockFeed.loading = true;
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(control('Refresh shared flights').props.accessibilityState).toEqual({ disabled: true, busy: true });
  await run(() => rendered.root.findByType(FlatList).props.onRefresh());
  expect(mockFeed.refresh).toHaveBeenCalledTimes(2);
  mockFeed.loading = false; mockFeed.available = false;
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(refreshControls()).toHaveLength(1);
  await run(() => control('Refresh shared flights').props.onPress());
  expect(mockFeed.refresh).toHaveBeenCalledTimes(2);
  expect(text()).not.toContain('Nobody here yet.');
  mockFeed.items = []; mockFeed.available = true;
  await run(() => rendered.update(React.createElement(FeedScreen)));
  expect(refreshControls()).toHaveLength(1);
  expect(control('Refresh shared flights').props.disabled).toBe(false);
});

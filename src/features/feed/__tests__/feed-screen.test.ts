import React from 'react';
import { Button } from '@/components/ui';
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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries(['BusyRow', 'Button', 'Notice', 'Screen']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
type Node = { props: Record<string, any> };
const control = (label: string) => (rendered.root.findAllByType(Button) as Node[]).find(node => node.props.label === label)!;
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
  await run(() => control('Manage friends').props.onPress());
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

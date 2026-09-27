import React from 'react';
import { AppState, Modal, Text, type AppStateStatus } from 'react-native';
import { Button, LinkButton, Notice } from '@/components/ui';
import { AutomaticSharingCard } from '../automatic-sharing-card';
import { FlightSharingSection, type ShareFlightPreview } from '../flight-sharing-section';
import { SharingConsent } from '../sharing-consent';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext, friendsContext, publicationView } from './fixtures';

let mockFeed = feedContext();
let mockFriends = friendsContext();
let mockPublication = publicationView();
let mockFocused = true;
const mockAppListeners = new Set<(state: AppStateStatus) => void>();
const mockPush = jest.fn();
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('../use-flight-publication', () => ({ useFlightPublication: () => mockPublication }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) }));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/features/flights/components/track-plate', () => ({ TrackPlate: () => null }));
const preview: ShareFlightPreview = {
  title: 'A quiet ridge', site: 'Jugra', startedAt: 1000, timezoneOffsetMinutes: -480,
  durationMs: 60000, distanceMetres: 2100, routePreview: [],
};
jest.mock('@/components/ui', () => Object.fromEntries(['Button', 'Card', 'LinkButton', 'Notice', 'SectionLabel']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
type Node = { props: Record<string, any> };
const controls = () => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)] as Node[];
const control = (label: string) => controls().find(node => node.props.label === label)!;
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
const mount = (element: React.ReactElement) => run(() => { rendered = create(element); });
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockAppListeners.clear();
  mockFeed = feedContext(); mockFriends = friendsContext(); mockPublication = publicationView();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    mockAppListeners.add(listener);
    return { remove: () => { mockAppListeners.delete(listener); } };
  });
});
afterEach(async () => { if (rendered) await run(() => rendered.unmount()); jest.restoreAllMocks(); });

it('requires the full consent before enabling automatic sharing and does not enable on cancel', async () => {
  await mount(React.createElement(AutomaticSharingCard));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  await run(() => control('Change').props.onPress());
  expect(rendered.root.findByType(SharingConsent).props.automatic).toBe(true);
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
  await run(() => control('Not now').props.onPress());
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
  await run(() => control('Change').props.onPress());
  await run(() => control('Turn on automatic sharing').props.onPress());
  expect(mockFeed.setAutoShare).toHaveBeenCalledWith(true);
});

it('disables future sharing without calling any publication hide action', async () => {
  mockFeed.preferences = { enabled: true, generation: 'generation' };
  await mount(React.createElement(AutomaticSharingCard));
  await run(() => control('Change').props.onPress());
  await run(() => control('Stop sharing future flights').props.onPress());
  expect(mockFeed.setAutoShare).toHaveBeenCalledWith(false);
  expect(mockPublication.hide).not.toHaveBeenCalled();
});

it('keeps consent visible with a retry after preference save fails', async () => {
  jest.mocked(mockFeed.setAutoShare).mockRejectedValue(new Error('Network lost'));
  await mount(React.createElement(AutomaticSharingCard));
  await run(() => control('Change').props.onPress());
  await run(() => control('Turn on automatic sharing').props.onPress());
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  expect(rendered.root.findByType(Notice).props.children).toBe('Network lost');
});

it('requires explicit consent to manually share a private or hidden flight', async () => {
  mockPublication.state = 'hidden';
  jest.mocked(mockPublication.share).mockImplementation(async () => { mockPublication.state = 'pending'; });
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  await run(() => control('Share again…').props.onPress());
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  expect(mockPublication.share).not.toHaveBeenCalled();
  await run(() => control('Share this flight with friends').props.onPress());
  expect(mockPublication.share).toHaveBeenCalledTimes(1);
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  const labels = rendered.root.findAllByType(Text).map((node: Node) => node.props.children);
  expect(labels).toContain('Waiting to share');
  expect(labels).not.toContain('Shared with friends');
});

it('confirms hiding a pending post and never deletes a private flight', async () => {
  mockPublication.state = 'pending';
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  await run(() => control('Hide from friends…').props.onPress());
  expect(mockPublication.hide).not.toHaveBeenCalled();
  await run(() => control('Hide this flight').props.onPress());
  expect(mockPublication.hide).toHaveBeenCalledTimes(1);
  expect(controls().some(node => /Delete/.test(node.props.label))).toBe(false);
});

it('opens a shared preview separately and clears confirmation on an account switch', async () => {
  mockPublication = publicationView({ state: 'shared', activityId: 'activity-1' });
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  await run(() => control('Preview shared flight').props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/shared-flights/[id]', params: { id: 'activity-1' } });
  await run(() => control('Hide from friends…').props.onPress());
  mockFriends = friendsContext({ identityKey: 'owner-b', profile: { userId: 'owner-b', displayName: 'Other', username: 'other', discoverable: true, backedUpFlightCount: 0 } });
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview })));
  expect(control('Hide this flight')).toBeUndefined();
});

it('does not claim a queued hide is complete or allow a re-share before confirmation', async () => {
  mockPublication = publicationView({ state: 'hidden', pendingHide: true });
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  expect(rendered.root.findByType(Notice).props.children).toContain('Friends may still see this flight');
  expect(control('Share again…')).toBeUndefined();
  await run(() => control('Retry hide').props.onPress());
  expect(mockPublication.retry).toHaveBeenCalledTimes(1);
});

it('gates sharing on sign-in and permits only a queued hide while offline', async () => {
  mockFriends.status = 'signed_out';
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  expect(control('Open Account to share')).toBeDefined();
  expect(control('Share flight…')).toBeUndefined();
  mockFriends = friendsContext({ available: false });
  mockPublication = publicationView({ state: 'shared', online: false, activityId: 'activity-1' });
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview })));
  expect(control('Preview shared flight').props.disabled).toBe(true);
  expect(control('Refresh sharing status').props.disabled).toBe(true);
  expect(control('Hide from friends…').props.disabled).toBe(false);
  expect(rendered.root.findByType(Notice).props.children).toContain('when the server confirms');
  await run(() => control('Hide from friends…').props.onPress());
  await run(() => control('Hide this flight').props.onPress());
  expect(mockPublication.hide).toHaveBeenCalledTimes(1);
});

it('shows the selected flight and lets Android Back cancel without publishing', async () => {
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  await run(() => control('Share flight…').props.onPress());
  expect(rendered.root.findAllByType(Text).some((node: Node) => node.props.children === preview.title)).toBe(true);
  await run(() => rendered.root.findByType(Modal).props.onRequestClose());
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  expect(mockPublication.share).not.toHaveBeenCalled();
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
});

it('prevents double-submit and dismissal during publication, then retains failed consent for retry', async () => {
  let reject!: (reason: Error) => void;
  jest.mocked(mockPublication.share).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  await run(() => control('Share flight…').props.onPress());
  const submit = control('Share this flight with friends').props.onPress;
  await run(() => { submit(); submit(); });
  expect(mockPublication.share).toHaveBeenCalledTimes(1);
  expect(control('Not now').props.disabled).toBe(true);
  await run(() => rendered.root.findByType(Modal).props.onRequestClose());
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  await run(() => reject(new Error('Connection lost')));
  expect(rendered.root.findByType(Notice).props.children).toBe('Connection lost');
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  await run(() => control('Share this flight with friends').props.onPress());
  expect(mockPublication.share).toHaveBeenCalledTimes(2);
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
});

it('dismisses manual consent on background, screen departure, and lost online eligibility', async () => {
  const element = React.createElement(FlightSharingSection, { flightId: 'flight-1', preview });
  await mount(element);
  await run(() => control('Share flight…').props.onPress());
  await run(() => { for (const listener of mockAppListeners) listener('background'); });
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  await run(() => control('Share flight…').props.onPress());
  mockFocused = false;
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview })));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  mockFocused = true;
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview })));
  await run(() => control('Share flight…').props.onPress());
  mockPublication = { ...mockPublication, online: false };
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview })));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  mockPublication = { ...mockPublication, online: true };
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview })));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  expect(mockPublication.share).not.toHaveBeenCalled();
});

it('resets preference consent for another account and never treats an unknown preference as off', async () => {
  await mount(React.createElement(AutomaticSharingCard));
  await run(() => control('Change').props.onPress());
  mockFeed = feedContext({ identityKey: 'owner-b', preferences: null });
  await run(() => rendered.update(React.createElement(AutomaticSharingCard)));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  expect(control('Change').props.disabled).toBe(true);
  expect(rendered.root.findAllByType(Text).some((node: Node) => node.props.children === 'New flights stay private')).toBe(false);
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
});

it.each(['account', 'flight'])('discards a pending share result after the %s changes', async changed => {
  let reject!: (reason: Error) => void;
  jest.mocked(mockPublication.share).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1', preview }));
  await run(() => control('Share flight…').props.onPress());
  await run(() => control('Share this flight with friends').props.onPress());
  if (changed === 'account') mockFriends = friendsContext({ identityKey: 'owner-b' });
  mockPublication = publicationView();
  const nextPreview = { ...preview, title: 'Another flight' };
  await run(() => rendered.update(React.createElement(FlightSharingSection, {
    flightId: changed === 'flight' ? 'flight-2' : 'flight-1', preview: nextPreview,
  })));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  await run(() => control('Share flight…').props.onPress());
  await run(() => reject(new Error('Old request failed')));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  expect(rendered.root.findAllByType(Notice)).toHaveLength(0);
  expect(mockPublication.share).not.toHaveBeenCalled();
});

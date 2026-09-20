import React from 'react';
import { Button, LinkButton, Notice } from '@/components/ui';
import { AutomaticSharingCard } from '../automatic-sharing-card';
import { FlightSharingSection } from '../flight-sharing-section';
import { SharingConsent } from '../sharing-consent';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext, friendsContext, publicationView } from './fixtures';

let mockFeed = feedContext();
let mockFriends = friendsContext();
let mockPublication = publicationView();
const mockPush = jest.fn();
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('../use-flight-publication', () => ({ useFlightPublication: () => mockPublication }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/ui', () => Object.fromEntries(['Button', 'Card', 'LinkButton', 'Notice', 'SectionLabel']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
type Node = { props: Record<string, any> };
const controls = () => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)] as Node[];
const control = (label: string) => controls().find(node => node.props.label === label)!;
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
const mount = (element: React.ReactElement) => run(() => { rendered = create(element); });
beforeEach(() => { jest.clearAllMocks(); mockFeed = feedContext(); mockFriends = friendsContext(); mockPublication = publicationView(); });
afterEach(async () => { if (rendered) await run(() => rendered.unmount()); });

it('requires the full consent before enabling automatic sharing and does not enable on cancel', async () => {
  await mount(React.createElement(AutomaticSharingCard));
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(0);
  await run(() => control('Choose automatic sharing').props.onPress());
  expect(rendered.root.findByType(SharingConsent).props.automatic).toBe(true);
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
  await run(() => control('Keep future flights private').props.onPress());
  expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
  await run(() => control('Choose automatic sharing').props.onPress());
  await run(() => control('Turn on automatic sharing').props.onPress());
  expect(mockFeed.setAutoShare).toHaveBeenCalledWith(true);
});

it('disables future sharing without calling any publication hide action', async () => {
  mockFeed.preferences = { enabled: true, generation: 'generation' };
  await mount(React.createElement(AutomaticSharingCard));
  await run(() => control('Stop sharing future flights').props.onPress());
  expect(mockFeed.setAutoShare).toHaveBeenCalledWith(false);
  expect(mockPublication.hide).not.toHaveBeenCalled();
});

it('keeps consent visible with a retry after preference save fails', async () => {
  jest.mocked(mockFeed.setAutoShare).mockRejectedValue(new Error('Network lost'));
  await mount(React.createElement(AutomaticSharingCard));
  await run(() => control('Choose automatic sharing').props.onPress());
  await run(() => control('Turn on automatic sharing').props.onPress());
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  expect(rendered.root.findByType(Notice).props.children).toBe('Network lost');
});

it('requires explicit consent to manually share a private or hidden flight', async () => {
  mockPublication.state = 'hidden';
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1' }));
  await run(() => control('Share again…').props.onPress());
  expect(rendered.root.findAllByType(SharingConsent)).toHaveLength(1);
  expect(mockPublication.share).not.toHaveBeenCalled();
  await run(() => control('Share this flight with friends').props.onPress());
  expect(mockPublication.share).toHaveBeenCalledTimes(1);
});

it('confirms hiding a pending post and never deletes a private flight', async () => {
  mockPublication.state = 'pending';
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1' }));
  await run(() => control('Hide from friends…').props.onPress());
  expect(mockPublication.hide).not.toHaveBeenCalled();
  await run(() => control('Hide this flight').props.onPress());
  expect(mockPublication.hide).toHaveBeenCalledTimes(1);
  expect(controls().some(node => /Delete/.test(node.props.label))).toBe(false);
});

it('opens a shared preview separately and clears confirmation on an account switch', async () => {
  mockPublication = publicationView({ state: 'shared', activityId: 'activity-1' });
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1' }));
  await run(() => control('Preview shared flight').props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/shared-flights/[id]', params: { id: 'activity-1' } });
  await run(() => control('Hide from friends…').props.onPress());
  mockFriends = friendsContext({ identityKey: 'owner-b', profile: { userId: 'owner-b', displayName: 'Other', backedUpFlightCount: 0 } });
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1' })));
  expect(control('Hide this flight')).toBeUndefined();
});

it('does not claim a queued hide is complete or allow a re-share before confirmation', async () => {
  mockPublication = publicationView({ state: 'hidden', pendingHide: true });
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1' }));
  expect(rendered.root.findByType(Notice).props.children).toContain('Friends may still see this flight');
  expect(control('Share again…')).toBeUndefined();
  await run(() => control('Retry hide').props.onPress());
  expect(mockPublication.retry).toHaveBeenCalledTimes(1);
});

it('gates sharing on sign-in and permits only a queued hide while offline', async () => {
  mockFriends.status = 'signed_out';
  await mount(React.createElement(FlightSharingSection, { flightId: 'flight-1' }));
  expect(control('Open Account to share')).toBeDefined();
  expect(control('Share flight…')).toBeUndefined();
  mockFriends = friendsContext({ available: false });
  mockPublication = publicationView({ state: 'shared', online: false, activityId: 'activity-1' });
  await run(() => rendered.update(React.createElement(FlightSharingSection, { flightId: 'flight-1' })));
  expect(control('Preview shared flight').props.disabled).toBe(true);
  expect(control('Refresh sharing status').props.disabled).toBe(true);
  expect(control('Hide from friends…').props.disabled).toBe(false);
  expect(rendered.root.findByType(Notice).props.children).toContain('when the server confirms');
  await run(() => control('Hide from friends…').props.onPress());
  await run(() => control('Hide this flight').props.onPress());
  expect(mockPublication.hide).toHaveBeenCalledTimes(1);
});

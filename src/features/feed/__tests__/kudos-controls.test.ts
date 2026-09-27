import React from 'react';
import { Text } from 'react-native';
import { Chip, Notice } from '@/components/ui';
import { TrackPlate } from '@/features/flights/components/track-plate';
import { KudosControls } from '../kudos-controls';
import { SharedFlightCard } from '../shared-flight-card';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext, sharedFlight } from './fixtures';

let mockFeed = feedContext();
const mockPush = jest.fn();
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/features/flights/components/track-plate', () => ({ TrackPlate: () => null }));
jest.mock('@/components/ui', () => Object.fromEntries(['Avatar', 'Button', 'Card', 'Chip', 'Notice']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type Node = { props: Record<string, any> };
let rendered: ReturnType<typeof create> | undefined;
const controls = (label: string) => rendered!.root.findAll((node: Node) => node.props?.accessibilityLabel === label, { deep: false }) as Node[];
const control = (label: string) => controls(label)[0];
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
const element = (own = false, summary: { count: number; givenByMe: boolean } | null = { count: 3, givenByMe: false }) =>
  React.createElement(KudosControls, { activityId: 'activity-1', own, summary });
async function render(tree: React.ReactElement = element()) {
  await run(() => { if (rendered) rendered.update(tree); else rendered = create(tree); });
}
beforeEach(() => { jest.clearAllMocks(); mockFeed = feedContext({ kudosByActivity: {} }); });
afterEach(async () => { if (rendered) await run(() => rendered!.unmount()); rendered = undefined; });

it('gives once while a request is pending and shows only the confirmed count', async () => {
  let complete!: (value: { activityId: string; count: number; givenByMe: boolean }) => void;
  jest.mocked(mockFeed.setKudos).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await render();
  const give = control('Give kudos');
  await run(() => { give.props.onPress(); give.props.onPress(); });
  expect(mockFeed.setKudos).toHaveBeenCalledTimes(1);
  expect(mockFeed.setKudos).toHaveBeenCalledWith('activity-1', true);
  mockFeed.kudosByActivity['activity-1'] = { summary: { count: 3, givenByMe: false }, pending: true, error: null };
  await render();
  expect(control('Giving kudos…').props).toMatchObject({ accessibilityState: { busy: true, disabled: true }, disabled: true });
  expect(control('View kudos (3)')).toBeDefined();
  expect(control('View kudos (4)')).toBeUndefined();
  await run(() => complete({ activityId: 'activity-1', count: 4, givenByMe: true }));
  mockFeed.kudosByActivity['activity-1'] = { summary: { count: 4, givenByMe: true }, pending: false, error: null };
  await render();
  expect(control('Remove kudos')).toBeDefined();
  expect(control('Remove kudos').props.accessibilityState.selected).toBe(true);
  expect(control('View kudos (4)')).toBeDefined();
});

it.each(['partial', 'no_track', 'gaps'] as const)('keeps real route data and explicit %s quality on route-led cards', async quality => {
  const flight = sharedFlight({ metrics: { ...sharedFlight().metrics, quality }, routePreview: quality === 'no_track' ? [] : sharedFlight().routePreview });
  await render(React.createElement(SharedFlightCard, { flight, own: false, onOpen: jest.fn(), onAuthor: jest.fn() }));
  expect(rendered!.root.findByType(TrackPlate).props).toMatchObject({ segments: flight.routePreview, state: quality === 'no_track' ? 'no_track' : 'ready' });
  expect(rendered!.root.findByType(Chip).props.tone).toBe('warning');
  const body = rendered!.root.findByProps({ accessibilityLabel: 'Open shared flight: Evening ridge' });
  expect(body.findAllByType(TrackPlate)).toHaveLength(1);
  expect(body.props.children[0].type).toBe(TrackPlate);
});

it('uses the shared confirmed state on card and detail and sends an explicit remove value', async () => {
  mockFeed.kudosByActivity['activity-1'] = { summary: { count: 4, givenByMe: true }, pending: false, error: null };
  await render(React.createElement(React.Fragment, null, element(), element()));
  expect(controls('View kudos (4)')).toHaveLength(2);
  await run(() => control('Remove kudos').props.onPress());
  expect(mockFeed.setKudos).toHaveBeenCalledWith('activity-1', false);
});

it('keeps a failed mutation retryable with its last confirmed count', async () => {
  jest.mocked(mockFeed.setKudos).mockRejectedValue(new Error('Connection failed'));
  await render();
  await run(() => control('Give kudos').props.onPress());
  mockFeed.kudosByActivity['activity-1'] = { summary: { count: 3, givenByMe: false }, pending: false, error: 'Try again when connected.' };
  await render();
  expect(control('View kudos (3)')).toBeDefined();
  expect(control('Give kudos').props.disabled).toBe(false);
  expect(rendered!.root.findByType(Notice).props.children).toBe('Try again when connected.');
  await run(() => control('Give kudos').props.onPress());
  expect(mockFeed.setKudos).toHaveBeenCalledTimes(2);
});

it('shows the owner a supporter list without offering self-kudos', async () => {
  await render(element(true));
  expect(control('Give kudos')).toBeUndefined();
  expect(control('Remove kudos')).toBeUndefined();
  await run(() => control('View kudos (3)').props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/shared-flights/[id]/kudos', params: { id: 'activity-1' } });
  expect(mockFeed.setKudos).not.toHaveBeenCalled();
});

it('explains recorder priority while leaving the lightweight supporter list available', async () => {
  mockFeed.recorderBusy = true;
  await render();
  expect(control('Give kudos').props.disabled).toBe(true);
  expect(control('View kudos (3)').props.disabled).toBe(false);
  await run(() => control('Give kudos').props.onPress());
  expect(mockFeed.setKudos).not.toHaveBeenCalled();
  expect((rendered!.root.findAllByType(Text) as Node[]).some(node => node.props.children === 'Finish recording before changing kudos.')).toBe(true);
});

it('does not restore an old prop count after the controller revokes this activity', async () => {
  mockFeed.kudosByActivity['activity-1'] = { summary: { count: 4, givenByMe: true }, pending: false, error: null };
  await render();
  mockFeed.kudosByActivity = {};
  await render();
  expect(control('View kudos (3)')).toBeUndefined();
  expect(control('View kudos (4)')).toBeUndefined();
  expect(control('View kudos').props.disabled).toBe(true);
  expect(control('Give kudos').props.disabled).toBe(true);
});

it.each(['missing_summary', 'controller_unavailable', 'offline'] as const)('disables actions without pretending an unavailable count is zero: %s', async reason => {
  if (reason === 'offline') mockFeed.available = false;
  if (reason === 'controller_unavailable') mockFeed.kudosByActivity['activity-1'] = { summary: null, pending: false, error: null };
  await render(element(false, reason === 'missing_summary' ? null : { count: 3, givenByMe: false }));
  expect(control('Give kudos').props.disabled).toBe(true);
  const view = control(reason === 'offline' ? 'View kudos (3)' : 'View kudos');
  expect(view.props.disabled).toBe(true);
  await run(() => { control('Give kudos').props.onPress(); view.props.onPress(); });
  expect(mockFeed.setKudos).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
  expect(control('View kudos (0)')).toBeUndefined();
});

it('places kudos outside card navigation and discloses the wider name audience', async () => {
  const open = jest.fn(); const author = jest.fn();
  await render(React.createElement(SharedFlightCard, { flight: sharedFlight(), own: false, onOpen: open, onAuthor: author }));
  let parent = rendered!.root.findByType(KudosControls).parent;
  while (parent) { expect(parent.props?.accessibilityRole).not.toBe('button'); parent = parent.parent; }
  await run(() => control('Give kudos').props.onPress());
  expect(open).not.toHaveBeenCalled(); expect(author).not.toHaveBeenCalled();
  expect((rendered!.root.findAllByType(Text) as Node[]).some(node => String(node.props.children).includes('including people outside your friends'))).toBe(true);
});

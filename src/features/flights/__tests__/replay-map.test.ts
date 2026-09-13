import React from 'react';
import { AppState, ScrollView } from 'react-native';

import { FlightMap } from '@/components/flight-map';
import { Button } from '@/components/ui';
import type { FlightReplay } from '@/lib/replay/model';
import { ReplayPlayer } from '../replay/replay-player';
import { ReplayRoute } from '../replay/replay-plots';
import { MAP_LOAD_TIMEOUT_MS } from '../replay/replay-map';
import { ReplayTimeline } from '../replay/replay-timeline';
import { create, act } from '../../../../tests/support/renderer';

let mockAvailable = true;
const mockMapMounts = jest.fn();
jest.mock('@/components/flight-map', () => ({
  FlightMap: jest.fn(function MockFlightMap() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
    require('react').useEffect(() => { mockMapMounts(); }, []);
    return null;
  }),
  get isFlightMapAvailable() { return mockAvailable; },
}));
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/ui', () => ({
  Button: () => null,
  Chip: () => null,
  Notice: () => null,
  SectionLabel: () => null,
}));
jest.mock('../replay/replay-plots', () => ({ ReplayRoute: () => null, ReplayAltitude: () => null }));
jest.mock('../replay/replay-timeline', () => ({ ReplayTimeline: () => null }));

const replay: Extract<FlightReplay, { kind: 'available' }> = {
  kind: 'available', flightId: 'walk', partial: false,
  bounds: { startedAt: 1000, endedAt: 21_000 },
  points: [0, 10_000, 20_000].map((offset) => ({ timestamp: 1000 + offset, latitude: 1.3 + offset / 1_000_000, longitude: 103.8, altitude: 30, speed: 1 })),
};
type TestNode = { props: Record<string, any> };
let rendered: { root: { findByType: (type: unknown) => TestNode; findAllByType: (type: unknown) => TestNode[]; findAllByProps: (props: Record<string, unknown>) => TestNode[] }; unmount: () => void };
const listeners = new Map<string, Set<(state: string) => void>>();
const appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
const map = () => rendered.root.findByType(FlightMap).props;
const button = (label: string) => rendered.root.findAllByType(Button).find((node) => node.props.label === label)!;
const fitControl = () => rendered.root.findAllByProps({ accessibilityRole: 'button', accessibilityLabel: 'Fit flight' })
  .find((node) => node.props.onPress);
const elapsed = () => rendered.root.findByType(ReplayTimeline).props.elapsedMs;
const hasMap = () => rendered.root.findAllByType(FlightMap).length > 0;
const hasGrid = () => rendered.root.findAllByType(ReplayRoute).length > 0;
async function press(callback: () => void) { await act(async () => callback()); }
async function mount() { await act(async () => { rendered = create(React.createElement(ReplayPlayer, { replay })); }); }
async function appState(state: string) { await press(() => listeners.get('change')?.forEach((listener) => listener(state))); }

beforeEach(() => {
  mockAvailable = true;
  listeners.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    const callbacks = listeners.get(event) ?? new Set();
    const listener = callback as (state: string) => void;
    callbacks.add(listener); listeners.set(event, callbacks);
    return { remove: () => { callbacks.delete(listener); } };
  });
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
  Object.defineProperty(AppState, 'currentState', appStateDescriptor);
});

it('keeps saved replay usable without map configuration and never mounts the native view', async () => {
  mockAvailable = false;
  await mount();
  expect(hasMap()).toBe(false);
  expect(hasGrid()).toBe(true);
  expect(fitControl()).toBeUndefined();
  expect(button('Retry map')).toBeUndefined();
  await press(() => rendered.root.findByType(ReplayTimeline).props.onSeek(5000));
  expect(elapsed()).toBe(5000);
});

it('defaults to Map without a view selector and preserves playback through automatic fallback and retry', async () => {
  await mount();
  expect(hasMap()).toBe(true);
  expect(hasGrid()).toBe(false);
  expect(rendered.root.findAllByProps({ accessibilityLabel: 'Map replay' })).toHaveLength(0);
  expect(rendered.root.findAllByProps({ accessibilityLabel: 'Grid replay' })).toHaveLength(0);
  await press(() => map().onReady());
  const track = map().track;
  await press(() => rendered.root.findByType(ReplayTimeline).props.onSeek(5000));
  expect(map().track).toBe(track);
  expect(map().pilotPosition[1]).toBeCloseTo(1.305);
  await press(() => button('Play').props.onPress());
  await press(() => map().onError('tiles unavailable'));
  expect(hasMap()).toBe(false);
  expect(hasGrid()).toBe(true);
  expect(elapsed()).toBe(5000);
  expect(button('Pause')).toBeDefined();
  expect(fitControl()).toBeUndefined();
  await press(() => button('Retry map').props.onPress());
  expect(map().pilotPosition[1]).toBeCloseTo(1.305);
  expect(elapsed()).toBe(5000);
  expect(button('Pause')).toBeDefined();
  expect(fitControl()).toBeDefined();
});

it('falls back after the load deadline and ignores callbacks from the replaced map', async () => {
  await mount();
  const obsolete = map();
  await press(() => jest.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
  expect(hasGrid()).toBe(true);
  expect(hasMap()).toBe(false);
  await press(() => button('Retry map').props.onPress());
  const current = map();
  await press(() => obsolete.onError('late error'));
  expect(hasMap()).toBe(true);
  await press(() => current.onReady());
  await press(() => jest.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
  expect(hasMap()).toBe(true);
});

it('recovers from native load failure without seeking, stopping playback or retaining a gesture lock', async () => {
  await mount();
  await press(() => rendered.root.findByType(ReplayTimeline).props.onSeek(5000));
  await press(() => button('Play').props.onPress());
  await press(() => map().onInteractionChange(true));
  expect(rendered.root.findByType(ScrollView).props.scrollEnabled).toBe(false);
  await press(() => map().onError('map unavailable'));
  expect(hasGrid()).toBe(true);
  expect(elapsed()).toBe(5000);
  expect(button('Pause')).toBeDefined();
  expect(rendered.root.findByType(ScrollView).props.scrollEnabled).toBe(true);
});

it('releases the map while backgrounded and returns paused at the saved replay position', async () => {
  await mount();
  await press(() => rendered.root.findByType(ReplayTimeline).props.onSeek(5000));
  await press(() => button('Play').props.onPress());
  const obsolete = map();
  await appState('background');
  expect(hasMap()).toBe(false);
  await press(() => jest.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS));
  await appState('active');
  expect(hasMap()).toBe(true);
  expect(elapsed()).toBe(5000);
  expect(button('Play')).toBeDefined();
  await press(() => obsolete.onError('late background error'));
  expect(hasMap()).toBe(true);
});

it('requests camera fitting only when the accessible target overlay is tapped', async () => {
  await mount();
  expect(map().fitRequest).toBe(0);
  await press(() => rendered.root.findByType(ReplayTimeline).props.onSeek(5000));
  expect(mockMapMounts).toHaveBeenCalledTimes(1);
  expect(map().fitRequest).toBe(0);
  expect(button('Fit flight')).toBeUndefined();
  expect(fitControl()?.props.accessibilityHint).toBe('Show the entire recorded route on the map');
  await press(() => fitControl()!.props.onPress());
  expect(map().fitRequest).toBe(1);
  expect(elapsed()).toBe(5000);
});

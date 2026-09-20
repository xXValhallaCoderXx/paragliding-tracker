import React from 'react';
import { AppState, BackHandler } from 'react-native';

import ReplayScreen from '@/app/flights/[id]/replay';
import { Button } from '@/components/ui';
import { RecorderLifecycleProvider } from '@/features/record/recorder-lifecycle';
import { recorderService } from '@/recorder/recorder-service';
import { useGetFlightReplayQuery } from '@/store/endpoints';
import { ReplayPlayer } from '../replay/replay-player';
import { ReplayTimeline } from '../replay/replay-timeline';
import { create, act } from '../../../../tests/support/renderer';

let mockId = 'flight-123';
let mockFocused = true;
let mockFetching = false;
let mockDuration = 100_000;
const mockQueryRelease = jest.fn();
const mockQueryMount = jest.fn();
const mockRouter = { dismissTo: jest.fn() };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: mockId }),
  useIsFocused: () => mockFocused,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: { recover: jest.fn() } }));
jest.mock('@/store/endpoints', () => ({ useGetFlightReplayQuery: jest.fn() }));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/ui', () => ({
  BusyRow: () => null, Button: () => null, Notice: () => null, TopBar: () => null, Chip: () => null, SectionLabel: () => null,
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../replay/replay-map', () => ({ ReplayMap: () => null }));
jest.mock('../replay/replay-plots', () => ({ ReplayAltitude: () => null }));
jest.mock('../replay/replay-timeline', () => ({ ReplayTimeline: () => null }));

type TestNode = { props: Record<string, any> };
let rendered: {
  root: { findByType(type: unknown): TestNode; findAllByType(type: unknown): TestNode[]; findAllByProps(props: Record<string, unknown>): TestNode[] };
  unmount(): void; update(element: React.ReactElement): void;
} | undefined;
const listeners = new Map<string, Set<(state: string) => void>>();
const frames = new Map<number, FrameRequestCallback>();
const appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
let now = 0;
let nextFrame = 0;
const tree = () => React.createElement(RecorderLifecycleProvider, null, React.createElement(ReplayScreen));
const elapsed = () => rendered!.root.findByType(ReplayTimeline).props.elapsedMs;
const button = (label: string) => rendered!.root.findAllByType(Button).find((node) => node.props.label === label);
const speed = (value: number) => rendered!.root.findAllByProps({ accessibilityLabel: `${value} times speed` }).find((node) => node.props.onPress)!;
async function press(callback: () => void) { await act(async () => callback()); }
async function render() { await act(async () => { rendered = create(tree()); }); }
async function update() { await act(async () => rendered!.update(tree())); }
async function appState(state: string) {
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: state });
  await press(() => [...listeners.get('change') ?? []].forEach((listener) => listener(state)));
}
function deferRecovery() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  // The lifecycle provider only waits for recovery; it does not consume its snapshot.
  jest.mocked(recorderService.recover).mockReturnValueOnce(promise.then(() => undefined as never));
  return () => act(async () => { resolve(); await promise; });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockId = 'flight-123'; mockFocused = true; mockFetching = false; mockDuration = 100_000;
  now = 0; nextFrame = 0; frames.clear(); listeners.clear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((id) => { if (typeof id === 'number') frames.delete(id); });
  jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    const handlers = listeners.get(event) ?? new Set();
    const handler = callback as (state: string) => void;
    handlers.add(handler); listeners.set(event, handlers);
    return { remove: () => handlers.delete(handler) };
  });
  jest.mocked(recorderService.recover).mockResolvedValue(undefined as never);
  jest.mocked(useGetFlightReplayQuery).mockImplementation(function useQuery(id) {
    React.useEffect(() => { mockQueryMount(id); return () => mockQueryRelease(id); }, [id]);
    return {
      currentData: {
        kind: 'available', flightId: id, partial: false, bounds: { startedAt: 0, endedAt: mockDuration },
        points: [0, mockDuration].map((timestamp) => ({ timestamp, latitude: 1.3, longitude: 103.8, altitude: 10, speed: 1 })),
      },
      isFetching: mockFetching, refetch: jest.fn(),
    } as unknown as ReturnType<typeof useGetFlightReplayQuery>;
  });
});
afterEach(async () => {
  if (rendered) await act(async () => rendered!.unmount());
  rendered = undefined;
  jest.restoreAllMocks();
  Object.defineProperty(AppState, 'currentState', appStateDescriptor);
});

it('reproduces Home/return through the real parent recovery gate and restores paused position and speed', async () => {
  await render();
  await press(() => rendered!.root.findByType(ReplayTimeline).props.onSeek(35_000));
  await press(() => speed(10).props.onPress());
  await press(() => button('Play')!.props.onPress());
  now += 100;
  await appState('background');
  expect(elapsed()).toBe(36_000);
  expect(frames.size).toBe(0);

  const finishRecovery = deferRecovery();
  now += 10_000;
  await appState('active');
  expect(rendered!.root.findAllByType(ReplayPlayer)).toHaveLength(0);
  expect(mockQueryRelease).toHaveBeenCalledWith('flight-123');
  expect(mockQueryMount).toHaveBeenCalledTimes(1);
  await finishRecovery();
  expect(mockQueryMount).toHaveBeenCalledTimes(2);
  expect(elapsed()).toBe(36_000);
  expect(speed(10).props.accessibilityState.selected).toBe(true);
  expect(button('Play')).toBeDefined();
  expect(button('Pause')).toBeUndefined();
  expect(frames.size).toBe(0);

  // A second interruption also restores the latest bookmark, without accumulating samples.
  await press(() => rendered!.root.findByType(ReplayTimeline).props.onSeek(50_000));
  const finishAgain = deferRecovery();
  await appState('active');
  await finishAgain();
  expect(elapsed()).toBe(50_000);
  expect(button('Play')).toBeDefined();
});

it('keeps the bookmark through query refresh and clamps it to refreshed flight bounds', async () => {
  await render();
  await press(() => rendered!.root.findByType(ReplayTimeline).props.onSeek(80_000));
  await press(() => speed(1).props.onPress());
  mockFetching = true;
  await update();
  expect(rendered!.root.findAllByType(ReplayPlayer)).toHaveLength(0);
  mockDuration = 40_000; mockFetching = false;
  await update();
  expect(elapsed()).toBe(40_000);
  expect(speed(1).props.accessibilityState.selected).toBe(true);
  expect(button('Play again')).toBeDefined();
});

it('preserves a paused bookmark on screen blur while releasing the query and player', async () => {
  await render();
  await press(() => rendered!.root.findByType(ReplayTimeline).props.onSeek(25_000));
  mockFocused = false;
  await update();
  expect(mockQueryRelease).toHaveBeenCalledTimes(1);
  expect(rendered!.root.findAllByType(ReplayPlayer)).toHaveLength(0);
  mockFocused = true;
  await update();
  expect(elapsed()).toBe(25_000);
  expect(button('Play')).toBeDefined();
});

it('does not apply a bookmark to another flight or retain it after leaving the route', async () => {
  await render();
  await press(() => rendered!.root.findByType(ReplayTimeline).props.onSeek(35_000));
  await press(() => speed(10).props.onPress());
  mockId = 'flight-456';
  await update();
  expect(elapsed()).toBe(0);
  expect(speed(60).props.accessibilityState.selected).toBe(true);
  expect(mockQueryRelease).toHaveBeenCalledWith('flight-123');
  mockId = 'flight-123';
  await update();
  expect(elapsed()).toBe(0);
  await press(() => rendered!.root.findByType(ReplayTimeline).props.onSeek(20_000));
  await act(async () => rendered!.unmount());
  rendered = undefined;
  await render();
  expect(elapsed()).toBe(0);
});

import React from 'react';
import { AppState } from 'react-native';

import { useReplayPlayback } from '../replay/use-replay-playback';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve the renderer bundled with jest-expo
const { create, act } = require(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
let mockFocused = true;
let mockReducedMotion = false;
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factories are hoisted
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => mockReducedMotion }));

let now = 0;
let nextFrameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const listeners = new Map<string, (state: string) => void>();
const appStateCurrentDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
let latest: ReturnType<typeof useReplayPlayback>;
let rendered: { unmount: () => void; update: (element: React.ReactElement) => void };
function Harness() {
  const playback = useReplayPlayback(100_000);
  React.useLayoutEffect(() => { latest = playback; });
  return null;
}
async function command(callback: () => void) { await act(async () => { callback(); latest.refresh(); }); }
async function frame(ms: number) {
  now += ms;
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(now)));
}
async function appEvent(event: string, state = '') { await act(async () => listeners.get(event)!(state)); }

beforeEach(async () => {
  now = 0; nextFrameId = 0; mockFocused = true; mockReducedMotion = false;
  frames.clear(); listeners.clear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++nextFrameId, callback); return nextFrameId; });
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation((id) => { if (typeof id === 'number') frames.delete(id); });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    listeners.set(event, callback as (state: string) => void);
    return { remove: () => { listeners.delete(event); } };
  });
  await act(async () => { rendered = create(React.createElement(Harness)); });
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  jest.restoreAllMocks();
  Object.defineProperty(AppState, 'currentState', appStateCurrentDescriptor);
});

it('opens paused and schedules frames only while playing', async () => {
  expect(latest.state).toEqual({ elapsedMs: 0, playing: false, speed: 60 });
  expect(frames.size).toBe(0);
  await command(() => latest.controller.play());
  expect(frames.size).toBe(1);
  await frame(50);
  expect(latest.state).toMatchObject({ elapsedMs: 3000, playing: true });
  await command(() => latest.controller.seek(80_000));
  expect(frames.size).toBe(0);
  await frame(1000);
  expect(latest.state).toMatchObject({ elapsedMs: 80_000, playing: false });
});

it.each([['change', 'background', 'change', 'active'], ['blur', '', 'focus', '']])('pauses and cancels frames on %s, without resuming on return', async (leave, state, returnEvent, returnState) => {
  await command(() => latest.controller.play());
  now += 100;
  await appEvent(leave!, state!);
  expect(latest.state).toMatchObject({ elapsedMs: 6000, playing: false });
  expect(frames.size).toBe(0);
  now += 10_000;
  await appEvent(returnEvent!, returnState!);
  expect(latest.state).toMatchObject({ elapsedMs: 6000, playing: false });
  expect(frames.size).toBe(0);
  await command(() => latest.controller.play());
  await frame(50);
  expect(latest.state.elapsedMs).toBe(9000);
});

it('synchronizes paused controls and cancels animation as soon as screen focus is lost', async () => {
  await command(() => latest.controller.play());
  now += 100;
  mockFocused = false;
  await act(async () => rendered.update(React.createElement(Harness)));
  expect(latest.state).toMatchObject({ elapsedMs: 6000, playing: false });
  expect(frames.size).toBe(0);
  mockFocused = true;
  await act(async () => rendered.update(React.createElement(Harness)));
  await frame(1000);
  expect(latest.state).toMatchObject({ elapsedMs: 6000, playing: false });
});

it('stops rendering at the end and restarts only after Play', async () => {
  await command(() => latest.controller.play());
  await frame(2000);
  expect(latest.state).toMatchObject({ elapsedMs: 100_000, playing: false });
  expect(frames.size).toBe(0);
  await command(() => latest.controller.play());
  expect(latest.state).toMatchObject({ elapsedMs: 0, playing: true });
});

it('steps at a lower paint rate for reduced motion while preserving elapsed timing', async () => {
  mockReducedMotion = true;
  await act(async () => rendered.update(React.createElement(Harness)));
  await command(() => latest.controller.play());
  await frame(100);
  expect(latest.state.elapsedMs).toBe(0);
  await frame(150);
  expect(latest.state.elapsedMs).toBe(15_000);
  await frame(100);
  expect(latest.state.elapsedMs).toBe(15_000);
  await frame(150);
  expect(latest.state.elapsedMs).toBe(30_000);
});

it('removes AppState listeners and cancels pending animation when unmounted', async () => {
  await command(() => latest.controller.play());
  await act(async () => rendered.unmount());
  expect(frames.size).toBe(0);
  expect(listeners.size).toBe(0);
  expect(latest.controller.snapshot().playing).toBe(false);
});

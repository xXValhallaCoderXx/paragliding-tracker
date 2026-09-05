import { bindPlaybackAppState, ReplayPlayback, type PlaybackAppState } from '../playback';

function setup(duration = 100_000) {
  let now = 0;
  const playback = new ReplayPlayback(duration, () => now);
  playback.setPresence('screen', true);
  playback.setPresence('app', true);
  return { playback, advance: (ms: number) => { now += ms; } };
}

it('opens paused at 60x and uses monotonic elapsed time', () => {
  const { playback, advance } = setup();
  expect(playback.snapshot()).toEqual({ elapsedMs: 0, playing: false, speed: 60 });
  advance(1000);
  expect(playback.snapshot().elapsedMs).toBe(0);
  playback.play(); advance(1000);
  expect(playback.snapshot()).toEqual({ elapsedMs: 60_000, playing: true, speed: 60 });
});
it('preserves elapsed time across speed changes', () => {
  const { playback, advance } = setup();
  playback.play(); advance(100); playback.setSpeed(10); advance(100); playback.setSpeed(1); advance(1000);
  expect(playback.snapshot().elapsedMs).toBe(8000);
});
it('pauses without jumping, and restarts from the end only on Play', () => {
  const { playback, advance } = setup(1000);
  playback.play(); advance(1000);
  expect(playback.snapshot()).toMatchObject({ elapsedMs: 1000, playing: false });
  advance(1000); expect(playback.snapshot().elapsedMs).toBe(1000);
  playback.play(); expect(playback.snapshot()).toMatchObject({ elapsedMs: 0, playing: true });
});
it('scrubbing pauses and remains paused after further clock ticks', () => {
  const { playback, advance } = setup();
  playback.play(); advance(100);
  playback.seek(80_000); advance(1000);
  expect(playback.snapshot()).toMatchObject({ elapsedMs: 80_000, playing: false });
});
it('seeks relative to current playback time and clamps either end', () => {
  const { playback, advance } = setup();
  playback.play(); advance(100); playback.seekBy(10_000);
  expect(playback.snapshot()).toMatchObject({ elapsedMs: 16_000, playing: false });
  playback.seek(-1000); expect(playback.snapshot().elapsedMs).toBe(0);
  playback.seek(1_000_000); expect(playback.snapshot().elapsedMs).toBe(100_000);
});
it.each(['screen', 'app', 'interaction'] as const)('pauses on loss of %s and never resumes on return', (kind) => {
  const { playback, advance } = setup();
  playback.play(); advance(100); playback.setPresence(kind, false);
  playback.play(); advance(1000);
  expect(playback.snapshot()).toMatchObject({ elapsedMs: 6000, playing: false });
  playback.setPresence(kind, true); advance(1000);
  expect(playback.snapshot()).toMatchObject({ elapsedMs: 6000, playing: false });
  playback.play(); advance(100);
  expect(playback.snapshot().elapsedMs).toBe(12_000);
});
it('does not allow Android focus to override a backgrounded app', () => {
  const { playback } = setup();
  playback.setPresence('app', false); playback.setPresence('interaction', true); playback.play();
  expect(playback.snapshot().playing).toBe(false);
});
it('uses supported AppState change/blur/focus events and removes all subscriptions', () => {
  const { playback, advance } = setup();
  const listeners = new Map<string, (state: string) => void>();
  const appState: PlaybackAppState = {
    currentState: 'active',
    addEventListener: (event, listener) => { listeners.set(event, listener); return { remove: () => { listeners.delete(event); } }; },
  };
  const refresh = jest.fn();
  const cleanup = bindPlaybackAppState(playback, appState, refresh);
  playback.play(); advance(100); listeners.get('blur')!('');
  expect(playback.snapshot()).toMatchObject({ elapsedMs: 6000, playing: false });
  listeners.get('focus')!(''); expect(playback.snapshot().playing).toBe(false);
  playback.play(); listeners.get('change')!('inactive');
  expect(playback.snapshot().playing).toBe(false);
  listeners.get('change')!('active'); expect(playback.snapshot().playing).toBe(false);
  playback.play(); cleanup();
  expect(listeners.size).toBe(0);
  expect(playback.snapshot().playing).toBe(false);
  expect(refresh).toHaveBeenCalledTimes(4);
});

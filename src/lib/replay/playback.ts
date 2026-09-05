export const REPLAY_SPEEDS = [1, 10, 60] as const;
export type ReplaySpeed = typeof REPLAY_SPEEDS[number];
export type Presence = 'screen' | 'app' | 'interaction';
export interface PlaybackSnapshot { elapsedMs: number; playing: boolean; speed: ReplaySpeed }

/** Local controller. The injected clock is performance.now(), never wall-clock time. */
export class ReplayPlayback {
  private elapsed = 0;
  private anchor = 0;
  private playing = false;
  private speed: ReplaySpeed = 60;
  private presence: Record<Presence, boolean> = { screen: false, app: false, interaction: true };
  constructor(readonly durationMs: number, private readonly clock: () => number) {}

  snapshot(): PlaybackSnapshot {
    if (this.playing) {
      const now = this.clock();
      this.elapsed = Math.min(this.durationMs, this.elapsed + Math.max(0, now - this.anchor) * this.speed);
      this.anchor = now;
      if (this.elapsed >= this.durationMs) this.playing = false;
    }
    return { elapsedMs: this.elapsed, playing: this.playing, speed: this.speed };
  }
  play() {
    if (!Object.values(this.presence).every(Boolean) || this.durationMs <= 0) return;
    if (this.playing) return;
    if (this.elapsed >= this.durationMs) this.elapsed = 0;
    this.anchor = this.clock();
    this.playing = true;
  }
  pause() { this.snapshot(); this.playing = false; }
  seek(elapsedMs: number) {
    this.pause();
    if (Number.isFinite(elapsedMs)) this.elapsed = Math.max(0, Math.min(this.durationMs, elapsedMs));
  }
  seekBy(deltaMs: number) { this.seek(this.snapshot().elapsedMs + deltaMs); }
  setSpeed(speed: ReplaySpeed) { this.snapshot(); this.speed = speed; }
  setPresence(kind: Presence, present: boolean) {
    this.presence[kind] = present;
    if (!present) this.pause();
  }
}

export interface PlaybackAppState {
  currentState: string | null;
  addEventListener(event: 'change' | 'blur' | 'focus', listener: (state: string) => void): { remove(): void };
}

/** Android notification shade emits blur even when AppState remains active. */
export function bindPlaybackAppState(playback: ReplayPlayback, appState: PlaybackAppState, refresh: () => void) {
  playback.setPresence('app', appState.currentState === 'active');
  const subscriptions = [
    appState.addEventListener('change', (state) => { playback.setPresence('app', state === 'active'); refresh(); }),
    appState.addEventListener('blur', () => { playback.setPresence('interaction', false); refresh(); }),
    appState.addEventListener('focus', () => { playback.setPresence('interaction', true); refresh(); }),
  ];
  return () => { subscriptions.forEach((subscription) => subscription.remove()); playback.pause(); };
}

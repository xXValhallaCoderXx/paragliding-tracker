import type { RecorderActivity, RecorderState } from './types';

/** Side services can yield to capture without subscribing to the recorder's polling UI. */
export class RecorderActivityChannel {
  private state: RecorderState = 'idle';
  private pending = 0;
  private readonly listeners = new Set<(activity: RecorderActivity) => void>();

  subscribe(listener: (activity: RecorderActivity) => void): () => void {
    this.listeners.add(listener);
    this.notify(listener);
    return () => { this.listeners.delete(listener); };
  }

  setState(state: RecorderState): void {
    if (state === this.state) return;
    this.state = state;
    this.publish();
  }

  /** Called synchronously before queueing work, so queued operations cannot appear idle. */
  begin(): () => void {
    this.pending += 1;
    if (this.pending === 1) this.publish();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.pending -= 1;
      if (this.pending === 0) this.publish();
    };
  }

  private notify(listener: (activity: RecorderActivity) => void): void {
    // Map/download observers must never reject or delay capture operations.
    try { listener({ state: this.state, lifecycleBusy: this.pending > 0 }); } catch { /* isolated observer */ }
  }

  private publish(): void { for (const listener of this.listeners) this.notify(listener); }
}

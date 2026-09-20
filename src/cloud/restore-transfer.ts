import type { ArchiveDownloadCandidate } from '@/archives/types';
import { EMPTY_RESTORE, INITIAL_RESTORE_ENVIRONMENT, restorePauseReason, type RestoreEnvironment, type RestoreSnapshot } from './restore-plan';

export interface RestoreTransferDependencies {
  list(owner: string): Promise<ArchiveDownloadCandidate[]>;
  counts(owner: string): Promise<{ total: number; completed: number }>;
  begin(owner: string, id: string): Promise<void>;
  commit(candidate: ArchiveDownloadCandidate, bytes: Uint8Array, shouldCommit: () => boolean): Promise<unknown>;
  fail(owner: string, id: string, error: string): Promise<unknown>;
  download(candidate: ArchiveDownloadCandidate, signal: AbortSignal, progress: (bytes: number) => void): Promise<Uint8Array>;
  getPaused(owner: string): Promise<boolean>;
  setPaused(owner: string, paused: boolean): Promise<void>;
  changed(id: string, artifactChanged?: boolean): void;
  publish(snapshot: RestoreSnapshot): void;
}

/** Serial, cancellable transfer worker. Summary synchronization has a separate network policy. */
export class RestoreTransfer {
  private environment: RestoreEnvironment = INITIAL_RESTORE_ENVIRONMENT;
  private snapshot: RestoreSnapshot = { ...EMPTY_RESTORE };
  private owner: string | null = null;
  private paused = false;
  private generation = 0;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  constructor(private readonly dependencies: RestoreTransferDependencies) {}
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<RestoreSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.dependencies.publish(this.snapshot);
  }
  async setOwner(owner: string | null): Promise<void> {
    if (owner === this.owner) return;
    this.generation += 1;
    this.controller?.abort();
    this.owner = owner;
    this.paused = false;
    this.publish({ ...EMPTY_RESTORE });
    const generation = this.generation;
    if (owner) {
      try {
        const paused = await this.dependencies.getPaused(owner);
        if (generation !== this.generation) return;
        this.paused = paused;
      } catch (error) {
        if (generation === this.generation) this.owner = null;
        throw error;
      }
    }
  }
  setEnvironment(environment: Partial<RestoreEnvironment>): void {
    this.environment = { ...this.environment, ...environment };
    const reason = this.reason();
    if (reason) {
      this.controller?.abort();
      if (this.snapshot.total > this.snapshot.completed) this.publish({ phase: 'paused', pauseReason: reason, currentFlightTitle: null });
    }
  }
  async pause(): Promise<void> {
    this.paused = true;
    this.controller?.abort();
    this.publish({ phase: 'paused', pauseReason: 'user' });
    if (this.owner) await this.dependencies.setPaused(this.owner, true);
  }
  async resume(allowMobileData: boolean): Promise<void> {
    this.paused = false;
    this.publish({ allowMobileData, lastError: null });
    if (this.owner) await this.dependencies.setPaused(this.owner, false);
  }
  private reason() { return restorePauseReason(this.environment, this.owner !== null, this.paused, this.snapshot.allowMobileData); }
  async run(isCurrent: () => boolean): Promise<void> {
    // Let the caller re-enter after owner changes; never join work for another identity.
    while (this.running) await this.running;
    if (!this.owner || !isCurrent()) return;
    const operation = this.perform(this.owner, this.generation, isCurrent);
    this.running = operation;
    try { await operation; } finally { if (this.running === operation) this.running = null; }
  }
  private async perform(owner: string, generation: number, isCurrent: () => boolean): Promise<void> {
    const current = () => generation === this.generation && owner === this.owner && isCurrent();
    const counts = await this.dependencies.counts(owner);
    if (!current()) return;
    this.publish(counts);
    const candidates = await this.dependencies.list(owner);
    let firstError: string | null = null;
    for (const candidate of candidates) {
      if (!current()) return;
      const reason = this.reason();
      if (reason) { this.publish({ phase: 'paused', pauseReason: reason, currentFlightTitle: null }); return; }
      const controller = new AbortController();
      this.controller = controller;
      this.publish({ phase: 'restoring', pauseReason: null, currentFlightTitle: candidate.title ?? 'Flight track', downloadedBytes: 0, totalBytes: candidate.byteCount });
      try {
        await this.dependencies.begin(owner, candidate.flightId);
        if (!current() || this.reason()) { controller.abort(); return; }
        this.dependencies.changed(candidate.flightId, false);
        const bytes = await this.dependencies.download(candidate, controller.signal, (downloadedBytes) => {
          if (current() && !controller.signal.aborted) this.publish({ downloadedBytes });
        });
        if (!current() || controller.signal.aborted || this.reason()) return;
        await this.dependencies.commit(candidate, bytes, () => current() && !controller.signal.aborted && !this.reason());
        if (!current()) return;
        this.dependencies.changed(candidate.flightId, true);
        const nextCounts = await this.dependencies.counts(owner);
        if (!current()) return;
        this.publish(nextCounts);
      } catch (error) {
        if (!current()) return;
        if (controller.signal.aborted || this.reason()) {
          this.publish({ phase: 'paused', pauseReason: this.reason(), currentFlightTitle: null }); return;
        }
        const message = error instanceof Error ? error.message : String(error);
        await this.dependencies.fail(owner, candidate.flightId, message);
        if (!current()) return;
        this.dependencies.changed(candidate.flightId, false);
        if (this.reason()) return;
        firstError ??= message;
        if ((error as { code?: string }).code === 'archive_storage') {
          this.publish({ phase: 'paused', pauseReason: 'storage', lastError: message }); return;
        }
      } finally {
        if (this.controller === controller) this.controller = null;
      }
    }
    if (current()) this.publish({ phase: firstError ? 'error' : 'idle', pauseReason: null, lastError: firstError,
      currentFlightTitle: null, downloadedBytes: null, totalBytes: null, allowMobileData: false });
  }
}

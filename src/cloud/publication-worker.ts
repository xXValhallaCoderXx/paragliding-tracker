import type { FeedService, SharedReplayArtifactV1 } from '@/social/feed-types';
import type { PublicationRepository } from '@/recorder/publication-repository-core';
import { SocialError } from '@/social/types';

export interface PublicationEnvironment {
  foreground: boolean; online: boolean; recorderReady: boolean; recorderBusy: boolean;
}
export interface PublicationWorkerDependencies {
  repository: PublicationRepository;
  remote: FeedService;
  owner(): string | null;
  sourceExists(owner: string, flightId: string): Promise<boolean>;
  backupReady(owner: string, flightId: string): Promise<boolean>;
  artifact(owner: string, flightId: string): Promise<SharedReplayArtifactV1>;
  changed(): void;
  now?(): number;
}
class SupersededPublication extends Error {}
const paused = () => new SupersededPublication('Publication context changed.');

/** One foreground transfer; persisted operation/revision survives every retry. */
export class PublicationWorker {
  private environment: PublicationEnvironment = { foreground: false, online: false, recorderReady: false, recorderBusy: false };
  private epoch = 0;
  private running: Promise<void> | null = null;
  private rerun = false;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  constructor(private readonly dependencies: PublicationWorkerDependencies) { this.now = dependencies.now ?? Date.now; }
  eligible(): boolean {
    return !!this.dependencies.owner() && this.environment.foreground && this.environment.online &&
      this.environment.recorderReady && !this.environment.recorderBusy;
  }
  invalidate(): void {
    this.epoch += 1; this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  setEnvironment(patch: Partial<PublicationEnvironment>): void {
    if (!Object.entries(patch).some(([key, value]) => this.environment[key as keyof PublicationEnvironment] !== value)) return;
    this.environment = { ...this.environment, ...patch };
    this.invalidate();
    if (this.eligible()) void this.requestSync();
  }
  requestSync = (): Promise<void> => {
    if (!this.eligible()) return Promise.resolve();
    if (this.running) { this.rerun = true; return this.running; }
    const operation = (async () => {
      do {
        this.rerun = false;
        await this.runOnce();
      } while (this.rerun && this.eligible());
    })().finally(() => { if (this.running === operation) this.running = null; });
    this.running = operation;
    return operation;
  };
  private async runOnce(): Promise<void> {
    if (!this.eligible()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const owner = this.dependencies.owner()!;
    const epoch = this.epoch;
    const abort = new AbortController(); this.abort = abort;
    const current = () => epoch === this.epoch && !abort.signal.aborted && owner === this.dependencies.owner() && this.eligible();
    const guard = () => { if (!current()) throw paused(); };
    const { repository, remote } = this.dependencies;
    try {
      const candidates = await repository.listPending(owner, this.now()); guard();
      for (const candidate of candidates) {
        try {
          const unchanged = async () => {
            guard();
            const latest = await repository.get(owner, candidate.flightId); guard();
            if (!latest || latest.operationId !== candidate.operationId || latest.state !== 'pending' || latest.action !== candidate.action) throw paused();
            if (candidate.action === 'share') {
              const exists = await this.dependencies.sourceExists(owner, candidate.flightId); guard();
              if (!exists) { await repository.cancel(candidate); throw paused(); }
            }
            if (candidate.action === 'share' && candidate.mode === 'automatic') {
              const preferences = await repository.getPreferences(owner); guard();
              if (!preferences?.enabled || !preferences.generation || preferences.generation !== candidate.consentGeneration) {
                await repository.cancel(candidate); throw paused();
              }
            }
          };
          await unchanged();
          if (candidate.action === 'hide') {
            const result = await remote.hideFlight(candidate.flightId, abort.signal);
            await unchanged();
            await repository.acknowledge(candidate, 'hidden', result.activityId);
          } else {
            const exists = await this.dependencies.sourceExists(owner, candidate.flightId); await unchanged();
            if (!exists) { await repository.cancel(candidate); continue; }
            const ready = await this.dependencies.backupReady(owner, candidate.flightId); await unchanged();
            if (!ready) { await repository.defer(candidate, this.now() + 30_000); continue; }
            const artifact = await this.dependencies.artifact(owner, candidate.flightId); await unchanged();
            const prepared = await remote.prepareShare({ flightId: candidate.flightId, operationId: candidate.operationId,
              mode: candidate.mode, expectedRevision: candidate.expectedRevision, consentGeneration: candidate.consentGeneration }, abort.signal);
            await unchanged();
            if (prepared.alreadyPublished) await repository.acknowledge(candidate, 'shared', prepared.activityId);
            else {
              const result = await remote.uploadShare(prepared, artifact, abort.signal);
              await unchanged();
              if (result.flightId !== candidate.flightId || result.state !== 'shared') throw new Error('Publication was not confirmed.');
              await repository.acknowledge(candidate, 'shared', result.activityId);
            }
          }
          guard(); this.dependencies.changed();
        } catch (error) {
          if (!current()) return;
          if (error instanceof SupersededPublication) continue;
          if (error instanceof SocialError && ['consent_changed', 'publication_changed', 'account_deleting'].includes(error.code)) {
            await repository.cancel(candidate);
          } else {
            const delay = Math.min(30 * 60_000, 30_000 * 2 ** Math.min(candidate.attemptCount, 10));
            const message = error instanceof SocialError ? error.message : error instanceof Error ? error.message : 'Flight sharing failed. Retry when connected.';
            await repository.fail(candidate, message, this.now() + delay);
          }
          guard(); this.dependencies.changed();
        }
      }
      const next = await repository.nextAttempt(owner); guard();
      if (next !== null) this.timer = setTimeout(() => { this.timer = null; void this.requestSync(); }, Math.max(1000, next - this.now()));
    } catch {
      // Initialization/storage errors remain retryable on the next lifecycle event.
    } finally { if (this.abort === abort) this.abort = null; }
  }
}

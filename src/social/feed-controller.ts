import type { AuthSnapshot } from '@/cloud/types';
import type { FeedService, FeedSnapshot, SharedArtifactManifest, SharingPreferences } from './feed-types';
import { feedError } from './feed-service';
import { SocialError } from './types';

export const EMPTY_FEED: FeedSnapshot = {
  identityKey: null, available: false, recorderBusy: false, revision: 0, preferences: null,
  items: [], nextCursor: null, loading: false, loadingMore: false, busy: false, error: null,
};
const stale = () => new SocialError('stale', 'Your account or connection changed. Open Friends again.');
export class FeedController {
  private snapshot: FeedSnapshot = { ...EMPTY_FEED };
  private readonly listeners = new Set<() => void>();
  private readonly operations = new Set<AbortController>();
  private readonly activityReadVersions = new Map<string, number>();
  private foreground = false;
  private online = false;
  private generation = 0;
  private refreshSequence = 0;
  private refreshAbort: AbortController | null = null;
  private loadMoreAbort: AbortController | null = null;
  constructor(private readonly service: FeedService, private readonly getAuth: () => AuthSnapshot,
    private readonly rememberPreferences: (owner: string, preferences: SharingPreferences) => Promise<void> = async () => {}) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private owner(): string | null { const auth = this.getAuth(); return auth.status === 'signed_in' ? auth.userId : null; }
  assertOwner = (owner: string | null) => { if (!owner || owner !== this.owner() || owner !== this.snapshot.identityKey) throw stale(); };
  private publish(patch: Partial<FeedSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(); }
  private invalidate() {
    this.generation += 1; this.refreshSequence += 1;
    for (const operation of this.operations) operation.abort();
    this.operations.clear(); this.refreshAbort = null; this.loadMoreAbort = null;
    this.activityReadVersions.clear();
    this.publish({ items: [], nextCursor: null, preferences: null, loading: false, loadingMore: false, busy: false, error: null,
      revision: this.snapshot.revision + 1, available: Boolean(this.snapshot.identityKey && this.foreground && this.online) });
  }
  syncIdentity = () => {
    const owner = this.owner();
    if (owner === this.snapshot.identityKey) return;
    this.snapshot = { ...this.snapshot, identityKey: owner }; this.invalidate();
    if (this.snapshot.available) void this.refresh().catch(() => undefined);
  };
  setEnvironment = (input: { foreground?: boolean; online?: boolean; recorderBusy?: boolean }) => {
    const previousAvailable = this.snapshot.available;
    const previousBusy = this.snapshot.recorderBusy;
    if (input.foreground !== undefined) this.foreground = input.foreground;
    if (input.online !== undefined) this.online = input.online;
    const recorderBusy = input.recorderBusy ?? previousBusy;
    const available = Boolean(this.snapshot.identityKey && this.foreground && this.online);
    if ((!available && previousAvailable) || (recorderBusy && !previousBusy)) {
      this.snapshot = { ...this.snapshot, available, recorderBusy }; this.invalidate();
    } else this.publish({ available, recorderBusy });
    if (available && (!previousAvailable || (previousBusy && !recorderBusy))) void this.refresh().catch(() => undefined);
  };
  /** Relationship actions invalidate detail/replay even when their routes remain mounted. */
  connectionsChanged = () => { this.invalidate(); if (this.snapshot.available) void this.refresh().catch(() => undefined); };
  private begin() {
    const owner = this.owner(); this.assertOwner(owner);
    if (!this.snapshot.available) throw new SocialError('unavailable', 'Connect to the internet to load shared flights.');
    const generation = this.generation;
    const controller = new AbortController(); this.operations.add(controller);
    const guard = () => {
      if (controller.signal.aborted || generation !== this.generation || this.owner() !== owner || !this.snapshot.available) throw stale();
    };
    return { owner: owner!, controller, guard, generation, finish: () => { this.operations.delete(controller); } };
  }
  refresh = async () => {
    const operation = this.begin();
    this.refreshAbort?.abort(); this.loadMoreAbort?.abort(); this.loadMoreAbort = null;
    this.refreshAbort = operation.controller;
    const sequence = ++this.refreshSequence;
    // Revocation may concern any previously loaded page. Hide all old cards while reauthorizing.
    this.publish({ items: [], nextCursor: null, loading: true, loadingMore: false, error: null, revision: this.snapshot.revision + 1 });
    try {
      const [page, preferences] = await Promise.all([this.service.getFeed(null, operation.controller.signal), this.service.getPreferences(operation.controller.signal)]);
      operation.guard(); if (sequence !== this.refreshSequence) throw stale();
      await this.rememberPreferences(operation.owner, preferences);
      operation.guard(); if (sequence !== this.refreshSequence) throw stale();
      this.publish({ items: page.items, nextCursor: page.nextCursor, preferences });
    } catch (error) {
      if (operation.generation === this.generation && sequence === this.refreshSequence && !operation.controller.signal.aborted) this.publish({ error: feedError(error).message });
      throw feedError(error);
    } finally {
      operation.finish();
      if (operation.generation === this.generation && sequence === this.refreshSequence) { this.refreshAbort = null; this.publish({ loading: false }); }
    }
  };
  loadMore = async () => {
    if (!this.snapshot.nextCursor || this.snapshot.loading || this.snapshot.loadingMore) return;
    const operation = this.begin(); const cursor = this.snapshot.nextCursor; const sequence = this.refreshSequence;
    this.loadMoreAbort = operation.controller; this.publish({ loadingMore: true, error: null });
    try {
      const page = await this.service.getFeed(cursor, operation.controller.signal); operation.guard();
      if (sequence !== this.refreshSequence) throw stale();
      const seen = new Set(this.snapshot.items.map(item => item.activityId));
      if (page.nextCursor?.activityId === cursor.activityId && page.nextCursor.publishedAt === cursor.publishedAt) throw new SocialError('invalid_response', 'Refresh Friends to continue loading flights.');
      this.publish({ items: [...this.snapshot.items, ...page.items.filter(item => !seen.has(item.activityId))], nextCursor: page.nextCursor });
    } catch (error) {
      if (operation.generation === this.generation && sequence === this.refreshSequence && !operation.controller.signal.aborted) this.publish({ error: feedError(error).message });
      throw feedError(error);
    } finally {
      operation.finish(); if (this.loadMoreAbort === operation.controller) { this.loadMoreAbort = null; this.publish({ loadingMore: false }); }
    }
  };
  setAutoShare = async (enabled: boolean) => {
    if (this.snapshot.busy) throw new SocialError('busy', 'Wait for the current sharing change to finish.');
    const operation = this.begin(); this.publish({ busy: true, error: null });
    // A preferences read started before this write must not restore an obsolete consent generation.
    this.refreshAbort?.abort(); this.refreshSequence += 1; this.publish({ loading: false });
    try {
      const preferences = await this.service.setAutoShare(enabled, operation.controller.signal); operation.guard();
      this.refreshAbort?.abort(); this.refreshSequence += 1; this.publish({ loading: false });
      await this.rememberPreferences(operation.owner, preferences); operation.guard();
      this.publish({ preferences });
    } catch (error) {
      if (operation.generation === this.generation && !operation.controller.signal.aborted) this.publish({ error: feedError(error).message });
      throw feedError(error);
    } finally { operation.finish(); if (operation.generation === this.generation) this.publish({ busy: false }); }
  };
  getDetail = async (activityId: string) => {
    const operation = this.begin();
    const revision = this.snapshot.revision;
    const activityVersion = this.activityReadVersions.get(activityId) ?? 0;
    try {
      const detail = await this.service.getDetail(activityId, operation.controller.signal); operation.guard();
      if (revision !== this.snapshot.revision || activityVersion !== (this.activityReadVersions.get(activityId) ?? 0)) throw stale();
      return detail;
    } catch (error) {
      if (operation.generation === this.generation && feedError(error).code === 'unavailable') this.revokeActivity(activityId);
      throw error;
    }
    finally { operation.finish(); }
  };
  getReplay = async (activityId: string, manifest: SharedArtifactManifest) => {
    if (this.snapshot.recorderBusy) throw new SocialError('busy', 'Finish recording before opening a shared replay.');
    const operation = this.begin();
    const revision = this.snapshot.revision;
    const activityVersion = this.activityReadVersions.get(activityId) ?? 0;
    try {
      const replay = await this.service.getReplay(activityId, manifest, operation.controller.signal); operation.guard();
      if (revision !== this.snapshot.revision || activityVersion !== (this.activityReadVersions.get(activityId) ?? 0)) throw stale();
      return replay;
    } catch (error) {
      if (operation.generation === this.generation && feedError(error).code === 'unavailable') this.revokeActivity(activityId);
      throw error;
    }
    finally { operation.finish(); }
  };
  private revokeActivity(activityId: string) {
    // Fence older successful responses without repeatedly remounting a denied route.
    this.activityReadVersions.set(activityId, (this.activityReadVersions.get(activityId) ?? 0) + 1);
    this.publish({ items: this.snapshot.items.filter(item => item.activityId !== activityId) });
  }
  getPublication = async (flightId: string) => {
    const operation = this.begin();
    try { const publication = await this.service.getPublication(flightId, operation.controller.signal); operation.guard(); return publication; }
    finally { operation.finish(); }
  };
}

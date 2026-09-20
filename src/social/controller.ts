import type { AuthSnapshot } from '@/cloud/types';
import { SocialError, type FriendsSnapshot, type FriendshipAction, type FriendshipSummary, type SocialService } from './types';

const empty = { profile: null, inviteCode: null, relationships: [] } as const;
export const EMPTY_FRIENDS: FriendsSnapshot = {
  ...empty, relationships: [], identityKey: null, available: false, revision: 0,
  loading: false, busy: false, error: null,
};
const stale = () => new SocialError('stale', 'Your account or connection changed. Open Friends and try again.');
const failure = (error: unknown) => error instanceof SocialError ? error :
  new SocialError('request_failed', 'Friends could not be loaded. Check your connection and try again.');

/** Owner-scoped memory only. No journal identity, disk cache, polling or realtime. */
export class FriendsController {
  private snapshot: FriendsSnapshot = { ...EMPTY_FRIENDS };
  private readonly listeners = new Set<() => void>();
  private readonly operations = new Set<AbortController>();
  private foreground = false;
  private online = false;
  private generation = 0;
  private authStatus: AuthSnapshot['status'] | undefined;
  private refreshSequence = 0;
  private refreshAbort: AbortController | null = null;

  constructor(private readonly service: SocialService, private readonly getAuth: () => AuthSnapshot) {}

  getSnapshot = (): FriendsSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private owner(): string | null {
    const auth = this.getAuth();
    return auth.status === 'signed_in' ? auth.userId : null;
  }
  assertOwner = (expected: string | null): void => {
    if (!expected || expected !== this.owner() || expected !== this.snapshot.identityKey) throw stale();
  };
  private publish(patch: Partial<FriendsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private invalidate(): void {
    this.generation += 1;
    this.refreshSequence += 1;
    for (const controller of this.operations) controller.abort();
    this.operations.clear();
    this.refreshAbort = null;
    const available = !!this.snapshot.identityKey && this.foreground && this.online;
    this.publish({ ...empty, relationships: [], available, loading: false, busy: false,
      revision: this.snapshot.revision + 1,
      error: this.snapshot.identityKey && this.foreground && !this.online ? 'Connect to the internet to load Friends.' : null });
  }
  syncIdentity = (): void => {
    const auth = this.getAuth();
    const owner = this.owner();
    if (owner === this.snapshot.identityKey && auth.status === this.authStatus) return;
    this.authStatus = auth.status;
    this.snapshot = { ...this.snapshot, identityKey: owner };
    this.invalidate();
    this.refreshWhenAvailable();
  };
  setEnvironment = (patch: { foreground?: boolean; online?: boolean }): void => {
    const foreground = patch.foreground ?? this.foreground;
    const online = patch.online ?? this.online;
    if (foreground === this.foreground && online === this.online) return;
    this.foreground = foreground;
    this.online = online;
    this.invalidate();
    this.refreshWhenAvailable();
  };
  private refreshWhenAvailable(): void {
    if (this.snapshot.available) void this.refresh().catch(() => undefined);
  }
  private begin() {
    const owner = this.owner();
    if (!owner || owner !== this.snapshot.identityKey) throw stale();
    if (!this.snapshot.available) throw new SocialError('unavailable', 'Connect to the internet and open Friends to continue.');
    const generation = this.generation;
    const controller = new AbortController();
    this.operations.add(controller);
    const current = () => generation === this.generation && owner === this.owner() && this.snapshot.available;
    const guard = () => { if (!current() || controller.signal.aborted) throw stale(); };
    return { controller, current, guard, owner };
  }
  refresh = async (): Promise<void> => {
    const scope = this.begin();
    const sequence = ++this.refreshSequence;
    this.refreshAbort?.abort();
    this.refreshAbort = scope.controller;
    this.publish({ loading: true, error: null });
    try {
      const result = await this.service.getState(scope.controller.signal);
      scope.guard();
      if (sequence !== this.refreshSequence) throw stale();
      if ((result.profile && result.profile.userId !== scope.owner) || result.relationships.some(row => row.userId === scope.owner)) {
        throw new SocialError('invalid_response', 'Friends returned an unexpected account. Try refreshing.');
      }
      this.publish({ ...result, loading: false, revision: this.snapshot.revision + 1 });
    } catch (error) {
      if (!scope.current() || sequence !== this.refreshSequence) throw stale();
      const problem = failure(error);
      this.publish({ ...empty, relationships: [], loading: false, error: problem.message, revision: this.snapshot.revision + 1 });
      throw problem;
    } finally {
      this.operations.delete(scope.controller);
      if (this.refreshAbort === scope.controller) this.refreshAbort = null;
    }
  };
  private async mutate<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.snapshot.busy) throw new SocialError('busy', 'Wait for the current Friends change to finish.');
    const scope = this.begin();
    // A response fetched before this change cannot restore an obsolete relation/code.
    this.refreshSequence += 1;
    this.refreshAbort?.abort();
    this.publish({ loading: false, busy: true, error: null });
    try {
      const result = await action(scope.controller.signal);
      scope.guard();
      this.publish({ revision: this.snapshot.revision + 1 });
      await this.refresh();
      scope.guard();
      return result;
    } catch (error) {
      if (!scope.current()) throw stale();
      const problem = failure(error);
      this.publish({ error: problem.message });
      throw problem;
    } finally {
      this.operations.delete(scope.controller);
      if (scope.current()) this.publish({ busy: false });
    }
  }
  saveProfile = (displayName: string): Promise<void> => this.mutate(signal => this.service.saveProfile(displayName, signal));
  rotateInviteCode = (): Promise<string> => this.mutate(signal => this.service.rotateInviteCode(signal));
  requestFriend = (code: string) => this.mutate(signal => this.service.requestFriend(code, signal));
  changeRelationship = (relationship: FriendshipSummary, action: FriendshipAction): Promise<void> =>
    this.mutate(signal => this.service.changeRelationship(relationship, action, signal));
  getFriendProfile = async (userId: string) => {
    const scope = this.begin();
    const revision = this.snapshot.revision;
    try {
      const profile = await this.service.getFriendProfile(userId, scope.controller.signal);
      scope.guard();
      if (revision !== this.snapshot.revision) throw stale();
      return profile;
    } catch (error) {
      if (!scope.current()) throw stale();
      throw failure(error);
    } finally { this.operations.delete(scope.controller); }
  };
}

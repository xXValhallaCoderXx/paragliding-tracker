import type { AuthSnapshot } from '@/cloud/types';
import { FriendsController } from '../controller';
import type { PilotSearchPage, SocialService, SocialState } from '../types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const state = (owner = A): SocialState => ({ profile: { userId: owner, displayName: owner === A ? 'A pilot' : 'B pilot', backedUpFlightCount: 2, username: owner === A ? 'pilot_a' : 'pilot_b', discoverable: false }, relationships: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 60 && !predicate(); n += 1) await Promise.resolve();
  expect(predicate()).toBe(true);
}
let auth: AuthSnapshot;
let api: jest.Mocked<SocialService>;
let controller: FriendsController;
beforeEach(() => {
  auth = { status: 'signed_in', userId: A, email: 'a@example.test', lastError: null };
  api = {
    getState: jest.fn<ReturnType<SocialService['getState']>, Parameters<SocialService['getState']>>().mockImplementation(async () => state(auth.userId!)),
    saveProfile: jest.fn<ReturnType<SocialService['saveProfile']>, Parameters<SocialService['saveProfile']>>().mockResolvedValue(undefined),
    searchPilots: jest.fn<ReturnType<SocialService['searchPilots']>, Parameters<SocialService['searchPilots']>>().mockResolvedValue({ status: 'ok', items: [], nextCursor: null }),
    requestPilot: jest.fn<ReturnType<SocialService['requestPilot']>, Parameters<SocialService['requestPilot']>>().mockResolvedValue('sent'),
    blockPilot: jest.fn<ReturnType<SocialService['blockPilot']>, Parameters<SocialService['blockPilot']>>().mockResolvedValue(undefined),
    changeRelationship: jest.fn<ReturnType<SocialService['changeRelationship']>, Parameters<SocialService['changeRelationship']>>().mockResolvedValue(undefined),
    getFriendProfile: jest.fn<ReturnType<SocialService['getFriendProfile']>, Parameters<SocialService['getFriendProfile']>>().mockResolvedValue(state(B).profile!),
  };
  controller = new FriendsController(api, () => auth);
  controller.syncIdentity();
});
async function online() {
  controller.setEnvironment({ foreground: true, online: true });
  await until(() => !controller.getSnapshot().loading);
}
it('has no network side effects until a signed-in foreground owner is online', async () => {
  expect(api.getState).not.toHaveBeenCalled();
  expect(controller.getSnapshot()).toMatchObject({ profile: null, available: false });
  await online();
  expect(controller.getSnapshot()).toMatchObject({ ...state(), available: true, identityKey: A });
});
it.each(['signout', 'switch'] as const)('discards a late fetch after %s before any lifecycle effect runs', async change => {
  await online();
  const response = deferred<SocialState>();
  api.getState.mockReturnValueOnce(response.promise);
  const request = controller.refresh();
  auth = { ...auth, status: change === 'signout' ? 'signed_out' : 'signed_in', userId: change === 'signout' ? null : B };
  // Direct auth guard must work even before syncIdentity is called by a provider.
  response.resolve(state());
  await expect(request).rejects.toMatchObject({ code: 'stale' });
  controller.syncIdentity();
  await until(() => !controller.getSnapshot().loading);
  expect(controller.getSnapshot().profile?.userId ?? null).toBe(change === 'signout' ? null : B);
});
it.each(['signout', 'switch'] as const)('rejects a late mutation response after %s', async change => {
  await online();
  const response = deferred<void>();
  api.saveProfile.mockReturnValueOnce(response.promise);
  const mutation = controller.saveProfile({ displayName: 'New name', username: 'pilot_a', discoverable: false });
  auth = { ...auth, status: change === 'signout' ? 'signed_out' : 'signed_in', userId: change === 'signout' ? null : B };
  controller.syncIdentity();
  response.resolve();
  await expect(mutation).rejects.toMatchObject({ code: 'stale' });
  await until(() => !controller.getSnapshot().loading);
  expect(controller.getSnapshot()).toMatchObject({ busy: false, error: null });
  expect(controller.getSnapshot().profile?.userId ?? null).toBe(change === 'signout' ? null : B);
});
it('keeps the latest overlapping refresh and rejects the older response', async () => {
  await online();
  const first = deferred<SocialState>();
  const second = deferred<SocialState>();
  api.getState.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const old = controller.refresh();
  const recent = controller.refresh();
  second.resolve({ ...state(), profile: { ...state().profile!, username: 'new_username' } }); await recent;
  first.resolve(state()); await expect(old).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().profile?.username).toBe('new_username');
});
it.each(['offline', 'background'] as const)('clears private memory on %s, aborts reads, then refreshes on return', async change => {
  await online();
  const response = deferred<SocialState>();
  api.getState.mockReturnValueOnce(response.promise);
  const request = controller.refresh();
  const signal = api.getState.mock.calls.at(-1)![0];
  controller.setEnvironment(change === 'offline' ? { online: false } : { foreground: false });
  expect(signal.aborted).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ profile: null, relationships: [], available: false });
  response.resolve(state()); await expect(request).rejects.toMatchObject({ code: 'stale' });
  await expect(controller.saveProfile({ displayName: 'Later', username: 'pilot_a', discoverable: false })).rejects.toMatchObject({ code: 'unavailable' });
  controller.setEnvironment(change === 'offline' ? { online: true } : { foreground: true });
  await until(() => !controller.getSnapshot().loading);
  expect(controller.getSnapshot().profile?.userId).toBe(A);
});
it('clears cached data after a failed refresh and rejects without leaking raw errors', async () => {
  await online();
  api.getState.mockRejectedValueOnce(new Error('private backend detail'));
  await expect(controller.refresh()).rejects.toThrow('Friends could not be loaded');
  expect(controller.getSnapshot()).toMatchObject({ profile: null, relationships: [], loading: false });
  expect(controller.getSnapshot().error).not.toContain('private');
});
it('rejects a failed save, preserves retryability and refreshes canonical data after success', async () => {
  await online();
  api.saveProfile.mockRejectedValueOnce(new Error('failed'));
  await expect(controller.saveProfile({ displayName: 'Draft', username: 'pilot_a', discoverable: false })).rejects.toThrow();
  expect(controller.getSnapshot().busy).toBe(false);
  await controller.saveProfile({ displayName: 'Draft', username: 'pilot_a', discoverable: false });
  expect(api.saveProfile).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot()).toMatchObject({ busy: false, error: null });
});
it('does not let an old read overwrite a successful mutation', async () => {
  await online();
  const response = deferred<SocialState>();
  api.getState.mockReturnValueOnce(response.promise);
  const old = controller.refresh();
  api.getState.mockResolvedValue({ ...state(), profile: { ...state().profile!, username: 'new_username' } });
  await controller.saveProfile({ displayName: 'A pilot', username: 'new_username', discoverable: false });
  response.resolve(state()); await expect(old).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().profile?.username).toBe('new_username');
});
it('rejects wrong-owner state and stale delayed confirmation ownership', async () => {
  await online();
  api.getState.mockResolvedValueOnce(state(B));
  await expect(controller.refresh()).rejects.toMatchObject({ code: 'invalid_response' });
  expect(controller.getSnapshot().profile).toBeNull();
  auth = { ...auth, userId: B };
  expect(() => controller.assertOwner(A)).toThrow('account or connection changed');
});
it('does not bump revision on profile reads and rejects a read invalidated by relationship refresh', async () => {
  await online();
  const revision = controller.getSnapshot().revision;
  await expect(controller.getFriendProfile(B)).resolves.toEqual(state(B).profile);
  expect(controller.getSnapshot().revision).toBe(revision);
  const response = deferred<NonNullable<SocialState['profile']>>();
  api.getFriendProfile.mockReturnValueOnce(response.promise);
  const profile = controller.getFriendProfile(B);
  await controller.refresh();
  response.resolve(state(B).profile!);
  await expect(profile).rejects.toMatchObject({ code: 'stale' });
});

const found: PilotSearchPage = { status: 'ok', items: [{ userId: B, displayName: 'B pilot', username: 'pilot_b', relationshipId: null, relationshipState: 'none' }], nextCursor: null };
it('returns search pages without retaining results or bumping the profile revision', async () => {
  await online();
  const before = controller.getSnapshot();
  api.searchPilots.mockResolvedValueOnce(found);
  await expect(controller.searchPilots('pilot')).resolves.toEqual(found);
  expect(controller.getSnapshot()).toBe(before);
  expect(api.searchPilots).toHaveBeenCalledWith('pilot', null, expect.any(AbortSignal));
});
it.each(['signout', 'switch', 'offline', 'background'] as const)('rejects late search data after %s', async change => {
  await online();
  const response = deferred<PilotSearchPage>();
  api.searchPilots.mockReturnValueOnce(response.promise);
  const search = controller.searchPilots('pilot');
  if (change === 'signout' || change === 'switch') {
    auth = { ...auth, status: change === 'signout' ? 'signed_out' : 'signed_in', userId: change === 'signout' ? null : B };
    // Read guards check direct auth before provider effects get a chance to clear it.
  } else controller.setEnvironment(change === 'offline' ? { online: false } : { foreground: false });
  response.resolve(found);
  await expect(search).rejects.toMatchObject({ code: 'stale' });
});
it('supports external query cancellation while a newer query returns, without stale global errors', async () => {
  await online();
  const first = deferred<PilotSearchPage>();
  api.searchPilots.mockReturnValueOnce(first.promise).mockResolvedValueOnce(found);
  const abort = new AbortController();
  const old = controller.searchPilots('earlier', null, abort.signal);
  abort.abort();
  expect(api.searchPilots.mock.calls[0][2].aborted).toBe(true);
  await expect(controller.searchPilots('pilot')).resolves.toEqual(found);
  first.resolve(found);
  await expect(old).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().error).toBeNull();
});
it('does not dispatch an already-cancelled search', async () => {
  await online();
  const abort = new AbortController(); abort.abort();
  await expect(controller.searchPilots('pilot', null, abort.signal)).rejects.toMatchObject({ code: 'stale' });
  expect(api.searchPilots).not.toHaveBeenCalled();
});
it('fences search and profile reads when a discovered-pilot block starts, before it completes', async () => {
  await online();
  const page = deferred<PilotSearchPage>();
  const profile = deferred<NonNullable<SocialState['profile']>>();
  const blocked = deferred<void>();
  api.searchPilots.mockReturnValueOnce(page.promise);
  api.getFriendProfile.mockReturnValueOnce(profile.promise);
  api.blockPilot.mockReturnValueOnce(blocked.promise);
  const search = controller.searchPilots('pilot');
  const read = controller.getFriendProfile(B);
  const revision = controller.getSnapshot().revision;
  const mutation = controller.blockPilot(B);
  expect(controller.getSnapshot()).toMatchObject({ busy: true });
  expect(controller.getSnapshot().revision).toBeGreaterThan(revision);
  page.resolve(found); profile.resolve(state(B).profile!);
  await expect(search).rejects.toMatchObject({ code: 'stale' });
  await expect(read).rejects.toMatchObject({ code: 'stale' });
  await expect(controller.searchPilots('pilot')).rejects.toMatchObject({ code: 'busy' });
  await expect(controller.requestPilot(B)).rejects.toMatchObject({ code: 'busy' });
  blocked.resolve(); await mutation;
  expect(controller.getSnapshot().busy).toBe(false);
});
it('rejects a search invalidated by a newer relationship refresh', async () => {
  await online();
  const response = deferred<PilotSearchPage>();
  api.searchPilots.mockReturnValueOnce(response.promise);
  const search = controller.searchPilots('pilot');
  await controller.refresh(); response.resolve(found);
  await expect(search).rejects.toMatchObject({ code: 'stale' });
});
it.each(['unavailable', 'rate_limited'] as const)('preserves %s request status and invalidates stale results', async status => {
  await online();
  api.requestPilot.mockResolvedValueOnce(status);
  const revision = controller.getSnapshot().revision;
  await expect(controller.requestPilot(B)).resolves.toBe(status);
  expect(controller.getSnapshot().revision).toBeGreaterThan(revision);
  expect(controller.getSnapshot().busy).toBe(false);
});
it('keeps search rate limiting local to its result, and sanitizes transport failures', async () => {
  await online();
  const limited: PilotSearchPage = { status: 'rate_limited', items: [], nextCursor: null };
  api.searchPilots.mockResolvedValueOnce(limited);
  await expect(controller.searchPilots('pilot')).resolves.toEqual(limited);
  api.searchPilots.mockRejectedValueOnce(new Error('private server detail'));
  await expect(controller.searchPilots('pilot')).rejects.toThrow('Friends could not be loaded');
  expect(controller.getSnapshot().error).toBeNull();
});
it('blocks discovery for legacy profiles but leaves existing relationship actions usable', async () => {
  api.getState.mockResolvedValue({ ...state(), profile: { ...state().profile!, username: null } });
  await online();
  await expect(controller.searchPilots('pilot')).rejects.toMatchObject({ code: 'profile_required' });
  await expect(controller.requestPilot(B)).rejects.toMatchObject({ code: 'profile_required' });
  await expect(controller.blockPilot(B)).rejects.toMatchObject({ code: 'profile_required' });
  expect(api.searchPilots).not.toHaveBeenCalled(); expect(api.requestPilot).not.toHaveBeenCalled(); expect(api.blockPilot).not.toHaveBeenCalled();
  await expect(controller.changeRelationship({ id: B, userId: B, displayName: 'Legacy friend', username: null, state: 'accepted' }, 'remove')).resolves.toBeUndefined();
});
it('rejects an unexpected self search result', async () => {
  await online();
  api.searchPilots.mockResolvedValueOnce({ ...found, items: [{ ...found.items[0], userId: A }] });
  await expect(controller.searchPilots('pilot')).rejects.toMatchObject({ code: 'invalid_response' });
});
it.each(['signout', 'switch'] as const)('rejects a discovered block response after %s', async change => {
  await online();
  const response = deferred<void>(); api.blockPilot.mockReturnValueOnce(response.promise);
  const mutation = controller.blockPilot(B);
  auth = { ...auth, status: change === 'signout' ? 'signed_out' : 'signed_in', userId: change === 'signout' ? null : B };
  controller.syncIdentity(); response.resolve();
  await expect(mutation).rejects.toMatchObject({ code: 'stale' });
  await until(() => !controller.getSnapshot().loading);
  expect(controller.getSnapshot()).toMatchObject({ busy: false, error: null });
});

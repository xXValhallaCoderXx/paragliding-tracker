import type { AuthSnapshot } from '@/cloud/types';
import { FriendsController } from '../controller';
import type { SocialService, SocialState } from '../types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const state = (owner = A): SocialState => ({ profile: { userId: owner, displayName: owner === A ? 'A pilot' : 'B pilot', backedUpFlightCount: 2 }, inviteCode: 'ABCD2345EFGH', relationships: [] });
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
    rotateInviteCode: jest.fn<ReturnType<SocialService['rotateInviteCode']>, Parameters<SocialService['rotateInviteCode']>>().mockResolvedValue('ABCD2345EFGH'),
    requestFriend: jest.fn<ReturnType<SocialService['requestFriend']>, Parameters<SocialService['requestFriend']>>().mockResolvedValue('sent'),
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
  expect(controller.getSnapshot()).toMatchObject({ profile: null, inviteCode: null, available: false });
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
  const mutation = controller.saveProfile('New name');
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
  second.resolve({ ...state(), inviteCode: 'JKLM2345NPQR' }); await recent;
  first.resolve(state()); await expect(old).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().inviteCode).toBe('JKLM2345NPQR');
});
it.each(['offline', 'background'] as const)('clears private memory on %s, aborts reads, then refreshes on return', async change => {
  await online();
  const response = deferred<SocialState>();
  api.getState.mockReturnValueOnce(response.promise);
  const request = controller.refresh();
  const signal = api.getState.mock.calls.at(-1)![0];
  controller.setEnvironment(change === 'offline' ? { online: false } : { foreground: false });
  expect(signal.aborted).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ profile: null, inviteCode: null, relationships: [], available: false });
  response.resolve(state()); await expect(request).rejects.toMatchObject({ code: 'stale' });
  await expect(controller.saveProfile('Later')).rejects.toMatchObject({ code: 'unavailable' });
  controller.setEnvironment(change === 'offline' ? { online: true } : { foreground: true });
  await until(() => !controller.getSnapshot().loading);
  expect(controller.getSnapshot().profile?.userId).toBe(A);
});
it('clears cached data after a failed refresh and rejects without leaking raw errors', async () => {
  await online();
  api.getState.mockRejectedValueOnce(new Error('private backend detail'));
  await expect(controller.refresh()).rejects.toThrow('Friends could not be loaded');
  expect(controller.getSnapshot()).toMatchObject({ profile: null, inviteCode: null, relationships: [], loading: false });
  expect(controller.getSnapshot().error).not.toContain('private');
});
it('rejects a failed save, preserves retryability and refreshes canonical data after success', async () => {
  await online();
  api.saveProfile.mockRejectedValueOnce(new Error('failed'));
  await expect(controller.saveProfile('Draft')).rejects.toThrow();
  expect(controller.getSnapshot().busy).toBe(false);
  await controller.saveProfile('Draft');
  expect(api.saveProfile).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot()).toMatchObject({ busy: false, error: null });
});
it('does not let an old read overwrite a successful mutation', async () => {
  await online();
  const response = deferred<SocialState>();
  api.getState.mockReturnValueOnce(response.promise);
  const old = controller.refresh();
  api.getState.mockResolvedValue({ ...state(), inviteCode: 'JKLM2345NPQR' });
  await controller.rotateInviteCode();
  response.resolve(state()); await expect(old).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().inviteCode).toBe('JKLM2345NPQR');
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

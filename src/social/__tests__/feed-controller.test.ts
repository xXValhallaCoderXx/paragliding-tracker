import type { AuthSnapshot } from '@/cloud/types';
import { FeedController } from '../feed-controller';
import type { FeedPage, FeedService, SharingPreferences } from '../feed-types';
import { SocialError } from '../types';
import { A, B, C, G, artifact, flight } from './feed-fixtures';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function until(predicate: () => boolean) { for (let i = 0; i < 100 && !predicate(); i += 1) await Promise.resolve(); expect(predicate()).toBe(true); }
let auth: AuthSnapshot;
let api: jest.Mocked<FeedService>;
let remember: jest.Mock;
let controller: FeedController;
beforeEach(() => {
  auth = { status: 'signed_in', userId: A, email: 'a@example.test', lastError: null };
  api = {
    getPreferences: jest.fn().mockResolvedValue({ enabled: false, generation: null }), setAutoShare: jest.fn().mockResolvedValue({ enabled: true, generation: G }),
    getFeed: jest.fn().mockResolvedValue({ items: [flight()], nextCursor: null }), getDetail: jest.fn().mockResolvedValue(flight()), getReplay: jest.fn().mockResolvedValue(artifact),
    getPublication: jest.fn(), prepareShare: jest.fn(), uploadShare: jest.fn(), hideFlight: jest.fn(),
  };
  remember = jest.fn().mockResolvedValue(undefined);
  controller = new FeedController(api, () => auth, remember); controller.syncIdentity();
});
async function online() { controller.setEnvironment({ online: true, foreground: true }); await until(() => !controller.getSnapshot().loading); }

it('stays inert while signed out/backgrounded and remembers only authorized preferences', async () => {
  expect(api.getFeed).not.toHaveBeenCalled(); await online();
  expect(controller.getSnapshot().items).toEqual([flight()]);
  expect(remember).toHaveBeenCalledWith(A, { enabled: false, generation: null });
});
it('never notifies subscribers of a new owner carrying the previous account’s data', async () => {
  await online();
  const observed: ReturnType<FeedController['getSnapshot']>[] = [];
  controller.subscribe(() => observed.push(controller.getSnapshot()));
  auth = { ...auth, userId: B }; controller.syncIdentity();
  expect(observed.length).toBeGreaterThan(0);
  for (const snapshot of observed) expect(snapshot).toMatchObject({ identityKey: B, items: [], preferences: null });
});
it.each(['signout', 'switch'] as const)('drops feed and preferences arriving after %s even before identity effects', async action => {
  await online(); remember.mockClear();
  const result = deferred<FeedPage>(); api.getFeed.mockReturnValueOnce(result.promise);
  const reading = controller.refresh();
  auth = { ...auth, status: action === 'signout' ? 'signed_out' : 'signed_in', userId: action === 'signout' ? null : B };
  result.resolve({ items: [flight()], nextCursor: null });
  await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(remember).not.toHaveBeenCalled();
  controller.syncIdentity();
  expect(controller.getSnapshot().items).toEqual([]);
});
it.each(['offline', 'background'] as const)('clears every page and rejects detail/replay after %s', async mode => {
  await online();
  const result = deferred<typeof artifact>(); api.getReplay.mockReturnValueOnce(result.promise);
  const reading = controller.getReplay(A, flight().artifact);
  const signal = api.getReplay.mock.calls.at(-1)![2];
  controller.setEnvironment(mode === 'offline' ? { online: false } : { foreground: false });
  expect(signal.aborted).toBe(true); expect(controller.getSnapshot()).toMatchObject({ items: [], preferences: null, available: false });
  result.resolve(artifact); await expect(reading).rejects.toMatchObject({ code: 'stale' });
});
it('aborts a replay when recording starts and refuses a new full replay read', async () => {
  await online(); const result = deferred<typeof artifact>(); api.getReplay.mockReturnValueOnce(result.promise);
  const reading = controller.getReplay(A, flight().artifact);
  const signal = api.getReplay.mock.calls.at(-1)![2]; controller.setEnvironment({ recorderBusy: true });
  expect(signal.aborted).toBe(true); result.resolve(artifact); await expect(reading).rejects.toMatchObject({ code: 'stale' });
  await expect(controller.getReplay(A, flight().artifact)).rejects.toMatchObject({ code: 'busy' });
});
it('deduplicates pagination and discards every old page during refresh', async () => {
  api.getFeed.mockResolvedValueOnce({ items: [flight(A)], nextCursor: { activityId: A, publishedAt: flight().publishedAt } });
  await online();
  api.getFeed.mockResolvedValueOnce({ items: [flight(A), flight(C)], nextCursor: null });
  await controller.loadMore(); expect(controller.getSnapshot().items.map(item => item.activityId)).toEqual([A, C]);
  const result = deferred<FeedPage>(); api.getFeed.mockReturnValueOnce(result.promise);
  const refresh = controller.refresh(); expect(controller.getSnapshot().items).toEqual([]);
  result.resolve({ items: [], nextCursor: null }); await refresh; expect(controller.getSnapshot().items).toEqual([]);
});
it('ignores pagination finishing after a newer refresh', async () => {
  api.getFeed.mockResolvedValueOnce({ items: [flight()], nextCursor: { activityId: A, publishedAt: flight().publishedAt } }); await online();
  const result = deferred<FeedPage>(); api.getFeed.mockReturnValueOnce(result.promise);
  const older = controller.loadMore(); await controller.refresh();
  result.resolve({ items: [flight(C)], nextCursor: null }); await expect(older).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().items.map(item => item.activityId)).toEqual([A]);
});
it('prevents an old preferences read from undoing a confirmed opt-in', async () => {
  await online(); const result = deferred<SharingPreferences>(); api.getPreferences.mockReturnValueOnce(result.promise);
  const reading = controller.refresh(); await controller.setAutoShare(true);
  result.resolve({ enabled: false, generation: null }); await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().preferences).toEqual({ enabled: true, generation: G });
  expect(remember.mock.calls.at(-1)).toEqual([A, { enabled: true, generation: G }]);
});
it('guards preferences changes across sign-out and ignores old publication callbacks', async () => {
  await online(); const result = deferred<SharingPreferences>(); api.setAutoShare.mockReturnValueOnce(result.promise);
  const writing = controller.setAutoShare(true); auth = { ...auth, status: 'signed_out', userId: null }; controller.syncIdentity();
  result.resolve({ enabled: true, generation: G }); await expect(writing).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot()).toMatchObject({ preferences: null, busy: false, items: [] });
});
it('removes a known revoked card and clears in-flight views after connection changes', async () => {
  await online(); api.getDetail.mockRejectedValueOnce(new SocialError('unavailable', 'No longer shared'));
  await expect(controller.getDetail(A)).rejects.toMatchObject({ code: 'unavailable' }); expect(controller.getSnapshot().items).toEqual([]);
  const result = deferred<ReturnType<typeof flight>>(); api.getDetail.mockReturnValueOnce(result.promise);
  const reading = controller.getDetail(A); controller.connectionsChanged();
  result.resolve(flight()); await expect(reading).rejects.toMatchObject({ code: 'stale' });
});
it('fences an older authorized response after a newer explicit denial without remount loops', async () => {
  await online(); const older = deferred<ReturnType<typeof flight>>();
  api.getDetail.mockReturnValueOnce(older.promise).mockRejectedValueOnce(new SocialError('unavailable', 'Hidden'));
  const reading = controller.getDetail(A); const revision = controller.getSnapshot().revision;
  await expect(controller.getDetail(A)).rejects.toMatchObject({ code: 'unavailable' });
  older.resolve(flight()); await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().revision).toBe(revision);
});

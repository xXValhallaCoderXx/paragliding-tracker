import type { AuthSnapshot } from '@/cloud/types';
import { FeedController } from '../feed-controller';
import type { FeedPage, FeedService, KudosPage, KudosResult, SharingPreferences } from '../feed-types';
import { SocialError } from '../types';
import { A, B, C, G, artifact, flight } from './feed-fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { resolve, reject, promise };
}
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
    setKudos: jest.fn().mockImplementation(async (activityId, given) => ({ activityId, count: given ? 1 : 0, givenByMe: given })),
    getKudos: jest.fn().mockImplementation(async activityId => ({ activityId, count: 1, givenByMe: false,
      items: [{ id: C, displayName: 'Pilot C' }], nextCursor: null })),
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

it('shares confirmed kudos across cards and detail without changing feed revision or invalidating replay', async () => {
  await online();
  expect(controller.getSnapshot().kudosByActivity[A]).toEqual({ summary: { count: 0, givenByMe: false }, pending: false, error: null });
  const replay = deferred<typeof artifact>(); api.getReplay.mockReturnValueOnce(replay.promise);
  const reading = controller.getReplay(A, flight().artifact);
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  const revision = controller.getSnapshot().revision;
  const writing = controller.setKudos(A, true);
  expect(controller.getSnapshot().kudosByActivity[A]).toMatchObject({ pending: true, summary: { count: 0, givenByMe: false } });
  await expect(controller.setKudos(A, true)).rejects.toMatchObject({ code: 'busy' });
  expect(api.setKudos).toHaveBeenCalledTimes(1);
  result.resolve({ activityId: A, count: 1, givenByMe: true }); await writing;
  expect(controller.getSnapshot().kudosByActivity[A]).toEqual({ summary: { count: 1, givenByMe: true }, pending: false, error: null });
  expect(controller.getSnapshot().items[0].kudos).toEqual({ count: 1, givenByMe: true });
  expect(controller.getSnapshot().revision).toBe(revision);
  replay.resolve(artifact); await expect(reading).resolves.toEqual(artifact);
});

it('allows independent flights to react concurrently and rejects known self-kudos without revoking the flight', async () => {
  await online();
  api.getDetail.mockResolvedValueOnce({ ...flight(C), author: { userId: A, displayName: 'Me' } });
  await controller.getDetail(C);
  await expect(controller.setKudos(C, true)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(api.setKudos).not.toHaveBeenCalled();
  expect(controller.getSnapshot().kudosByActivity[C]).toBeDefined();
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  const writing = controller.setKudos(A, true);
  await controller.setKudos(G, true);
  expect(controller.getSnapshot().kudosByActivity[G]).toMatchObject({ summary: { count: 1, givenByMe: true } });
  result.resolve({ activityId: A, count: 1, givenByMe: true }); await writing;
});

it.each(['before', 'during'] as const)('ignores a feed count read %s a later confirmed mutation', async ordering => {
  await online();
  const page = deferred<FeedPage>(); api.getFeed.mockReturnValueOnce(page.promise);
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  let reading!: Promise<void>; let writing!: Promise<KudosResult>;
  if (ordering === 'before') { reading = controller.refresh(); writing = controller.setKudos(A, true); }
  else { writing = controller.setKudos(A, true); reading = controller.refresh(); }
  result.resolve({ activityId: A, count: 7, givenByMe: true }); await writing;
  page.resolve({ items: [flight()], nextCursor: null }); await reading;
  expect(controller.getSnapshot().items[0].kudos).toEqual({ count: 7, givenByMe: true });
  expect(controller.getSnapshot().kudosByActivity[A].summary).toEqual({ count: 7, givenByMe: true });
});

it('returns current shared counts from an old detail read while accepting a fresh later summary', async () => {
  await online();
  const detail = deferred<ReturnType<typeof flight>>(); api.getDetail.mockReturnValueOnce(detail.promise);
  const reading = controller.getDetail(A); await controller.setKudos(A, true);
  detail.resolve(flight());
  expect((await reading).kudos).toEqual({ count: 1, givenByMe: true });
  api.getDetail.mockResolvedValueOnce({ ...flight(), kudos: { count: 4, givenByMe: true } });
  await controller.getDetail(A);
  expect(controller.getSnapshot().kudosByActivity[A].summary).toEqual({ count: 4, givenByMe: true });
});

it('seeds supporter counts but rejects a roster read that crosses a reaction mutation', async () => {
  await online();
  await controller.getKudos(C, null);
  expect(controller.getSnapshot().kudosByActivity[C]).toEqual({ summary: { count: 1, givenByMe: false }, pending: false, error: null });
  const page = deferred<KudosPage>(); api.getKudos.mockReturnValueOnce(page.promise);
  const reading = controller.getKudos(A, null); await controller.setKudos(A, true);
  page.resolve({ activityId: A, count: 0, givenByMe: false, items: [], nextCursor: null });
  await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().kudosByActivity[A]).toMatchObject({ summary: { count: 1, givenByMe: true }, error: null });
});

it('does not let a slow first roster read replace a later confirmed roster count', async () => {
  await online();
  const page = deferred<KudosPage>(); api.getKudos.mockReturnValueOnce(page.promise);
  const older = controller.getKudos(A, null);
  api.getKudos.mockResolvedValueOnce({ activityId: A, count: 4, givenByMe: false, items: [], nextCursor: null });
  await controller.getKudos(A, null);
  page.resolve({ activityId: A, count: 1, givenByMe: false, items: [{ id: C, displayName: 'Pilot C' }], nextCursor: null });
  await expect(older).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().kudosByActivity[A].summary?.count).toBe(4);
});

it.each(['signout', 'switch', 'background', 'offline', 'friendship'] as const)('clears kudos and fences pending writes and names on %s', async action => {
  await online();
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  const page = deferred<KudosPage>(); api.getKudos.mockReturnValueOnce(page.promise);
  const writing = controller.setKudos(A, true); const reading = controller.getKudos(A, null);
  const signal = api.setKudos.mock.calls.at(-1)![2];
  if (action === 'signout' || action === 'switch') {
    auth = { ...auth, status: action === 'signout' ? 'signed_out' : 'signed_in', userId: action === 'signout' ? null : B };
    controller.syncIdentity();
  } else if (action === 'friendship') controller.connectionsChanged();
  else controller.setEnvironment(action === 'offline' ? { online: false } : { foreground: false });
  expect(controller.getSnapshot().kudosByActivity).toEqual({}); expect(signal.aborted).toBe(true);
  result.resolve({ activityId: A, count: 1, givenByMe: true });
  page.resolve({ activityId: A, count: 1, givenByMe: true, items: [{ id: C, displayName: 'Pilot C' }], nextCursor: null });
  await expect(writing).rejects.toMatchObject({ code: 'stale' }); await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().kudosByActivity[A]?.summary?.givenByMe).not.toBe(true);
});

it('checks direct auth before identity effects can accept a late reaction', async () => {
  await online();
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  const writing = controller.setKudos(A, true);
  auth = { ...auth, userId: B };
  result.resolve({ activityId: A, count: 1, givenByMe: true });
  await expect(writing).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().kudosByActivity[A].summary).toEqual({ count: 0, givenByMe: false });
});

it.each(['request_failed', 'unsupported'] as const)('preserves the flight on a %s write failure and distinguishes unavailable kudos', async code => {
  await online(); const revision = controller.getSnapshot().revision;
  api.setKudos.mockRejectedValueOnce(new SocialError(code, 'Try later.'));
  await expect(controller.setKudos(A, true)).rejects.toMatchObject({ code });
  expect(controller.getSnapshot().kudosByActivity[A]).toEqual({ summary: code === 'unsupported' ? null : { count: 0, givenByMe: false }, pending: false, error: 'Try later.' });
  expect(controller.getSnapshot().items).toHaveLength(1); expect(controller.getSnapshot().revision).toBe(revision);
  await controller.setKudos(A, true);
  expect(controller.getSnapshot().kudosByActivity[A]).toMatchObject({ summary: { count: 1, givenByMe: true }, error: null });
});

it('keeps a legacy flight readable when the kudos endpoint is unsupported', async () => {
  api.getFeed.mockResolvedValueOnce({ items: [{ ...flight(), kudos: null }], nextCursor: null }); await online();
  api.getKudos.mockRejectedValueOnce(new SocialError('unsupported', 'Kudos is unavailable on this server.'));
  await expect(controller.getKudos(A, null)).rejects.toMatchObject({ code: 'unsupported' });
  expect(controller.getSnapshot().items).toHaveLength(1);
  expect(controller.getSnapshot().kudosByActivity[A]).toMatchObject({ summary: null, error: 'Kudos is unavailable on this server.' });
});

it('disables stale count information when the supporter endpoint is unsupported without revoking the flight', async () => {
  await online();
  api.getKudos.mockRejectedValueOnce(new SocialError('unsupported', 'Kudos is unavailable on this server.'));
  await expect(controller.getKudos(A, null)).rejects.toMatchObject({ code: 'unsupported' });
  expect(controller.getSnapshot().items).toHaveLength(1);
  expect(controller.getSnapshot().items[0].kudos).toBeNull();
  expect(controller.getSnapshot().kudosByActivity[A].summary).toBeNull();
});

it('rejects supporter names received while a mutation is still pending', async () => {
  await online();
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  const writing = controller.setKudos(A, true);
  await expect(controller.getKudos(A, null)).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().kudosByActivity[A]).toMatchObject({ pending: true, summary: { count: 0, givenByMe: false }, error: null });
  result.resolve({ activityId: A, count: 1, givenByMe: true }); await writing;
});

it.each(['list', 'detail', 'mutation'] as const)('removes revoked kudos and fences old feed/list reads after a denied %s', async denial => {
  await online(); const revision = controller.getSnapshot().revision;
  const page = deferred<FeedPage>(); api.getFeed.mockReturnValueOnce(page.promise);
  const refreshing = controller.refresh();
  const names = deferred<KudosPage>(); api.getKudos.mockReturnValueOnce(names.promise);
  const reading = controller.getKudos(A, null);
  const denied = new SocialError('unavailable', 'No longer shared');
  if (denial === 'list') { api.getKudos.mockRejectedValueOnce(denied); await expect(controller.getKudos(A, null)).rejects.toMatchObject({ code: 'unavailable' }); }
  if (denial === 'detail') { api.getDetail.mockRejectedValueOnce(denied); await expect(controller.getDetail(A)).rejects.toMatchObject({ code: 'unavailable' }); }
  if (denial === 'mutation') { api.setKudos.mockRejectedValueOnce(denied); await expect(controller.setKudos(A, true)).rejects.toMatchObject({ code: 'unavailable' }); }
  expect(controller.getSnapshot().kudosByActivity[A]).toBeUndefined();
  page.resolve({ items: [flight()], nextCursor: null }); await refreshing;
  names.resolve({ activityId: A, count: 4, givenByMe: false, items: [{ id: C, displayName: 'Pilot C' }], nextCursor: null });
  await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(controller.getSnapshot().items).toEqual([]); expect(controller.getSnapshot().kudosByActivity[A]).toBeUndefined();
  expect(controller.getSnapshot().revision).toBe(revision + 1); // Only the explicit refresh changed it.
});

it('cancels in-flight reactions and rejects new writes while recording', async () => {
  await online();
  const result = deferred<KudosResult>(); api.setKudos.mockReturnValueOnce(result.promise);
  const writing = controller.setKudos(A, true); controller.setEnvironment({ recorderBusy: true });
  await expect(controller.setKudos(A, false)).rejects.toMatchObject({ code: 'busy' });
  result.resolve({ activityId: A, count: 1, givenByMe: true });
  await expect(writing).rejects.toMatchObject({ code: 'stale' });
  expect(api.setKudos).toHaveBeenCalledTimes(1); expect(controller.getSnapshot().kudosByActivity).toEqual({});
});

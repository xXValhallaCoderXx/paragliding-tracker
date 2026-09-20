/** @jest-environment node
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { configureStore } from '@reduxjs/toolkit';
import { flightRepository } from '@/recorder/flight-repository';
import { LIVE_MAP_WINDOW_MS, type CapturedMapFix, type LiveMapPage, type LiveMapRead } from '@/lib/live/types';
import { dataApi } from '../endpoints';

jest.mock('@/recorder/flight-repository', () => ({
  flightRepository: { getLiveMapPage: jest.fn() },
  appSettingsRepository: {}, pilotProfileRepository: {},
}));
jest.mock('@/sites/site-service', () => ({ fetchNearbySites: jest.fn(), searchSitesByName: jest.fn() }));

const load = jest.mocked(flightRepository.getLiveMapPage);
function makeStore() {
  return configureStore({ reducer: { [dataApi.reducerPath]: dataApi.reducer }, middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(dataApi.middleware) });
}
const stores: ReturnType<typeof makeStore>[] = [];
function createStore() {
  const store = makeStore();
  stores.push(store);
  return store;
}
const fix = (sessionId = 's', sequence = 1, sourceTimestamp = Date.now()): CapturedMapFix => ({
  sessionId, sequence, sourceTimestamp, receiptTimestamp: sourceTimestamp, latitude: 46, longitude: 8,
  horizontalAccuracy: 5, mocked: false,
});
function page(input: LiveMapRead, extra: Partial<LiveMapPage> = {}): LiveMapPage {
  const position = fix(input.sessionId, input.cursor?.sequence ?? 1);
  return { sessionId: input.sessionId, mode: input.cursor ? 'delta' : 'bootstrap', rows: [position], position,
    cursor: { sessionId: input.sessionId, sequence: position.sequence }, highWatermark: position.sequence, hasMore: false, ...extra };
}
const flush = () => jest.advanceTimersByTimeAsync(0);
const selected = (store: ReturnType<typeof createStore>, sessionId = 's') => dataApi.endpoints.getLiveMap.select(sessionId)(store.getState());
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(1_000_000); jest.clearAllMocks();
  load.mockImplementation(async (input) => page(input));
});
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispatch(dataApi.util.resetApiState());
  await flush(); jest.clearAllTimers(); jest.useRealTimers();
});

it('shares one visible session, polls at most once a second, and releases data and timers when hidden', async () => {
  const store = createStore();
  expect(load).not.toHaveBeenCalled();
  const first = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s'));
  const second = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s'));
  await first; await second; await flush();
  expect(load).toHaveBeenCalledTimes(1);
  expect(selected(store).data?.position?.sessionId).toBe('s');
  expect(selected(store).data?.observedAt).toBe(1_000_000);
  await jest.advanceTimersByTimeAsync(999); expect(load).toHaveBeenCalledTimes(1);
  expect(selected(store).data?.observedAt).toBe(1_000_000);
  await jest.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(2);
  expect(selected(store).data?.observedAt).toBe(1_001_000);
  first.unsubscribe(); await flush(); expect(selected(store).data).toBeDefined();
  second.unsubscribe(); await flush();
  expect(selected(store).status).toBe('uninitialized');
  await jest.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(2);
  expect(store.getState().api.queries).toEqual({});
});

it('bounds an oversized backlog by rebootstrap and keeps the scalar last-known point beyond the trail', async () => {
  const store = createStore();
  const visible = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s')); await visible; await flush();
  const marker = fix('s', 1, Date.now() - LIVE_MAP_WINDOW_MS - 1);
  load.mockImplementationOnce(async (input) => page(input, { hasMore: true, cursor: { sessionId: 's', sequence: 1000 }, highWatermark: 2200 }))
    .mockImplementationOnce(async (input) => page(input, {
      rows: Array.from({ length: 999 }, (_, index) => ({ ...fix('s', 1202 + index), mocked: true })), position: marker,
      cursor: { sessionId: 's', sequence: 2200 }, highWatermark: 2200,
    }));
  await jest.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(3);
  expect(load.mock.calls[1][0].cursor).toEqual({ sessionId: 's', sequence: 1 });
  expect(load.mock.calls[2][0].cursor).toBeUndefined();
  expect(selected(store).data).toMatchObject({ position: marker, cursor: { sequence: 2200 } });
  expect(selected(store).data?.rows).toHaveLength(999);
});

it('serializes slow reads and ignores a late response without starting its overflow read after hiding', async () => {
  let finish!: (value: LiveMapPage) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const store = createStore();
  const visible = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s')); await visible; await flush();
  await jest.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(1);
  visible.unsubscribe(); await flush();
  finish(page({ sessionId: 's', now: Date.now() }, { hasMore: true })); await flush();
  expect(load).toHaveBeenCalledTimes(1);
  expect(store.getState().api.queries).toEqual({});
});

it('preserves the real last position time on read failure, expires the trail, and recovers on a later read', async () => {
  const store = createStore();
  const visible = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s')); await visible; await flush();
  const original = selected(store).data!.position;
  load.mockRejectedValueOnce(new Error('Storage busy'));
  jest.setSystemTime(Date.now() + LIVE_MAP_WINDOW_MS + 1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(selected(store).data).toMatchObject({ rows: [], position: original, observedAt: Date.now(), readError: 'Storage busy' });
  await jest.advanceTimersByTimeAsync(1000);
  expect(selected(store).data?.readError).toBeNull();
  expect(selected(store).data?.position?.sourceTimestamp).toBe(Date.now());
});

it('bootstraps a new session and removes the previous cache, ignoring its late read', async () => {
  let finish!: (value: LiveMapPage) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const store = createStore();
  const old = store.dispatch(dataApi.endpoints.getLiveMap.initiate('old')); await old; await flush();
  const current = store.dispatch(dataApi.endpoints.getLiveMap.initiate('new')); await current; await flush();
  finish(page({ sessionId: 'old', now: Date.now() })); await flush();
  expect(selected(store, 'old').status).toBe('uninitialized');
  expect(selected(store, 'new').data?.position?.sessionId).toBe('new');
  expect(Object.keys(store.getState().api.queries)).toEqual(['live-map:new']);
  await jest.advanceTimersByTimeAsync(1000);
  expect(load.mock.calls.map(([input]) => input.sessionId)).toEqual(['old', 'new', 'new']);
});

it('reopening the same session discards its old cursor and bootstraps the latest bounded data', async () => {
  const store = createStore();
  const visible = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s')); await visible; await flush();
  await jest.advanceTimersByTimeAsync(1000);
  visible.unsubscribe(); await flush();
  const reopened = store.dispatch(dataApi.endpoints.getLiveMap.initiate('s')); await reopened; await flush();
  expect(load.mock.calls[1][0].cursor).toEqual({ sessionId: 's', sequence: 1 });
  expect(load.mock.calls[2][0].cursor).toBeUndefined();
});

/** @jest-environment node
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { configureStore } from '@reduxjs/toolkit';
import { flightRepository } from '@/recorder/flight-repository';
import { dataApi } from '../endpoints';

jest.mock('@/recorder/flight-repository', () => ({
  flightRepository: { getReplay: jest.fn(), updateFlight: jest.fn(), deleteFlight: jest.fn() },
  appSettingsRepository: {}, pilotProfileRepository: {},
}));
jest.mock('@/sites/site-service', () => ({ fetchNearbySites: jest.fn(), searchSitesByName: jest.fn() }));

function createStore() {
  return configureStore({ reducer: { [dataApi.reducerPath]: dataApi.reducer }, middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(dataApi.middleware) });
}
const tick = () => jest.advanceTimersByTimeAsync(50);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (flightRepository.getReplay as jest.Mock).mockResolvedValue({ kind: 'unavailable', reason: 'insufficient_fixes' });
  (flightRepository.updateFlight as jest.Mock).mockResolvedValue({ id: 'f' });
  (flightRepository.deleteFlight as jest.Mock).mockResolvedValue(undefined);
});
afterEach(async () => { await jest.runOnlyPendingTimersAsync(); jest.useRealTimers(); });
it('loads on subscription, shares it, and releases the cache after the last subscriber leaves', async () => {
  const store = createStore();
  expect(flightRepository.getReplay).not.toHaveBeenCalled();
  const first = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f'));
  const second = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f'));
  await first; await second;
  expect(flightRepository.getReplay).toHaveBeenCalledTimes(1);
  first.unsubscribe(); await tick();
  expect(dataApi.endpoints.getFlightReplay.select('f')(store.getState()).data).toBeDefined();
  second.unsubscribe(); await tick();
  expect(dataApi.endpoints.getFlightReplay.select('f')(store.getState()).status).toBe('uninitialized');
  store.dispatch(dataApi.util.resetApiState());
});
it('metadata mutations do not reload GPS samples', async () => {
  const store = createStore();
  const replay = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f')); await replay;
  await store.dispatch(dataApi.endpoints.updateFlight.initiate({ flightId: 'f', patch: { title: 'New title' } }));
  await tick(); expect(flightRepository.getReplay).toHaveBeenCalledTimes(1);
  replay.unsubscribe(); store.dispatch(dataApi.util.resetApiState());
});
it('deletion invalidates the selected flight, without refetching another flight', async () => {
  const store = createStore();
  const replay = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f'));
  const other = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('other'));
  await replay; await other;
  (flightRepository.getReplay as jest.Mock).mockResolvedValue({ kind: 'unavailable', reason: 'not_found' });
  await store.dispatch(dataApi.endpoints.deleteFlight.initiate('f')); await tick();
  expect(flightRepository.getReplay).toHaveBeenCalledTimes(3);
  expect(dataApi.endpoints.getFlightReplay.select('f')(store.getState()).data).toMatchObject({ reason: 'not_found' });
  expect(dataApi.endpoints.getFlightReplay.select('other')(store.getState()).data).toMatchObject({ reason: 'insufficient_fixes' });
  replay.unsubscribe(); other.unsubscribe(); store.dispatch(dataApi.util.resetApiState());
});
it('releases a response that arrives after the screen unsubscribes', async () => {
  const store = createStore();
  let finish!: (value: unknown) => void;
  (flightRepository.getReplay as jest.Mock).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const replay = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f'));
  replay.unsubscribe(); finish({ kind: 'unavailable', reason: 'insufficient_fixes' });
  await replay; await tick();
  expect(dataApi.endpoints.getFlightReplay.select('f')(store.getState()).status).toBe('uninitialized');
  store.dispatch(dataApi.util.resetApiState());
});
it('a failed deletion keeps replay available without a GPS reload', async () => {
  const store = createStore();
  const replay = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f')); await replay;
  (flightRepository.deleteFlight as jest.Mock).mockRejectedValue(new Error('Flight is open'));
  await store.dispatch(dataApi.endpoints.deleteFlight.initiate('f')); await tick();
  expect(flightRepository.getReplay).toHaveBeenCalledTimes(1);
  expect(dataApi.endpoints.getFlightReplay.select('f')(store.getState()).data).toBeDefined();
  replay.unsubscribe(); store.dispatch(dataApi.util.resetApiState());
});
it('drops all raw data from the Redux cache for a twelve-hour payload after leaving', async () => {
  const store = createStore();
  const points = Array.from({ length: 43_201 }, (_, i) => ({ timestamp: i * 1000, latitude: 46, longitude: 8, altitude: 1000, speed: 10 }));
  (flightRepository.getReplay as jest.Mock).mockResolvedValue({ kind: 'available', flightId: 'f', bounds: { startedAt: 0, endedAt: 43_200_000 }, partial: false, points });
  const replay = store.dispatch(dataApi.endpoints.getFlightReplay.initiate('f')); await replay;
  expect(dataApi.endpoints.getFlightReplay.select('f')(store.getState()).data).toHaveProperty('points.length', 43_201);
  replay.unsubscribe(); await tick();
  expect(store.getState().api.queries).toEqual({});
  store.dispatch(dataApi.util.resetApiState());
});

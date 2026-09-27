import * as Location from 'expo-location';
import { readCoarsePosition } from '../current-position';
jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(), watchPositionAsync: jest.fn(), Accuracy: { Balanced: 3 },
}));
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers();
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as Location.LocationPermissionResponse);
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
});
afterEach(() => jest.useRealTimers());
it('does not start GPS after cancellation while checking services', async () => {
  const abort = new AbortController(); let finish!: (value: boolean) => void;
  jest.mocked(Location.hasServicesEnabledAsync).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const work = readCoarsePosition(8000, abort.signal); abort.abort(); finish(true);
  await expect(work).resolves.toBeNull(); expect(Location.watchPositionAsync).not.toHaveBeenCalled();
});
it('removes a location subscription that arrives after dismissal', async () => {
  const abort = new AbortController(), remove = jest.fn(); let finish!: (value: Location.LocationSubscription) => void;
  jest.mocked(Location.watchPositionAsync).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const work = readCoarsePosition(8000, abort.signal);
  for (let n = 0; n < 12; n++) await Promise.resolve();
  expect(Location.watchPositionAsync).toHaveBeenCalled(); abort.abort();
  await expect(work).resolves.toBeNull(); finish({ remove }); await Promise.resolve();
  expect(remove).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

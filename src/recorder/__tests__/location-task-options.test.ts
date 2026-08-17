import { RECORDER_CONFIG } from '../config';
import { locationTaskOptionsMatch } from '../location-task-options';

// Location.Accuracy.BestForNavigation. Hardcoded so this suite stays free of expo-location.
const BEST_FOR_NAVIGATION = 6;

const asRequested = {
  accuracy: BEST_FOR_NAVIGATION,
  timeInterval: RECORDER_CONFIG.androidTimeIntervalMs,
  distanceInterval: RECORDER_CONFIG.distanceIntervalMetres,
  deferredUpdatesDistance: RECORDER_CONFIG.deferredUpdatesDistanceMetres,
  deferredUpdatesInterval: RECORDER_CONFIG.deferredUpdatesIntervalMs,
};

describe('locationTaskOptionsMatch', () => {
  it('matches options reported back in full', () => {
    expect(locationTaskOptionsMatch(asRequested, BEST_FOR_NAVIGATION)).toBe(true);
  });

  it('matches the shape Android actually returns for a task registered in this process', () => {
    // TaskManagerUtils.mapToBundle has no Long or Float branch, so timeInterval (Long?) and the
    // deferredUpdates* fields (Float?) never survive the round trip. Requiring them made this
    // return false forever, which pinned capture health to 'stale' and had the supervisor
    // restarting a working GPS task every 5 seconds for the whole flight.
    expect(
      locationTaskOptionsMatch(
        { accuracy: BEST_FOR_NAVIGATION, distanceInterval: 0, mayShowUserSettingsDialog: true },
        BEST_FOR_NAVIGATION,
      ),
    ).toBe(true);
  });

  it('still rejects a task running at the wrong accuracy', () => {
    expect(locationTaskOptionsMatch({ ...asRequested, accuracy: 3 }, BEST_FOR_NAVIGATION)).toBe(
      false,
    );
  });

  it('still rejects a reported field that genuinely disagrees', () => {
    expect(
      locationTaskOptionsMatch({ ...asRequested, distanceInterval: 25 }, BEST_FOR_NAVIGATION),
    ).toBe(false);
  });

  it('rejects missing or non-object options', () => {
    expect(locationTaskOptionsMatch(null, BEST_FOR_NAVIGATION)).toBe(false);
    expect(locationTaskOptionsMatch(undefined, BEST_FOR_NAVIGATION)).toBe(false);
    expect(locationTaskOptionsMatch('options', BEST_FOR_NAVIGATION)).toBe(false);
  });
});

import { RECORDER_CONFIG } from './config';

/**
 * Platform-free comparison of the options the task registry reports against what we asked for.
 * Kept out of `recorder-service.native.ts` so it can be tested in Node, following the same
 * convention as `repository-core.ts` and `flight-repository-core.ts`.
 *
 * Android silently drops options on the way back out. `TaskManagerUtils.mapToBundle` has
 * branches for Double, Integer, String, Boolean, List and Map — but none for `Long` or `Float`.
 * In expo-location's `LocationArguments`, `timeInterval` is `Long?` and `deferredUpdatesDistance`
 * / `deferredUpdatesInterval` / `deferredUpdatesTimeout` are `Float?`, so all four are absent
 * from `getTaskOptionsAsync` for a task registered in this process. (They reappear after a cold
 * restart, because `TaskService.restoreTasks` rebuilds them from SharedPreferences JSON as
 * Integer/Double, which the Bundle conversion does keep — so this used to fail on a freshly
 * armed flight and pass after a process restart.)
 *
 * Comparing those fields with `===` therefore returned false forever, which pinned capture
 * health to 'stale' and had the supervisor tearing down and restarting a perfectly healthy GPS
 * task every 5 seconds for the whole flight.
 *
 * So a field the platform does not report is treated as "not reported", not "mismatched". Only
 * fields actually present are allowed to fail the comparison. `accuracy` is an `Int`, always
 * survives, and stays a strict check — it is the meaningful assertion left here.
 */
export function locationTaskOptionsMatch(options: unknown, expectedAccuracy: number): boolean {
  if (!options || typeof options !== 'object') return false;
  const reported = options as Record<string, unknown>;
  const reportedMatches = (actual: unknown, expected: number): boolean =>
    actual === undefined || actual === expected;
  return (
    reported.accuracy === expectedAccuracy &&
    reportedMatches(reported.timeInterval, RECORDER_CONFIG.androidTimeIntervalMs) &&
    reportedMatches(reported.distanceInterval, RECORDER_CONFIG.distanceIntervalMetres) &&
    reportedMatches(
      reported.deferredUpdatesDistance,
      RECORDER_CONFIG.deferredUpdatesDistanceMetres,
    ) &&
    reportedMatches(reported.deferredUpdatesInterval, RECORDER_CONFIG.deferredUpdatesIntervalMs)
  );
}

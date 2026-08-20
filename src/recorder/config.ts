export const LOCATION_TASK_NAME = 'xc-recorder-location-v1';

export const RECORDER_CONFIG = Object.freeze({
  schemaVersion: 6,
  igcArtifactVersion: 3,
  diagnosticsArtifactVersion: 2,
  accuracy: 'BestForNavigation',
  androidTimeIntervalMs: 1000,
  distanceIntervalMetres: 0,
  deferredUpdatesDistanceMetres: 0,
  deferredUpdatesIntervalMs: 0,
  deferredUpdatesTimeoutMs: 0,
  barometerIntervalMs: 1000,
  snapshotPollIntervalMs: 1000,
  supervisorIntervalMs: 5_000,
  powerPollIntervalMs: 60_000,
  gpsStaleAfterMs: 15_000,
  automaticRecoveryMaxGapMs: 15 * 60_000,
  reacquisitionTimeoutMs: 20_000,
  reacquisitionPollIntervalMs: 500,
  reacquisitionMaxCachedFixAgeMs: 5_000,
  killServiceOnDestroy: false,
});

export const TEST_BUILD_WARNING =
  'TEST BUILD — do not use as your sole flight recorder';

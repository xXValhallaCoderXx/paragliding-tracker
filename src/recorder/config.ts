export const LOCATION_TASK_NAME = 'xc-recorder-location-v1';

export const RECORDER_CONFIG = Object.freeze({
  schemaVersion: 1,
  igcArtifactVersion: 1,
  diagnosticsArtifactVersion: 1,
  accuracy: 'BestForNavigation',
  androidTimeIntervalMs: 1000,
  distanceIntervalMetres: 0,
  deferredUpdatesDistanceMetres: 0,
  deferredUpdatesIntervalMs: 0,
  deferredUpdatesTimeoutMs: 0,
  barometerIntervalMs: 1000,
  snapshotPollIntervalMs: 1000,
  powerPollIntervalMs: 60_000,
  killServiceOnDestroy: false,
});

export const TEST_BUILD_WARNING =
  'TEST BUILD — do not use as your sole flight recorder';

import {
  RecorderError,
  type ArtifactService,
  type CaptureService,
  type ExportArtifact,
  type RecorderCapabilities,
  type RecorderService,
  type RecorderSnapshot,
} from './types';

const capabilities: RecorderCapabilities = {
  platform: 'web',
  supported: false,
  taskManagerAvailable: false,
  locationServicesEnabled: false,
  gpsAvailable: null,
  preciseLocation: false,
  pressureAvailable: false,
  batteryAvailable: false,
  sharingAvailable: false,
  foregroundPermission: 'unknown',
  backgroundPermission: 'unknown',
};

const snapshot: RecorderSnapshot = {
  capturedAt: 0,
  state: 'idle',
  flightId: null,
  sessionId: null,
  startedAt: null,
  endedAt: null,
  lastFixAt: null,
  lastFixReceivedAt: null,
  lastLocationCallbackAt: null,
  captureHealth: 'inactive',
  durationMs: 0,
  fixCount: 0,
  pressureCount: 0,
  gpsAltitude: null,
  speed: null,
  horizontalAccuracy: null,
  pressure: null,
  batteryLevel: null,
  lowPowerMode: null,
  batteryOptimizationEnabled: null,
  taskRegistered: false,
  capabilities,
  lastError: null,
};

function unsupported(): never {
  throw new RecorderError(
    'unsupported_platform',
    'Flight recording is only supported on Android and iOS development builds.',
  );
}

export const recorderService: RecorderService = {
  getCapabilities: async () => capabilities,
  arm: async () => unsupported(),
  stop: async () => undefined,
  recover: async () => snapshot,
  resume: async () => unsupported(),
  finalizeInterrupted: async () => unsupported(),
  exportIgc: async () => unsupported(),
  exportDiagnostics: async () => unsupported(),
  shareArtifact: async (_artifact: ExportArtifact) => unsupported(),
  subscribe: (listener) => {
    listener(snapshot);
    return () => undefined;
  },
};

export const captureService: CaptureService = recorderService;
export const artifactService: ArtifactService = recorderService;

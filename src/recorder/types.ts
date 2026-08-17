export type RecorderState =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'stopping'
  | 'completed'
  | 'interrupted';

export type RecorderPermission = 'unknown' | 'granted' | 'denied';

export type CaptureHealth =
  | 'inactive'
  | 'starting'
  | 'healthy'
  | 'stale'
  | 'recovering'
  | 'failed';

export type CompletionReason = 'stopped' | 'interrupted_finalized';

export type SessionRecoveryKind = 'automatic' | 'manual';

export type ExportKind = 'igc' | 'diagnostics';

export type FlightStatus = 'recording' | 'processing' | 'completed' | 'partial';

export type TrackQuality = 'healthy' | 'gaps' | 'partial' | 'no_track';

export interface PowerReading {
  batteryLevel: number | null;
  batteryState: number | null;
  lowPowerMode: boolean | null;
  batteryOptimizationEnabled: boolean | null;
  recordedAt: number;
}

export interface RecorderCapabilities {
  platform: string;
  supported: boolean;
  taskManagerAvailable: boolean;
  locationServicesEnabled: boolean;
  gpsAvailable: boolean | null;
  preciseLocation: boolean;
  pressureAvailable: boolean;
  batteryAvailable: boolean;
  sharingAvailable: boolean;
  foregroundPermission: RecorderPermission;
  backgroundPermission: RecorderPermission;
}

export interface RecorderSnapshot {
  capturedAt: number;
  state: RecorderState;
  flightId: string | null;
  sessionId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  lastFixAt: number | null;
  lastFixReceivedAt: number | null;
  lastLocationCallbackAt: number | null;
  captureHealth: CaptureHealth;
  durationMs: number;
  fixCount: number;
  pressureCount: number;
  gpsAltitude: number | null;
  speed: number | null;
  horizontalAccuracy: number | null;
  pressure: number | null;
  batteryLevel: number | null;
  lowPowerMode: boolean | null;
  batteryOptimizationEnabled: boolean | null;
  taskRegistered: boolean;
  capabilities: RecorderCapabilities;
  lastError: RecorderFailure | null;
}

export type RecorderFailureCode =
  | 'unsupported_platform'
  | 'task_manager_unavailable'
  | 'location_disabled'
  | 'foreground_permission_denied'
  | 'background_permission_denied'
  | 'invalid_transition'
  | 'session_not_found'
  | 'share_unavailable'
  | 'task_error'
  | 'storage_error'
  | 'export_error';

export interface RecorderFailure {
  code: RecorderFailureCode;
  message: string;
  occurredAt: number;
}

export class RecorderError extends Error {
  readonly code: RecorderFailureCode;

  constructor(code: RecorderFailureCode, message: string) {
    super(message);
    this.name = 'RecorderError';
    this.code = code;
  }
}

export interface ExportArtifact {
  sessionId: string;
  kind: ExportKind;
  uri: string;
  sha256: string;
  byteCount: number;
  eligibleFixCount: number;
}

export interface CaptureService {
  getCapabilities(): Promise<RecorderCapabilities>;
  arm(): Promise<{ flightId: string; sessionId: string }>;
  stop(): Promise<void>;
  recover(): Promise<RecorderSnapshot>;
  resume(sessionId: string): Promise<void>;
  finalizeInterrupted(sessionId: string): Promise<void>;
  subscribe(listener: (snapshot: RecorderSnapshot) => void): () => void;
}

export interface ArtifactService {
  exportIgc(sessionId: string): Promise<ExportArtifact>;
  exportDiagnostics(sessionId: string): Promise<ExportArtifact>;
  shareArtifact(artifact: ExportArtifact): Promise<void>;
}

export interface RecorderService extends CaptureService, ArtifactService {}

export interface SessionRecord {
  id: string;
  status: 'recording' | 'interrupted' | 'completed';
  completionReason: CompletionReason | null;
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
  lastFixAt: number | null;
  lastLocationCallbackAt: number | null;
  manualStopAt: number | null;
  lastPressureAt: number | null;
  locationSequence: number;
  pressureSequence: number;
  platform: string;
  deviceMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
  startPower: PowerReading;
  endPower: PowerReading | null;
}

export interface PendingSessionStop {
  sessionId: string;
  stoppedAt: number;
}

export interface BeginSessionRecoveryAttemptInput {
  attemptId: string;
  sessionId: string;
  kind: SessionRecoveryKind;
  attemptStartedAt: number;
  deadlineAt: number;
  maximumCachedFixAgeMs: number;
}

export interface SessionRecoveryAttempt extends BeginSessionRecoveryAttemptInput {
  baselineLocationSequence: number;
}

export interface RecoveryProvingFix {
  sequence: number;
  sourceTimestamp: number;
  receiptTimestamp: number;
}

export interface PendingSessionRecoveryAttempt extends SessionRecoveryAttempt {
  provingFix: RecoveryProvingFix | null;
}

export interface SessionRecoveryProof extends SessionRecoveryAttempt {
  provingFix: RecoveryProvingFix;
  confirmedAt: number;
}

export interface FlightRecord {
  id: string;
  recordingSessionId: string;
  status: FlightStatus;
  startedAt: number;
  endedAt: number | null;
  timezoneOffsetMinutes: number | null;
  title: string | null;
  site: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FlightMetricsRecord {
  flightId: string;
  algorithmVersion: number;
  durationMs: number;
  trackDistanceMetres: number;
  minGpsAltitude: number | null;
  maxGpsAltitude: number | null;
  maxGroundSpeed: number | null;
  fixCount: number;
  medianSourceGapMs: number | null;
  p95SourceGapMs: number | null;
  maxSourceGapMs: number | null;
  quality: TrackQuality;
  computedAt: number;
}

export interface FlightSummary extends FlightRecord {
  sessionStatus: SessionRecord['status'];
  metrics: FlightMetricsRecord | null;
}

export interface FlightDetail extends FlightSummary {
  session: SessionRecord;
}

export interface FlightMetadataPatch {
  title?: string | null;
  site?: string | null;
  notes?: string | null;
}

export interface FlightRepository {
  listFlights(): Promise<FlightSummary[]>;
  getFlight(flightId: string): Promise<FlightDetail | null>;
  updateFlight(flightId: string, patch: FlightMetadataPatch): Promise<FlightDetail>;
  deleteFlight(flightId: string): Promise<void>;
}

export interface LocationFixRecord {
  sessionId: string;
  sequence: number;
  callbackId: string;
  batchIndex: number;
  sourceTimestamp: number;
  receiptTimestamp: number;
  latitude: number;
  longitude: number;
  gpsAltitude: number | null;
  verticalAccuracy: number | null;
  horizontalAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  mocked: boolean;
}

export interface PressureSampleRecord {
  sessionId: string;
  sequence: number;
  nativeTimestamp: number;
  receiptTimestamp: number;
  pressure: number;
  relativeAltitude: number | null;
}

export interface RecorderEventRecord {
  id: number;
  sessionId: string;
  type: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}

export interface SessionExportData {
  session: SessionRecord;
  locations: LocationFixRecord[];
  pressureSamples: PressureSampleRecord[];
  events: RecorderEventRecord[];
}

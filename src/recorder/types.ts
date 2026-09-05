import type { FlightReplay } from '../lib/replay/model';
import type { TrackSegments } from '../lib/track/types';

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
  /**
   * Asks for the location permissions the recorder needs, without arming anything.
   *
   * Deliberately non-throwing: first-run setup wants to show the pilot what they granted
   * and let them carry on either way, whereas `arm()` has to refuse. Returns the
   * capabilities as they stand afterwards.
   */
  requestLocationPermissions(): Promise<RecorderCapabilities>;
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

/**
 * Where a flight's site name came from.
 *
 * Which catalogue the site name came from, and therefore which licence it falls under —
 * ParaglidingEarth is CC BY-SA 3.0, OpenStreetMap is ODbL, and `manual` is the pilot's
 * own words, which carry neither. `null` means the flight is unnamed.
 *
 * The reader is the attribution line: crediting a source for a name the pilot typed
 * themselves would be a claim this app cannot substantiate.
 */
export type SiteSource = 'paraglidingearth' | 'osm' | 'manual';

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
  /** First export-eligible fix, denormalised at finalize so naming a launch needs no GPS read. */
  takeoffLatitude: number | null;
  takeoffLongitude: number | null;
  siteSource: SiteSource | null;
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
  /**
   * Where the site name came from. Set alongside `site`, never on its own — a provenance
   * with no name to describe would be meaningless.
   */
  siteSource?: SiteSource | null;
}

export interface FlightRepository {
  listFlights(): Promise<FlightSummary[]>;
  getFlight(flightId: string): Promise<FlightDetail | null>;
  updateFlight(flightId: string, patch: FlightMetadataPatch): Promise<FlightDetail>;
  deleteFlight(flightId: string): Promise<void>;
  /**
   * Every stored track, keyed by flight. Reads only — the logbook never derives, because
   * doing so would mean re-reading the fixes of every un-backfilled flight before the list
   * could paint.
   */
  listTracks(): Promise<Record<string, TrackSegments>>;
  /** One flight's track, derived and stored on a miss. */
  getTrack(flightId: string): Promise<TrackSegments>;
  /** Full timestamped GPS data, loaded only by the replay screen. */
  getReplay(flightId: string): Promise<FlightReplay>;
}

/**
 * The pilot's own identity, held locally in a single `pilot_profile` row.
 *
 * Deliberately independent of any account: it works offline and signed out, and
 * it is what fills the IGC HFPLTPILOTINCHARGE / HFGTYGLIDERTYPE / HFGIDGLIDERID
 * headers. Cloud backup mirrors it, but never owns it.
 */
/**
 * Whether the pilot has been through first-run setup.
 *
 * `skipped` is distinct from `done` on purpose: the logbook uses it to decide whether to
 * offer the "two things before you fly" checklist, which would be noise for someone who
 * completed setup and simply left a field blank.
 */
export type OnboardingState = 'pending' | 'done' | 'skipped';

export interface AppSettings {
  onboardingState: OnboardingState;
  onboardingCompletedAt: number | null;
  /** When the "not a certified flight recorder" notice was acknowledged. */
  disclaimerAckAt: number | null;
  updatedAt: number;
}

export interface AppSettingsPatch {
  onboardingState?: OnboardingState;
  onboardingCompletedAt?: number | null;
  disclaimerAckAt?: number | null;
}

export interface PilotProfile {
  pilotName: string | null;
  gliderType: string | null;
  /** The glider's own registration. Rides in HFGIDGLIDERID. */
  gliderId: string | null;
  /** The pilot's licence or federation number. Rides in HFCIDCOMPETITIONID. */
  registrationId: string | null;
  updatedAt: number;
  pushedUpdatedAt: number | null;
}

export interface PilotProfilePatch {
  pilotName?: string | null;
  gliderType?: string | null;
  gliderId?: string | null;
  registrationId?: string | null;
}

export interface PilotProfileRepository {
  getProfile(): Promise<PilotProfile>;
  updateProfile(patch: PilotProfilePatch): Promise<PilotProfile>;
}

/**
 * Device state that is not the pilot's data: whether they have been through setup, and
 * whether they have acknowledged the "not a certified flight recorder" notice. Never
 * synced, never exported.
 */
export interface AppSettingsRepository {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: AppSettingsPatch): Promise<AppSettings>;
}

/**
 * Which cloud account this device's logbook is bound to.
 *
 * There is deliberately no owner column on flights or sessions: this phone holds
 * one logbook, and signing out must never hide it. Ownership is a property of the
 * device's link to an account, not of each flight.
 */
export interface CloudLink {
  userId: string | null;
  linkedAt: number | null;
  flightsCursor: string | null;
  profileCursor: string | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  cloudOnlyFlightCount: number;
}

/** A completed flight that is due to be pushed, plus its sync bookkeeping. */
export interface FlightSyncCandidate extends FlightSummary {
  pushedUpdatedAt: number | null;
  igcSha256: string | null;
  igcObjectPath: string | null;
  attemptCount: number;
  nextAttemptAt: number;
}

/**
 * Tombstone for a locally deleted flight. Without it the next pull would
 * resurrect the flight from the server.
 */
export interface FlightDeletionRecord {
  flightId: string;
  recordingSessionId: string;
  deletedAt: number;
  attemptCount: number;
  nextAttemptAt: number;
  lastError: string | null;
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

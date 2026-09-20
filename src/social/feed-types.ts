import type { ReplayBounds, ReplayPoint } from '@/lib/replay/model';
import type { TrackSegments } from '@/lib/track/types';
import type { SiteSource, TrackQuality } from '@/recorder/types';

export interface SharingPreferences { enabled: boolean; generation: string | null }
export type PublicationMode = 'automatic' | 'manual';
export interface SharedReplayArtifactV1 {
  schemaVersion: 1;
  provenance: 'recorded' | 'igc';
  bounds: ReplayBounds;
  partial: boolean;
  points: ReplayPoint[];
}
export interface SharedArtifactManifest { generation: string; sha256: string; byteCount: number }
export interface SharedFlightMetrics {
  durationMs: number;
  trackDistanceMetres: number;
  minGpsAltitude: number | null;
  maxGpsAltitude: number | null;
  maxGroundSpeed: number | null;
  fixCount: number;
  quality: TrackQuality;
}
/** Approved social projection only. Never a recorder or archive entity. */
export interface SharedFlightSummary {
  activityId: string;
  author: { userId: string; displayName: string };
  publishedAt: string;
  title: string | null;
  site: string | null;
  siteSource: SiteSource | null;
  startedAt: number;
  endedAt: number;
  timezoneOffsetMinutes: number | null;
  status: 'completed' | 'partial';
  metrics: SharedFlightMetrics;
  routePreview: TrackSegments;
  provenance: 'recorded' | 'igc';
  replayAvailable: boolean;
  artifact: SharedArtifactManifest;
}
export type SharedFlightDetail = SharedFlightSummary;
export interface FeedCursor { publishedAt: string; activityId: string }
export interface FeedPage { items: SharedFlightSummary[]; nextCursor: FeedCursor | null }
export interface RemotePublication {
  flightId: string;
  activityId: string | null;
  revision: number;
  state: 'private' | 'pending' | 'shared' | 'hidden';
}
export interface PrepareShareInput {
  flightId: string;
  operationId: string;
  mode: PublicationMode;
  consentGeneration: string | null;
  expectedRevision: number;
}
export interface PreparedShare {
  activityId: string;
  revision: number;
  uploadToken: string;
  alreadyPublished: boolean;
}
export interface FeedService {
  getPreferences(signal: AbortSignal): Promise<SharingPreferences>;
  setAutoShare(enabled: boolean, signal: AbortSignal): Promise<SharingPreferences>;
  getFeed(cursor: FeedCursor | null, signal: AbortSignal): Promise<FeedPage>;
  getDetail(activityId: string, signal: AbortSignal): Promise<SharedFlightDetail>;
  getReplay(activityId: string, manifest: SharedArtifactManifest, signal: AbortSignal): Promise<SharedReplayArtifactV1>;
  getPublication(flightId: string, signal: AbortSignal): Promise<RemotePublication>;
  prepareShare(input: PrepareShareInput, signal: AbortSignal): Promise<PreparedShare>;
  uploadShare(prepared: PreparedShare, artifact: SharedReplayArtifactV1, signal: AbortSignal): Promise<RemotePublication>;
  hideFlight(flightId: string, signal: AbortSignal): Promise<RemotePublication>;
}
export interface FeedSnapshot {
  identityKey: string | null;
  available: boolean;
  recorderBusy: boolean;
  revision: number;
  preferences: SharingPreferences | null;
  items: SharedFlightSummary[];
  nextCursor: FeedCursor | null;
  loading: boolean;
  loadingMore: boolean;
  busy: boolean;
  error: string | null;
}
export interface FeedContextValue extends FeedSnapshot {
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  setAutoShare(enabled: boolean): Promise<void>;
  getDetail(activityId: string): Promise<SharedFlightDetail>;
  getReplay(activityId: string, manifest: SharedArtifactManifest): Promise<SharedReplayArtifactV1>;
  getPublication(flightId: string): Promise<RemotePublication>;
}
export interface FlightPublicationView {
  state: 'private' | 'pending' | 'shared' | 'hidden' | 'error';
  activityId: string | null;
  error: string | null;
  busy: boolean;
  available: boolean;
  online: boolean;
  pendingHide: boolean;
  refresh(): Promise<void>;
  share(): Promise<void>;
  hide(): Promise<void>;
  retry(): Promise<void>;
}

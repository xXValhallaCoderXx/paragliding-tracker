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
export interface KudosSummary { count: number; givenByMe: boolean }
export interface KudosResult extends KudosSummary { activityId: string }
export interface KudosSupporter { id: string; displayName: string }
export interface KudosCursor { createdAt: string; id: string }
export interface KudosPage extends KudosResult { items: KudosSupporter[]; nextCursor: KudosCursor | null }
export interface KudosState { summary: KudosSummary | null; pending: boolean; error: string | null }
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
  /** Null means this server does not supply kudos, not that the count is zero. */
  kudos: KudosSummary | null;
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
  setKudos(activityId: string, given: boolean, signal: AbortSignal): Promise<KudosResult>;
  getKudos(activityId: string, cursor: KudosCursor | null, signal: AbortSignal): Promise<KudosPage>;
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
  kudosByActivity: Record<string, KudosState>;
}
export interface FeedContextValue extends FeedSnapshot {
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  setAutoShare(enabled: boolean): Promise<void>;
  getDetail(activityId: string): Promise<SharedFlightDetail>;
  getReplay(activityId: string, manifest: SharedArtifactManifest): Promise<SharedReplayArtifactV1>;
  getPublication(flightId: string): Promise<RemotePublication>;
  setKudos(activityId: string, given: boolean): Promise<KudosResult>;
  getKudos(activityId: string, cursor: KudosCursor | null): Promise<KudosPage>;
}
export interface FlightPublicationView {
  state: 'unknown' | 'private' | 'pending' | 'shared' | 'hidden' | 'error';
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

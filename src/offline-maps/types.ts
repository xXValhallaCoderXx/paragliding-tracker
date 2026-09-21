/** Map download bounds use west, south, east, north (not Photon's extent order). */
export type OfflineBounds = readonly [number, number, number, number];

export interface DestinationSuggestion {
  id: string;
  name: string;
  context: string;
  center: readonly [number, number];
  kind: 'place' | 'region' | 'country' | 'terrain';
  bounds?: OfflineBounds;
  regionQuery?: string;
  provider: 'osm';
}

export interface OfflineRegionSpec {
  id: string;
  name: string;
  context: string;
  bounds: OfflineBounds;
  center: readonly [number, number];
  styleURL: string;
  minZoom: number;
  maxZoom: number;
  attribution: string;
}

export interface OfflineEstimate {
  transferBytes: number;
  storageBytes: number;
  errorMargin: number;
}

export interface OfflineStorageInfo {
  usedBytes: number;
  freeBytes: number;
}

export interface OfflineProgress {
  completedResources: number;
  requiredResources: number;
  completedBytes: number;
}

export interface OfflineFailure {
  code: string;
  message: string;
}

export interface NativeOfflineRegion extends OfflineProgress {
  id: string;
  logicalRegionId: string;
  spec: OfflineRegionSpec;
  /** Requires a terminal native success receipt and complete style/tile resources. */
  ready: boolean;
}

export interface NativeDownloadEvent extends OfflineProgress {
  nativeId: string;
  operationId: string;
  kind: 'progress' | 'complete' | 'error' | 'paused';
  error?: OfflineFailure;
}

export interface NativeDownloadRequest {
  nativeId: string;
  operationId: string;
  logicalRegionId: string;
  spec: OfflineRegionSpec;
  refresh: boolean;
  allowMobileData: boolean;
}

export interface OfflineMapBackend {
  prepare(): Promise<void>;
  list(): Promise<NativeOfflineRegion[]>;
  estimate(requestId: string, spec: OfflineRegionSpec): Promise<OfflineEstimate>;
  cancelEstimate(requestId: string): Promise<void>;
  start(request: NativeDownloadRequest): Promise<void>;
  pause(nativeId: string, operationId: string): Promise<void>;
  remove(nativeId: string): Promise<void>;
  storage(): Promise<OfflineStorageInfo>;
  subscribe(listener: (event: NativeDownloadEvent) => void): () => void;
}

export type OfflineRegionStatus = 'ready' | 'downloading' | 'updating' | 'paused' | 'error' | 'deleting';
export type OfflinePauseReason = 'user' | 'background' | 'network' | 'recording' | 'storage' | 'interrupted';

export interface OfflineRegion {
  id: string;
  spec: OfflineRegionSpec;
  status: OfflineRegionStatus;
  available: boolean;
  activeNativeId: string | null;
  pendingNativeId: string | null;
  obsoleteNativeIds: string[];
  operationId: string | null;
  completedAt: number | null;
  progress: OfflineProgress | null;
  error: OfflineFailure | null;
  pauseReason: OfflinePauseReason | null;
  allowMobileData: boolean;
}

export interface OfflineMapSnapshot {
  initialized: boolean;
  loading: boolean;
  regions: readonly OfflineRegion[];
  storage: OfflineStorageInfo | null;
  error: OfflineFailure | null;
}

export interface OfflineMapRegistry {
  read(): Promise<OfflineRegion[]>;
  write(regions: readonly OfflineRegion[]): Promise<void>;
}

export interface OfflineEnvironment {
  foreground: boolean;
  recorderReady: boolean;
  recorderBusy: boolean;
  network: 'wifi' | 'other' | 'offline' | 'unknown';
}

export interface OfflineDownloadOptions {
  allowMobileData: boolean;
  /** User deliberately accepted the missing estimate on this attempt. */
  allowUnknownEstimate: boolean;
  estimate?: OfflineEstimate;
}

export const OFFLINE_MAP_FREE_SPACE_RESERVE = 512 * 1024 * 1024;

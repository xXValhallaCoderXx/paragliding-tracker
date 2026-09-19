import type { FlightMapTrack, MapCoordinate } from '@/lib/track/map-geometry';

/** Small session intent, safe to retain while the native view and route are released. */
export interface LiveCameraIntent {
  mode: 'follow' | 'manual';
  center: MapCoordinate | null;
  zoom: number;
}

export interface FlightMapProps {
  track: FlightMapTrack;
  pilotPosition: MapCoordinate | null;
  accessibilityLabel: string;
  /** Increment only when the user requests Fit flight. */
  fitRequest?: number;
  /** Live maps follow captured positions; omitted preserves saved replay fitting. */
  liveCamera?: LiveCameraIntent;
  onLiveCameraChange?: (camera: LiveCameraIntent) => void;
  pilotStale?: boolean;
  /** The live recorder gives its map a bounded viewport between fixed controls. */
  fillContainer?: boolean;
  onReady: () => void;
  onError: (message: string) => void;
  onInteractionChange?: (active: boolean) => void;
}

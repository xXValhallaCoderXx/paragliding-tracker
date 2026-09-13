import type { FlightMapTrack, MapCoordinate } from '@/lib/track/map-geometry';

export interface FlightMapProps {
  track: FlightMapTrack;
  pilotPosition: MapCoordinate | null;
  accessibilityLabel: string;
  /** Increment only when the user requests Fit flight. */
  fitRequest?: number;
  onReady: () => void;
  onError: (message: string) => void;
  onInteractionChange?: (active: boolean) => void;
}

import { useEffect } from 'react';

import type { FlightMapProps } from './types';

export { MAPBOX_STYLE_URI } from './config';
export type { FlightMapProps } from './types';
export const isFlightMapAvailable = false;

/** Web keeps the existing Grid renderer and never loads the native map SDK. */
export function FlightMap({ onError }: FlightMapProps) {
  useEffect(() => { onError('The map is available in the Android app.'); }, [onError]);
  return null;
}

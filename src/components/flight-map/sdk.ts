export type MapboxSdk = typeof import('@rnmapbox/maps');
export const isFlightMapAvailable = false;
export async function loadMapboxSdk(): Promise<MapboxSdk> {
  throw new Error('Maps are available in the Android app.');
}

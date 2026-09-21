import { NativeModules, Platform } from 'react-native';

import { MAPBOX_PUBLIC_ACCESS_TOKEN } from './config';

export type MapboxSdk = typeof import('@rnmapbox/maps');
export const isFlightMapAvailable = MAPBOX_PUBLIC_ACCESS_TOKEN.startsWith('pk.') && NativeModules.RNMBXModule != null;
let sdkPromise: Promise<MapboxSdk> | undefined;

/** All native map consumers share configuration before constructing a MapView. */
export function loadMapboxSdk(): Promise<MapboxSdk> {
  sdkPromise ??= Promise.resolve().then(async () => {
    if (!isFlightMapAvailable) throw new Error('A newer app build with map configuration is needed.');
    // Older installed APKs may have no Mapbox bridge. Never evaluate it before this check.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@rnmapbox/maps') as MapboxSdk;
    await sdk.setAccessToken(MAPBOX_PUBLIC_ACCESS_TOKEN);
    if (Platform.OS === 'android' && NativeModules.XCOfflineMaps?.prepare) {
      await NativeModules.XCOfflineMaps.prepare();
    }
    return sdk;
  }).catch((error: unknown) => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
}

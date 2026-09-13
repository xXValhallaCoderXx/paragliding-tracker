/** Public client configuration; this value is embedded in the native app bundle. */
export const MAPBOX_PUBLIC_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? '';

// Keep the selected classic style explicit: the SDK's Outdoors constant uses v11.
export const MAPBOX_STYLE_URI = 'mapbox://styles/mapbox/outdoors-v12';

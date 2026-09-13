import { unwrapLongitude } from './geometry';
import type { MapBounds, MapCoordinate } from './map-geometry';
import type { PlanePoint } from './types';

const MAX_LATITUDE = 85.0511287798066;
const TILE_SIZE = 512;
const toMercatorY = (latitude: number) => {
  const radians = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2;
};

export interface MapCamera {
  centerCoordinate: MapCoordinate;
  zoomLevel: number;
}

/** Fit the supplied unwrapped extent without introducing a dateline-spanning camera box. */
export function cameraForTrack(bounds: MapBounds, width: number, height: number, requestedPadding = 36): MapCamera {
  const north = toMercatorY(bounds.ne[1]);
  const south = toMercatorY(bounds.sw[1]);
  const spanX = (bounds.ne[0] - bounds.sw[0]) / 360;
  const spanY = south - north;
  const padding = Math.min(requestedPadding, width / 4, height / 4);
  const scaleX = spanX > 0 ? (width - padding * 2) / (TILE_SIZE * spanX) : Infinity;
  const scaleY = spanY > 0 ? (height - padding * 2) / (TILE_SIZE * spanY) : Infinity;
  const longitude = (bounds.ne[0] + bounds.sw[0]) / 2;
  const centerCoordinate: MapCoordinate = [
    ((longitude + 180) % 360 + 360) % 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - north - south))) * 180 / Math.PI,
  ];
  return { centerCoordinate, zoomLevel: Math.max(0, Math.min(18, Math.log2(Math.min(scaleX, scaleY)))) };
}

/** North-up, zero-pitch Mercator pixels for the exact camera used by a map image. */
export function projectMapCoordinate(coordinate: MapCoordinate, camera: MapCamera, width: number, height: number): PlanePoint {
  const [longitude, latitude] = coordinate;
  const [centerLongitude, centerLatitude] = camera.centerCoordinate;
  const worldSize = TILE_SIZE * 2 ** camera.zoomLevel;
  return {
    x: width / 2 + (unwrapLongitude(longitude, centerLongitude) - centerLongitude) / 360 * worldSize,
    y: height / 2 + (toMercatorY(latitude) - toMercatorY(centerLatitude)) * worldSize,
  };
}

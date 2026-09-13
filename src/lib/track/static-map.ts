import { cameraForTrack, projectMapCoordinate, type MapCamera } from './map-camera';
import { isMapCoordinate, mapBounds, type MapCoordinate } from './map-geometry';
import { toPathData } from './projection';
import type { PlanePoint, TrackSegments } from './types';

const VIEW = Object.freeze({ width: 392, height: 340 } as const);
const STATIC_MAX_LATITUDE = 85.0511;
// Stored thumbnail geometry normally has at most 256 points. Do not accidentally
// prepare a raw recording's thousands of fixes for every visible card.
const MAX_PREVIEW_POINTS = 4096;

export interface StaticMapPreview {
  url: string;
  view: typeof VIEW;
  path: string;
  isolatedPoints: PlanePoint[];
  start: PlanePoint;
  stop: PlanePoint;
}

/**
 * A basemap request and its local SVG geometry share one exact Mercator camera.
 * The URL contains only the viewport, never route or endpoint overlays.
 */
export function buildStaticMapPreview(segments: TrackSegments, publicToken: string): StaticMapPreview | null {
  const token = publicToken.trim();
  if (!token.startsWith('pk.') || token.length <= 3 || /\s/.test(token)) return null;

  const runs: MapCoordinate[][] = [];
  const coordinates: MapCoordinate[] = [];
  let inputPoints = 0;
  for (const segment of segments) {
    let run: MapCoordinate[] = [];
    for (let index = 0; index < segment.length; index += 2) {
      inputPoints += 1;
      if (inputPoints > MAX_PREVIEW_POINTS) return null;
      const coordinate: MapCoordinate = [segment[index + 1]!, segment[index]!];
      if (!isMapCoordinate(coordinate)) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      // These are valid GPS positions but cannot be represented by this API;
      // preserve the whole route using Grid rather than hiding valid polar fixes.
      if (Math.abs(coordinate[1]) > STATIC_MAX_LATITUDE) return null;
      run.push(coordinate);
      coordinates.push(coordinate);
    }
    if (run.length) runs.push(run);
  }
  const bounds = mapBounds(coordinates);
  if (!bounds) return null;

  const fit = cameraForTrack(bounds, VIEW.width, VIEW.height, 48);
  // Static Images rounds zoom to two decimals. Round down to preserve padding,
  // then project against those same URL values instead of the unrounded fit.
  const camera: MapCamera = {
    centerCoordinate: [Number(fit.centerCoordinate[0].toFixed(6)),
      Number(Math.max(-STATIC_MAX_LATITUDE, Math.min(STATIC_MAX_LATITUDE, fit.centerCoordinate[1])).toFixed(6))],
    zoomLevel: Math.floor(fit.zoomLevel * 100) / 100,
  };
  const project = (coordinate: MapCoordinate) => projectMapCoordinate(coordinate, camera, VIEW.width, VIEW.height);
  const projectedRuns = runs.map((run) => run.map(project));
  const [longitude, latitude] = camera.centerCoordinate;
  return {
    url: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${longitude},${latitude},${camera.zoomLevel.toFixed(2)},0,0/${VIEW.width}x${VIEW.height}@2x?logo=true&attribution=true&access_token=${encodeURIComponent(token)}`,
    view: VIEW,
    path: toPathData(projectedRuns.filter((run) => run.length > 1)),
    isolatedPoints: projectedRuns.filter((run) => run.length === 1).map((run) => run[0]!),
    start: project(coordinates[0]!),
    stop: project(coordinates[coordinates.length - 1]!),
  };
}

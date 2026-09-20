import { MAPBOX_STYLE_URI } from '@/components/flight-map/config';
import { buildUrl, fetchJson, isSiteLookupError, type RequestOptions } from '@/sites/http';
import { isLaunchLikeOsmValue } from '@/sites/site-plan';

import type { DestinationSuggestion, OfflineBounds, OfflineRegionSpec } from './types';

const PHOTON_URL = process.env.EXPO_PUBLIC_PHOTON_URL ?? 'https://photon.komoot.io/api/';
export const DESTINATION_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
export const DESTINATION_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';
const LOCAL_RADIUS_KM = 25;
const MERCATOR_LATITUDE = 85.05112878;
const PLACE_VALUES = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'locality', 'island', 'archipelago']);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Only the explicitly supported shorthand is expanded; ambiguous launch names stay choices. */
export function normalizeDestinationQuery(value: string): { query: string; expandedFrom?: string } {
  const query = clean(value);
  return /^kkb$/i.test(query) ? { query: 'Kuala Kubu Bharu', expandedFrom: query } : { query };
}

function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Photon extent order differs from conventional map bounds. Invalid extents stay absent. */
export function photonBounds(value: unknown): OfflineBounds | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [west, north, east, south] = value;
  if (!numberIn(west, -180, 180) || !numberIn(east, -180, 180)
    || !numberIn(south, -90, 90) || !numberIn(north, -90, 90)
    || west >= east || south >= north) return undefined;
  return [west, south, east, north];
}

export function parseDestination(raw: unknown): DestinationSuggestion | null {
  const feature = raw as { properties?: Record<string, unknown>; geometry?: { type?: unknown; coordinates?: unknown } } | null;
  const properties = feature?.properties;
  const coordinates = feature?.geometry?.coordinates;
  if (!properties || feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return null;
  const [longitude, latitude] = coordinates;
  const name = clean(properties.name);
  if (!name || !numberIn(longitude, -180, 180) || !numberIn(latitude, -90, 90)) return null;
  const osmValue = clean(properties.osm_value);
  const type = clean(properties.type);
  let kind: DestinationSuggestion['kind'];
  if (type === 'country' || osmValue === 'country') kind = 'country';
  else if (['county', 'state'].includes(type) || ['state', 'province', 'region'].includes(osmValue)
    || (properties.osm_key === 'boundary' && osmValue === 'administrative')) kind = 'region';
  else if (properties.osm_key === 'place' && PLACE_VALUES.has(osmValue)) kind = 'place';
  else if (isLaunchLikeOsmValue(osmValue)) kind = 'terrain';
  else return null;

  const contextParts = [...new Set([properties.city, properties.county, properties.state, properties.country]
    .map(clean).filter((part) => part && part.toLocaleLowerCase() !== name.toLocaleLowerCase()))];
  const parent = [properties.county, properties.state].map(clean)
    .find((part) => part && part.toLocaleLowerCase() !== name.toLocaleLowerCase());
  const country = clean(properties.country);
  return {
    id: `osm:${clean(properties.osm_type) || '?'}:${String(properties.osm_id ?? `${longitude},${latitude}`)}`,
    name, context: contextParts.join(', '), center: [longitude, latitude], kind,
    bounds: photonBounds(properties.extent),
    regionQuery: parent ? [...new Set([parent, country].filter(Boolean))].join(', ') : undefined,
    provider: 'osm',
  };
}

/** Submitted destination search deliberately has no pilot-position bias or launch-only filter. */
export async function searchDestinations(query: string, options: RequestOptions = {}): Promise<DestinationSuggestion[]> {
  const normalized = normalizeDestinationQuery(query).query;
  if (normalized.length < 2) return [];
  if (options.signal?.aborted) throw { kind: 'aborted', message: 'Search cancelled.' };
  const result = await fetchJson<{ features?: unknown }>(buildUrl(PHOTON_URL, { q: normalized, limit: 24, lang: 'en' }), options);
  if (!Array.isArray(result?.features)) throw { kind: 'unavailable', message: 'Destination search returned an invalid response.' };
  const seen = new Set<string>();
  return result.features.map(parseDestination).filter((destination): destination is DestinationSuggestion => {
    if (!destination || seen.has(destination.id)) return false;
    seen.add(destination.id);
    return true;
  }).slice(0, 8);
}

/** Point results get an honest local-area label, never a claimed administrative boundary. */
export function coverageForDestination(destination: DestinationSuggestion): OfflineRegionSpec {
  const [longitude, latitude] = destination.center;
  if (Math.abs(latitude) >= MERCATOR_LATITUDE) throw new Error('This destination is outside the supported map area. Choose a nearby region.');
  const regional = destination.kind !== 'terrain' && destination.bounds;
  const latDelta = LOCAL_RADIUS_KM / 111.195;
  const lonDelta = LOCAL_RADIUS_KM / (111.195 * Math.cos(latitude * Math.PI / 180));
  const bounds: OfflineBounds = regional
    ? [regional[0], Math.max(-MERCATOR_LATITUDE, regional[1]), regional[2], Math.min(MERCATOR_LATITUDE, regional[3])]
    : [longitude - lonDelta, latitude - latDelta, longitude + lonDelta, latitude + latDelta];
  if (bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -MERCATOR_LATITUDE || bounds[3] > MERCATOR_LATITUDE) {
    throw new Error('This local area crosses the supported map boundary. Search for a nearby named region instead.');
  }
  return {
    id: `destination:${destination.id}:${regional ? 'area' : 'local25'}`,
    name: regional ? destination.name : `Around ${destination.name}`,
    context: destination.context, center: destination.center, bounds,
    styleURL: MAPBOX_STYLE_URI, minZoom: 0, maxZoom: 14, attribution: DESTINATION_ATTRIBUTION,
  };
}

export function destinationSearchError(error: unknown): string {
  if (isSiteLookupError(error)) {
    if (error.kind === 'offline') return 'Destination search needs an internet connection. Connect and try again; your saved maps remain available.';
    if (error.kind === 'throttled') return 'Destination search is busy. Wait a moment, then try again.';
  }
  return 'Destination search is unavailable. Check your connection and try again.';
}

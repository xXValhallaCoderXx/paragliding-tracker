import { buildUrl, fetchJson, type RequestOptions } from './http';
import {
  NEARBY_RADIUS_KM,
  SITE_SUGGESTION_LIMIT,
  parseParaglidingEarthFeature,
  parsePhotonFeature,
  rankSites,
} from './site-plan';
import type { Coordinate, SiteSuggestion } from './types';

/**
 * The two catalogues.
 *
 * ParaglidingEarth answers "what launches are near here" with real launch names, wind
 * directions and altitudes — but has no search-by-name endpoint at all. Photon answers
 * "what is called this" against OpenStreetMap. Neither needs an API key, and both permit
 * storing the name permanently, which is what a logbook requires and what ruled out
 * Google.
 *
 * Base URLs are environment variables because both are volunteer-run services with no
 * uptime guarantee. Self-hosting either one should be a config change, not a code change.
 * Written as full literal member expressions: babel-preset-expo only inlines
 * `process.env.EXPO_PUBLIC_X` when it appears literally.
 */

const PARAGLIDING_EARTH_URL =
  process.env.EXPO_PUBLIC_PARAGLIDING_EARTH_URL ??
  'https://www.paraglidingearth.com/api/geojson/getAroundLatLngSites.php';

const PHOTON_URL = process.env.EXPO_PUBLIC_PHOTON_URL ?? 'https://photon.komoot.io/api/';

interface FeatureCollection {
  features?: unknown;
}

function parseCollection(
  payload: unknown,
  parse: (raw: unknown) => SiteSuggestion | null,
): SiteSuggestion[] {
  const features = (payload as FeatureCollection | null)?.features;
  if (!Array.isArray(features)) return [];
  // One malformed feature must not lose the rest: these are community-edited databases
  // and a single entry with a missing coordinate is unremarkable.
  return features.map(parse).filter((site): site is SiteSuggestion => site !== null);
}

/** Launches near a coordinate, nearest first. */
export async function fetchNearbySites(
  near: Coordinate,
  options: RequestOptions & { limit?: number; radiusKm?: number } = {},
): Promise<SiteSuggestion[]> {
  const url = buildUrl(PARAGLIDING_EARTH_URL, {
    lat: near.latitude,
    lng: near.longitude,
    distance: options.radiusKm ?? NEARBY_RADIUS_KM,
    limit: options.limit ?? SITE_SUGGESTION_LIMIT,
  });
  const payload = await fetchJson<unknown>(url, options);
  return rankSites(parseCollection(payload, parseParaglidingEarthFeature), options.limit);
}

/**
 * Places matching a typed name, biased toward the pilot if a position is known.
 *
 * The bias matters more than it looks: unbiased, "Bukit" returns results from across
 * Indonesia and Malaysia; biased, it returns the ones near the launch.
 */
export async function searchSitesByName(
  query: string,
  options: RequestOptions & { near?: Coordinate | null; limit?: number } = {},
): Promise<SiteSuggestion[]> {
  const limit = options.limit ?? SITE_SUGGESTION_LIMIT;
  const url = buildUrl(PHOTON_URL, {
    q: query.trim(),
    // Over-fetch: most of what Photon returns for a place name is suburbs and bus stops,
    // and those are dropped rather than ranked down, so asking for exactly `limit` would
    // routinely come back with two usable rows.
    limit: limit * 4,
    ...(options.near
      ? { lat: options.near.latitude, lon: options.near.longitude }
      : {}),
  });
  const payload = await fetchJson<unknown>(url, options);
  return rankSites(parseCollection(payload, parsePhotonFeature), limit);
}

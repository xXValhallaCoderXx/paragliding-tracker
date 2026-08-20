/**
 * Launch-site lookup.
 *
 * This layer imports nothing from the rest of the app — not the recorder's types, not the
 * cloud config, not the store. It is a client for two public catalogues and the pure
 * policy for turning their answers into something a pilot can pick from. That isolation is
 * enforced by `module-boundaries.test.ts` and is what lets it be unit-tested with no
 * database, no native module and no network.
 */

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Which catalogue a name came from, and therefore which licence it falls under.
 *
 * Deliberately the same strings the `flights.site_source` column stores, so a name can be
 * credited correctly long after the search that produced it.
 */
export type SiteProvider = 'paraglidingearth' | 'osm';

export interface SiteSuggestion {
  /** Stable within a provider; used for list keys and dedup, never persisted. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Metres from the query point, when the provider knows. Null for a name search. */
  distanceMetres: number | null;
  provider: SiteProvider;
  /**
   * One short line of supporting context — an altitude, a region. Never
   * ParaglidingEarth's `takeoff_description`: that is prose rather than fact, so it is
   * the one field of theirs that CC BY-SA's share-alike would actually attach to.
   */
  detail: string | null;
}

/**
 * Why a lookup produced nothing.
 *
 * Every one of these degrades to the same thing on screen — an empty list and a text box
 * that still works — but they are distinguished so the copy can be honest about whether
 * to suggest trying again.
 */
export type SiteErrorKind =
  /** No usable connection. */
  | 'offline'
  /** The service asked us to slow down. */
  | 'throttled'
  /** The service is down or returned something unusable. */
  | 'unavailable'
  /** Superseded by a newer query, or the screen went away. Never shown. */
  | 'aborted';

export interface SiteLookupError {
  kind: SiteErrorKind;
  message: string;
}

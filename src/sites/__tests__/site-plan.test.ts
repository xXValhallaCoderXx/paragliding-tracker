import {
  attributionFor,
  dedupeSites,
  distanceBetween,
  isLaunchLikeOsmValue,
  isSearchable,
  parseMetres,
  parseParaglidingEarthFeature,
  parsePhotonFeature,
  rankSites,
  roundCoordinate,
  shouldSendSearch,
} from '../site-plan';
import type { SiteSuggestion } from '../types';

/** A ParaglidingEarth feature in the shape their API actually returns. */
function pgeFeature(overrides: Record<string, unknown> = {}, coordinates: unknown = [11.5994, 46.5295]) {
  return {
    type: 'Feature',
    properties: {
      name: 'Spitzbuhel -Siusi/ Seis am Schlern',
      place: 'paragliding takeoff',
      // Note: a STRING of metres. This is the trap.
      distance: '8280',
      takeoff_altitude: '1913',
      takeoff_description: 'Grass field',
      paragliding: '1',
      ...overrides,
    },
    geometry: { type: 'Point', coordinates },
  };
}

function photonFeature(properties: Record<string, unknown> = {}, coordinates: unknown = [101.42, 2.81]) {
  return {
    type: 'Feature',
    properties: {
      name: 'Bukit Jugra',
      osm_value: 'peak',
      osm_type: 'N',
      osm_id: 123,
      county: 'Kuala Langat',
      country: 'Malaysia',
      ...properties,
    },
    geometry: { type: 'Point', coordinates },
  };
}

function site(overrides: Partial<SiteSuggestion> & { id: string }): SiteSuggestion {
  return {
    name: 'Somewhere',
    latitude: 46.5,
    longitude: 11.5,
    distanceMetres: null,
    provider: 'osm',
    detail: null,
    ...overrides,
  };
}

describe('parseMetres', () => {
  it('parses the string metres ParaglidingEarth actually sends', () => {
    // "1000" < "9" as strings; every distance comparison downstream depends on this.
    expect(parseMetres('8280')).toBe(8280);
    expect(parseMetres(8280)).toBe(8280);
  });

  it('rejects anything not a finite number', () => {
    expect(parseMetres('abc')).toBeNull();
    expect(parseMetres('')).toBeNull();
    expect(parseMetres('   ')).toBeNull();
    expect(parseMetres(undefined)).toBeNull();
    expect(parseMetres(Number.NaN)).toBeNull();
    expect(parseMetres(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('parseParaglidingEarthFeature', () => {
  it('reads a real feature, with distance as a number', () => {
    const parsed = parseParaglidingEarthFeature(pgeFeature())!;
    expect(parsed).toMatchObject({
      name: 'Spitzbuhel -Siusi/ Seis am Schlern',
      latitude: 46.5295,
      longitude: 11.5994,
      distanceMetres: 8280,
      provider: 'paraglidingearth',
      detail: '1913 m',
    });
    expect(typeof parsed.distanceMetres).toBe('number');
  });

  it('reads GeoJSON coordinates as [longitude, latitude]', () => {
    // Swapping these is the classic bug in this format and yields a plausible-looking
    // coordinate in the wrong hemisphere, which no type can catch.
    const parsed = parseParaglidingEarthFeature(pgeFeature({}, [11.5994, 46.5295]))!;
    expect(parsed.latitude).toBe(46.5295);
    expect(parsed.longitude).toBe(11.5994);
  });

  it('never carries the takeoff description', () => {
    // Prose rather than fact, so it is the one field where CC BY-SA's share-alike would
    // genuinely attach. The altitude is a fact and is fine.
    const parsed = parseParaglidingEarthFeature(pgeFeature())!;
    expect(JSON.stringify(parsed)).not.toContain('Grass field');
  });

  it('drops unusable features rather than inventing values', () => {
    expect(parseParaglidingEarthFeature(pgeFeature({ name: undefined }))).toBeNull();
    expect(parseParaglidingEarthFeature(pgeFeature({ name: '   ' }))).toBeNull();
    expect(parseParaglidingEarthFeature(pgeFeature({}, [11.6, 91]))).toBeNull();
    expect(parseParaglidingEarthFeature(pgeFeature({}, [181, 46.5]))).toBeNull();
    expect(parseParaglidingEarthFeature(pgeFeature({}, 'nope'))).toBeNull();
    expect(parseParaglidingEarthFeature(null)).toBeNull();
    expect(parseParaglidingEarthFeature({})).toBeNull();
  });

  it('keeps a site whose distance is missing', () => {
    // A name search has no distance; that is not a reason to discard the launch.
    expect(parseParaglidingEarthFeature(pgeFeature({ distance: undefined }))).toMatchObject({
      distanceMetres: null,
    });
  });

  it('tidies community-entered whitespace', () => {
    expect(parseParaglidingEarthFeature(pgeFeature({ name: '  Bukit   Jugra \t' }))).toMatchObject({
      name: 'Bukit Jugra',
    });
  });
});

describe('parsePhotonFeature', () => {
  it('reads a peak', () => {
    expect(parsePhotonFeature(photonFeature())).toMatchObject({
      name: 'Bukit Jugra',
      latitude: 2.81,
      longitude: 101.42,
      provider: 'osm',
      detail: 'Kuala Langat',
      distanceMetres: null,
    });
  });

  it('drops what a paraglider cannot launch from', () => {
    // Photon biased to a region returns suburbs and bus stops — measured, not assumed.
    // One of those in the list makes the whole list untrustworthy.
    expect(parsePhotonFeature(photonFeature({ osm_value: 'suburb' }))).toBeNull();
    expect(parsePhotonFeature(photonFeature({ osm_value: 'bus_stop' }))).toBeNull();
    expect(parsePhotonFeature(photonFeature({ osm_value: 'orchard' }))).toBeNull();
    expect(parsePhotonFeature(photonFeature({ osm_value: undefined }))).toBeNull();
  });

  it('keeps the terrain types a launch plausibly is', () => {
    for (const value of ['peak', 'ridge', 'saddle', 'hill', 'cliff', 'viewpoint']) {
      expect(isLaunchLikeOsmValue(value)).toBe(true);
    }
    expect(isLaunchLikeOsmValue('suburb')).toBe(false);
  });
});

describe('distanceBetween', () => {
  it('is roughly right at logbook distances', () => {
    // One degree of latitude is ~111 km.
    const metres = distanceBetween({ latitude: 46, longitude: 11 }, { latitude: 47, longitude: 11 });
    expect(metres).toBeGreaterThan(110_000);
    expect(metres).toBeLessThan(112_000);
  });

  it('is zero for the same point', () => {
    expect(distanceBetween({ latitude: 46.5, longitude: 11.5 }, { latitude: 46.5, longitude: 11.5 })).toBe(0);
  });
});

describe('dedupeSites', () => {
  it('collapses the same launch from both catalogues, preferring ParaglidingEarth', () => {
    const merged = dedupeSites([
      site({ id: 'osm:1', name: 'Bukit Jugra', latitude: 2.81, longitude: 101.42, provider: 'osm' }),
      site({
        id: 'pge:1',
        name: 'bukit  jugra',
        latitude: 2.8102,
        longitude: 101.4201,
        provider: 'paraglidingearth',
        detail: '280 m',
      }),
    ]);
    expect(merged).toHaveLength(1);
    // The paragliding catalogue wins: its name is the one pilots use and it has altitude.
    expect(merged[0]).toMatchObject({ provider: 'paraglidingearth', detail: '280 m' });
  });

  it('keeps two different launches on the same ridge', () => {
    const merged = dedupeSites([
      site({ id: 'a', name: 'North launch', latitude: 46.5, longitude: 11.5 }),
      site({ id: 'b', name: 'South launch', latitude: 46.5003, longitude: 11.5 }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps two distant places that happen to share a name', () => {
    const merged = dedupeSites([
      site({ id: 'a', name: 'Bukit Naga', latitude: 4.8, longitude: 100.7 }),
      site({ id: 'b', name: 'Bukit Naga', latitude: -7.1, longitude: 110.4 }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('rankSites', () => {
  it('puts the nearest launch first', () => {
    const ranked = rankSites([
      site({ id: 'far', name: 'Far', distanceMetres: 9000 }),
      site({ id: 'near', name: 'Near', distanceMetres: 1200, latitude: 46.4 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(['near', 'far']);
  });

  it('sorts numerically, not as strings', () => {
    // "1000" sorts before "9" as text. This is the assertion that catches it.
    const ranked = rankSites([
      site({ id: 'nine', distanceMetres: 9, name: 'Nine', latitude: 46.1 }),
      site({ id: 'thousand', distanceMetres: 1000, name: 'Thousand', latitude: 46.2 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(['nine', 'thousand']);
  });

  it('places anything with a distance above anything without one', () => {
    const ranked = rankSites([
      site({ id: 'named', name: 'Aaa named match', latitude: 46.1 }),
      site({ id: 'nearby', name: 'Zzz nearby', distanceMetres: 5000, latitude: 46.2 }),
    ]);
    expect(ranked[0]!.id).toBe('nearby');
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      site({ id: `s${index}`, name: `Site ${index}`, latitude: 46 + index / 100 }),
    );
    expect(rankSites(many, 5)).toHaveLength(5);
  });
});

describe('roundCoordinate', () => {
  it('collapses GPS jitter into one cache key', () => {
    // RTK Query keys a cache entry on the stringified argument, so a coordinate that
    // wobbles in its sixth decimal would produce a new entry per read.
    expect(roundCoordinate(46.529512)).toBe(46.53);
    expect(roundCoordinate(46.529488)).toBe(46.529);
    expect(roundCoordinate(2.8100001)).toBe(2.81);
  });
});

describe('search gating', () => {
  it('ignores queries too short to mean anything', () => {
    expect(isSearchable('bu')).toBe(false);
    expect(isSearchable('  b  ')).toBe(false);
    expect(isSearchable('buk')).toBe(true);
  });

  it('sends the first search immediately', () => {
    expect(
      shouldSendSearch({ query: 'bukit', lastSentQuery: null, now: 1000, lastSentAt: null }),
    ).toBe(true);
  });

  it('never repeats the query it just sent', () => {
    expect(
      shouldSendSearch({ query: 'bukit', lastSentQuery: 'bukit', now: 99_999, lastSentAt: 1000 }),
    ).toBe(false);
  });

  it('rate limits rather than backing off, because a stale answer is worthless', () => {
    // Photon is fair-use and throttles. The next keystroke supersedes a failed search, so
    // the control is not asking too often — not retrying afterwards.
    const base = { query: 'bukit j', lastSentQuery: 'bukit', lastSentAt: 1_000 };
    expect(shouldSendSearch({ ...base, now: 1_500 })).toBe(false);
    expect(shouldSendSearch({ ...base, now: 2_000 })).toBe(true);
  });
});

describe('attributionFor', () => {
  it('credits only the sources actually on screen', () => {
    // Both licences require attribution where the data is shown, and they are different
    // licences — claiming both when one is showing is as wrong as claiming neither.
    expect(attributionFor([site({ id: 'a', provider: 'paraglidingearth' })])).toBe(
      'ParaglidingEarth (CC BY-SA 3.0)',
    );
    expect(attributionFor([site({ id: 'b', provider: 'osm' })])).toBe('OpenStreetMap (ODbL)');
    expect(
      attributionFor([
        site({ id: 'a', provider: 'paraglidingearth' }),
        site({ id: 'b', provider: 'osm' }),
      ]),
    ).toBe('ParaglidingEarth (CC BY-SA 3.0) · OpenStreetMap (ODbL)');
  });

  it('credits nobody when nothing is shown', () => {
    expect(attributionFor([])).toBeNull();
  });
});

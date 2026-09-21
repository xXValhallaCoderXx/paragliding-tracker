import { coverageForDestination, normalizeDestinationQuery, parseDestination, photonBounds, searchDestinations } from '../destinations';
import type { Transport } from '@/sites/http';

function feature(properties: Record<string, unknown> = {}, coordinates: unknown = [102.6172292, 5.7899949]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {
    osm_type: 'N', osm_id: 1, name: 'Bukit Bubus', osm_key: 'natural', osm_value: 'peak',
    county: 'Besut', state: 'Terengganu', country: 'Malaysia', ...properties,
  } };
}

it('accepts towns, regions and countries without turning addresses into download destinations', () => {
  expect(parseDestination(feature({ name: 'Kuala Kubu Bharu', osm_key: 'place', osm_value: 'city', type: 'city' }))?.kind).toBe('place');
  expect(parseDestination(feature({ name: 'Wonogiri', osm_key: 'boundary', osm_value: 'administrative', type: 'county' }))?.kind).toBe('region');
  expect(parseDestination(feature({ name: 'Singapore', osm_key: 'place', osm_value: 'country', type: 'country' }))?.kind).toBe('country');
  expect(parseDestination(feature({ osm_key: 'railway', osm_value: 'station', type: 'house' }))).toBeNull();
  expect(parseDestination(feature({}, [NaN, 1]))).toBeNull();
});

it('retains distinguishing place context and resolves a broader search without inventing coordinates', () => {
  expect(parseDestination(feature())).toMatchObject({ name: 'Bukit Bubus', context: 'Besut, Terengganu, Malaysia',
    center: [102.6172292, 5.7899949], regionQuery: 'Besut, Malaysia' });
});

it('converts north-before-south Photon extents and rejects malformed or wrapped extents', () => {
  expect(photonBounds([102.37, 5.96, 103.69, 3.88])).toEqual([102.37, 3.88, 103.69, 5.96]);
  for (const bounds of [[102, 3, 103, 5], [181, 5, 183, 3], [170, 5, -170, 3], [1, NaN, 2, 3]]) {
    expect(photonBounds(bounds)).toBeUndefined();
  }
});

it('uses administrative extent unchanged and uses a 25 km local rectangle for a peak', () => {
  const region = parseDestination(feature({ name: 'Terengganu', type: 'state', osm_value: 'state',
    extent: [102.37, 5.96, 103.69, 3.88] }))!;
  expect(coverageForDestination(region)).toMatchObject({ name: 'Terengganu', bounds: [102.37, 3.88, 103.69, 5.96],
    minZoom: 0, maxZoom: 14, attribution: '© OpenStreetMap contributors (ODbL)' });
  const local = coverageForDestination(parseDestination(feature({ extent: [102.61, 5.80, 102.62, 5.78] }))!);
  expect(local.name).toBe('Around Bukit Bubus');
  expect((local.bounds[3] - local.bounds[1]) * 111.195).toBeCloseTo(50, 5);
  expect((local.bounds[2] - local.bounds[0]) * 111.195 * Math.cos(5.7899949 * Math.PI / 180)).toBeCloseTo(50, 5);
});

it('does not claim a clipped polar or antimeridian local area', () => {
  expect(() => coverageForDestination(parseDestination(feature({}, [179.99, 5]))!)).toThrow('boundary');
  expect(() => coverageForDestination(parseDestination(feature({}, [10, 89]))!)).toThrow('outside');
});

it('expands KKB transparently while leaving Bubos spelling for explicit user choice', () => {
  expect(normalizeDestinationQuery(' kKb ')).toEqual({ query: 'Kuala Kubu Bharu', expandedFrom: 'kKb' });
  expect(normalizeDestinationQuery('Bukit Bubos')).toEqual({ query: 'Bukit Bubos' });
});

it('sends only a submitted normalized query, preserves relevance, and drops duplicate IDs', async () => {
  const transport = jest.fn<ReturnType<Transport>, Parameters<Transport>>().mockResolvedValue({ ok: true,
    json: async () => ({ features: [feature({ osm_id: 2, name: 'Z result' }), feature({ name: 'A result' }), feature({ name: 'duplicate' })] }),
  } as Response);
  expect((await searchDestinations('KKB', { transport })).map((result) => result.name)).toEqual(['Z result', 'A result']);
  const url = new URL(transport.mock.calls[0]![0]);
  expect(url.searchParams.get('q')).toBe('Kuala Kubu Bharu');
  expect(url.searchParams.has('lat')).toBe(false);
  expect(url.searchParams.has('lon')).toBe(false);
  await searchDestinations('k', { transport });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('does not send already-aborted searches or report malformed payloads as no results', async () => {
  const transport = jest.fn<ReturnType<Transport>, Parameters<Transport>>().mockResolvedValue({ ok: true, json: async () => null } as Response);
  const controller = new AbortController(); controller.abort();
  await expect(searchDestinations('Jugra', { transport, signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  expect(transport).not.toHaveBeenCalled();
  await expect(searchDestinations('Jugra', { transport })).rejects.toMatchObject({ kind: 'unavailable' });
});

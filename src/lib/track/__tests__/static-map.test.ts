import { buildStaticMapPreview, type StaticMapPreview } from '../static-map';

const TOKEN = 'pk.preview-test';
function camera(preview: StaticMapPreview) {
  const url = new URL(preview.url);
  const [longitude, latitude, zoom] = url.pathname.split('/static/')[1]!.split('/')[0]!.split(',').map(Number);
  return { longitude: longitude!, latitude: latitude!, zoom: zoom!, url };
}

it('aligns local endpoints with the exact rounded camera requested from the image API', () => {
  const preview = buildStaticMapPreview([[46.5, 11.5, 46.57317, 11.54823]], TOKEN)!;
  const { longitude, latitude, zoom, url } = camera(preview);
  expect(url.pathname).toMatch(/^\/styles\/v1\/mapbox\/outdoors-v12\/static\/[-\d.]+,[-\d.]+,\d+\.\d{2},0,0\/392x340@2x$/);
  expect(Object.fromEntries(url.searchParams)).toEqual({ logo: 'true', attribution: 'true', access_token: TOKEN });
  expect(url.pathname).not.toContain('geojson');
  expect(preview.view).toEqual({ width: 392, height: 340 });

  // Invert the image's Mercator camera to recover the source coordinates from
  // the local endpoint pixels. Using a different pre-rounded zoom fails this.
  const pixels = 512 * 2 ** zoom;
  const centerMercator = Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
  for (const [point, expectedLatitude, expectedLongitude] of [
    [preview.start, 46.5, 11.5], [preview.stop, 46.57317, 11.54823],
  ] as const) {
    expect(longitude + (point.x - 196) / pixels * 360).toBeCloseTo(expectedLongitude, 8);
    const latitudeAtPixel = (2 * Math.atan(Math.exp(centerMercator - (point.y - 170) / pixels * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;
    expect(latitudeAtPixel).toBeCloseTo(expectedLatitude, 8);
    expect(point.x).toBeGreaterThanOrEqual(47.9);
    expect(point.x).toBeLessThanOrEqual(344.1);
    expect(point.y).toBeGreaterThanOrEqual(47.9);
    expect(point.y).toBeLessThanOrEqual(292.1);
  }
});

it('draws a short continuous dateline crossing on the dateline image', () => {
  const preview = buildStaticMapPreview([[10, 179.99, 10, -179.99]], TOKEN)!;
  expect(Math.abs(camera(preview).longitude)).toBe(180);
  expect(camera(preview).zoom).toBeGreaterThan(12);
  expect(preview.path.match(/M/g)).toHaveLength(1);
  expect(preview.start.x).toBeGreaterThan(47.9);
  expect(preview.start.x).toBeLessThan(49);
  expect(preview.stop.x).toBeGreaterThan(343);
  expect(preview.stop.x).toBeLessThan(344.1);
  expect(preview.start.y).toBeCloseTo(preview.stop.y);
});

it('keeps stored gaps and invalid-fix breaks, including isolated start and stop points', () => {
  const preview = buildStaticMapPreview([
    [46.49, 11.49],
    [46.5, 11.5, 46.51, 11.51, NaN, 11.52, 46.52, 11.52, 46.53, 11.53],
    [91, 11, 46.54, 181, 46.54, Infinity],
    [46.55, 11.55, 46.56],
  ], TOKEN)!;
  expect(preview.path.match(/M/g)).toHaveLength(2);
  expect(preview.path.match(/L/g)).toHaveLength(2);
  expect(preview.isolatedPoints).toEqual([preview.start, preview.stop]);
  expect(preview.path).not.toMatch(/NaN|Infinity/);
});

it('gives a stationary recording a neighbourhood image and retains both endpoint positions', () => {
  const preview = buildStaticMapPreview([[1.3, 103.8]], TOKEN)!;
  expect(preview.start).toEqual(preview.stop);
  expect(preview.start.x).toBeCloseTo(196);
  expect(preview.start.y).toBeCloseTo(170, 1);
  expect(preview.isolatedPoints).toEqual([preview.start]);
  expect(preview.path).toBe('');
  expect(camera(preview).zoom).toBeGreaterThan(15);
  expect(camera(preview).zoom).toBeLessThan(18);
});

it('returns Grid fallback for missing configuration, unsupported geometry or an accidental raw track', () => {
  for (const token of ['', '  ', 'sk.private', 'pk.', 'pk.invalid token']) {
    expect(buildStaticMapPreview([[1, 103]], token)).toBeNull();
  }
  expect(buildStaticMapPreview([], TOKEN)).toBeNull();
  expect(buildStaticMapPreview([[NaN, 103, 1, 181, 91, 103]], TOKEN)).toBeNull();
  expect(buildStaticMapPreview([[1, 103, 86, 103]], TOKEN)).toBeNull();
  expect(buildStaticMapPreview([Array.from({ length: 4097 }, () => [1, 103]).flat()], TOKEN)).toBeNull();
});

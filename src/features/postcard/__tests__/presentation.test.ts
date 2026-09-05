import type { FlightSummary, PilotProfile } from '@/recorder/types';
import { flight as makeFlight, metrics } from '../../../../tests/support/fixtures';
import { canSharePostcard, initialPostcardDraft, postcardCaption, postcardPresentation, postcardSource } from '../presentation';

const flight = makeFlight({
  status: 'completed', sessionStatus: 'completed', startedAt: Date.UTC(2026, 8, 4, 20), endedAt: Date.UTC(2026, 8, 4, 21),
  timezoneOffsetMinutes: -480, title: 'Ridge day', site: 'Launch', siteSource: 'osm', notes: 'Private flight notes',
  metrics: metrics({ durationMs: 3_600_000, fixCount: 100, trackDistanceMetres: 12345, maxGpsAltitude: 2345 }),
});
const track = [[46, 8, 46.01, 8.02], [46.03, 8.02, 46.04, 8.05]];

it.each([
  { status: 'recording' }, { status: 'processing' }, { sessionStatus: 'recording' },
  { sessionStatus: 'interrupted' }, { metrics: null }, { endedAt: null },
] as Partial<FlightSummary>[])('rejects unfinished data: %o', (patch) => {
  expect(canSharePostcard({ ...flight, ...patch })).toBe(false);
});
it.each(['completed', 'partial'] as const)('allows %s with completed statistics', (status) => {
  expect(canSharePostcard({ ...flight, status })).toBe(true);
});
it('uses the recorded timezone, track distance, distinct site and attribution', () => {
  const source = postcardSource(flight, track);
  expect(source).toMatchObject({ title: 'Ridge day', site: 'Launch', date: 'Sat 5 Sep 2026', distance: '12.3\u00a0km', attribution: 'From OpenStreetMap (ODbL)' });
});
it('keeps gaps, proportions and partial evidence on both formats', () => {
  const source = postcardSource({ ...flight, status: 'partial' }, track);
  for (const format of ['square', 'story'] as const) {
    const model = postcardPresentation(source, { ...initialPostcardDraft(source), format });
    expect(model.labels).toEqual(['Partial flight', 'Track gaps']);
    expect(model.path.match(/M/g)).toHaveLength(2);
    expect(model.route).toBe('track');
    expect(model.height).toBe(format === 'square' ? 1080 : 1920);
  }
});
it('does not replace absent GPS with scenery, distance zero or a fake route', () => {
  const source = postcardSource({ ...flight, metrics: { ...flight.metrics!, quality: 'no_track', fixCount: 0 } }, track);
  expect(source).toMatchObject({ distance: 'Unavailable', altitude: 'Unavailable', segments: [] });
  expect(postcardPresentation(source, initialPostcardDraft(source))).toMatchObject({ route: 'unavailable', path: '' });
});
it('handles an empty stored route and stationary fixes honestly', () => {
  const empty = postcardSource(flight, []);
  expect(postcardPresentation(empty, initialPostcardDraft(empty)).route).toBe('unavailable');
  const point = postcardSource(flight, [[46, 8]]);
  expect(postcardPresentation(point, initialPostcardDraft(point)).route).toBe('point');
});
it('handles missing titles, sites, values and source names used as a title', () => {
  expect(postcardSource({ ...flight, title: null, site: null }, []).title).toBe('A day in the sky');
  const source = postcardSource({ ...flight, title: null, site: 'Launch', siteSource: 'paraglidingearth', metrics: { ...flight.metrics!, maxGpsAltitude: null, trackDistanceMetres: NaN } }, []);
  expect(source).toMatchObject({ title: 'Launch', site: null, attribution: 'From ParaglidingEarth (CC BY-SA 3.0)', altitude: 'Unavailable', distance: 'Unavailable' });
  expect(postcardSource({ ...flight, site: null }, []).attribution).toBeNull();
});
it('isolates captions and snapshots from flight notes and later mutations', () => {
  const mutable = [[46, 8, 47, 9]];
  const source = postcardSource(flight, mutable);
  mutable[0][0] = 0;
  const draft = initialPostcardDraft(source);
  expect(draft).toEqual({ scene: 'flying', format: 'square', caption: '', signature: false });
  expect(source.segments[0][0]).toBe(46);
  expect(source).not.toHaveProperty('notes');
  expect(postcardPresentation(source, { ...draft, caption: 'Lovely sky' }).caption).toBe('Lovely sky');
});
it('omits unknown pilot details and permits opting out of a saved name', () => {
  const anonymous = postcardSource(flight, []);
  expect(postcardPresentation(anonymous, { ...initialPostcardDraft(anonymous), signature: true }).signature).toBeNull();
  const named = postcardSource(flight, [], { pilotName: '  Sam  ' } as PilotProfile);
  expect(initialPostcardDraft(named).signature).toBe(true);
  expect(postcardPresentation(named, initialPostcardDraft(named)).signature).toBe('From Sam’s flight journal.');
  expect(postcardPresentation(named, { ...initialPostcardDraft(named), signature: false }).signature).toBeNull();
});
it('limits captions to 140 code points without splitting emoji', () => {
  expect(postcardCaption('🪂'.repeat(141))).toBe('🪂'.repeat(140));
});

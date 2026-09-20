import { parseFeedPage, parseSharedFlight, parseSharedReplay, parseSharingPreferences } from '../feed-validation';
import { artifact, flight } from './feed-fixtures';

it('projects only approved fields even when a server response contains private fields', () => {
  const result = parseSharedFlight({ ...flight(), notes: 'private', recordingSessionId: 'secret', author: { ...flight().author, email: 'private@test' }, metrics: { ...flight().metrics, rawSensors: ['private'] } });
  expect(result).toEqual(flight());
  expect(JSON.stringify(result)).not.toContain('private');
});
it('preserves cursor microseconds without normalizing through JS Date', () => {
  const item = flight();
  expect(parseFeedPage({ items: [item], nextCursor: { publishedAt: item.publishedAt, activityId: item.activityId } }).nextCursor?.publishedAt).toBe(item.publishedAt);
});
it('rejects duplicate cards and cursors disconnected from the page', () => {
  expect(() => parseFeedPage({ items: [flight(), flight()], nextCursor: null })).toThrow();
  expect(() => parseFeedPage({ items: [flight()], nextCursor: { activityId: flight().activityId, publishedAt: '2020-01-01' } })).toThrow();
});
it('retains nullable recorded telemetry and zero-fix artifacts without inventing values', () => {
  expect(parseSharedReplay(artifact)).toEqual(artifact);
  expect(parseSharedReplay({ ...artifact, points: [] }).points).toEqual([]);
});
it.each([
  { ...artifact, notes: 'private' },
  { ...artifact, schemaVersion: 2 },
  { ...artifact, bounds: { ...artifact.bounds, deviceId: 'secret' } },
  { ...artifact, provenance: 'igc' },
  { ...artifact, points: [artifact.points[1], artifact.points[0]] },
  { ...artifact, points: [artifact.points[0], artifact.points[0]] },
  { ...artifact, points: [{ ...artifact.points[0], latitude: 91 }] },
  { ...artifact, points: [{ ...artifact.points[0], timestamp: 999 }] },
  { ...artifact, points: [{ ...artifact.points[0], pressure: 100 }] },
])('rejects malformed or over-sharing replay %#', value => { expect(() => parseSharedReplay(value)).toThrow(); });
it('rejects enabled automatic sharing without a consent generation', () => {
  expect(() => parseSharingPreferences({ enabled: true, generation: null })).toThrow();
  expect(parseSharingPreferences({ enabled: false, generation: null })).toEqual({ enabled: false, generation: null });
});

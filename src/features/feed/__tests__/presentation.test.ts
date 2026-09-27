import { sharedFeedRows, sharedHeroSummary, sharedReplay, sharedStats, sharedStatus } from '../presentation';
import { replayArtifact, sharedFlight } from './fixtures';

it('projects only approved display fields even if a response contains unexpected private fields', () => {
  const flight = { ...sharedFlight(), notes: 'Private journal', recordingSessionId: 'secret-session',
    session: { startPower: { batteryLevel: 0.8 } }, registrationId: 'private-registration' };
  const hero = sharedHeroSummary(flight);
  expect(Object.keys(hero).sort()).toEqual(['endedAt', 'metrics', 'site', 'source', 'startedAt', 'timezoneOffsetMinutes', 'title']);
  expect(JSON.stringify(hero)).not.toMatch(/Private journal|secret-session|batteryLevel|private-registration/);
  expect(hero.source).toBe('shared');
});

it('keeps partial quality and unavailable altitude/speed explicit', () => {
  const flight = sharedFlight({ metrics: { ...sharedFlight().metrics, quality: 'partial', minGpsAltitude: null, maxGpsAltitude: null, maxGroundSpeed: null } });
  expect(sharedStatus(flight)).toMatchObject({ label: 'Partial flight', tone: 'warning' });
  expect(sharedStats(flight).filter(cell => ['Min altitude', 'Max altitude', 'Max ground speed'].includes(cell.label)).every(cell => cell.value === '—')).toBe(true);
});

it('adapts IGC replay without synthetic speed, session ownership or changed sample bounds', () => {
  const artifact = replayArtifact({ provenance: 'igc', points: replayArtifact().points.map(point => ({ ...point, speed: null })) });
  const replay = sharedReplay('shared-id', artifact);
  expect(replay).toEqual({ kind: 'available', flightId: 'shared-id', bounds: artifact.bounds, points: artifact.points, partial: false });
  expect(replay.points.every(point => point.speed === null)).toBe(true);
});

it('groups by publication in the viewer timezone while preserving the server order and flight dates', () => {
  const first = sharedFlight({ publishedAt: '2026-09-21T16:30:00Z', startedAt: Date.parse('2026-01-01T00:00:00Z'), timezoneOffsetMinutes: 480 });
  const second = sharedFlight({ activityId: 'second', publishedAt: '2026-09-21T16:00:00Z', timezoneOffsetMinutes: -600 });
  const older = sharedFlight({ activityId: 'older', publishedAt: '2026-09-21T15:59:00Z' });
  const rows = sharedFeedRows([first, second, older], { now: Date.parse('2026-09-21T17:00:00Z'), timeZone: 'Asia/Singapore' });
  expect(rows.map(row => row.heading)).toEqual(['Shared today', null, 'Shared 21 Sept 2026']);
  expect(rows.map(row => row.flight)).toEqual([first, second, older]);
  expect(rows[0].flight.startedAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
});

it('merges publication headings across page boundaries and handles daylight-saving calendar days', () => {
  const pageOne = [sharedFlight({ activityId: 'first', publishedAt: '2026-11-01T07:30:00Z' })];
  const pageTwo = [sharedFlight({ activityId: 'second', publishedAt: '2026-11-01T05:30:00Z' }),
    sharedFlight({ activityId: 'third', publishedAt: '2026-11-01T03:59:00Z' })];
  const rows = sharedFeedRows([...pageOne, ...pageTwo], { now: Date.parse('2026-11-01T08:00:00Z'), timeZone: 'America/New_York' });
  expect(rows.map(row => row.heading)).toEqual(['Shared today', null, 'Shared 31 Oct 2026']);
  expect(rows.map(row => row.flight.activityId)).toEqual(['first', 'second', 'third']);
});

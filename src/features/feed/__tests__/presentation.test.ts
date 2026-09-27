import { sharedFeedRows, sharedMeasurements, sharedReplay, sharedStats, sharedStatus } from '../presentation';
import { replayArtifact, sharedFlight } from './fixtures';

it('projects only approved display fields even if a response contains unexpected private fields', () => {
  const flight = { ...sharedFlight(), notes: 'Private journal', recordingSessionId: 'secret-session',
    session: { startPower: { batteryLevel: 0.8 } }, registrationId: 'private-registration' };
  const stats = sharedStats(flight, true);
  expect(JSON.stringify(stats)).not.toMatch(/Private journal|secret-session|batteryLevel|private-registration/);
});

it('keeps partial quality and unavailable altitude/speed explicit', () => {
  const flight = sharedFlight({ metrics: { ...sharedFlight().metrics, quality: 'partial', minGpsAltitude: null, maxGpsAltitude: null, maxGroundSpeed: null } });
  expect(sharedStatus(flight)).toMatchObject({ label: 'Partial flight', tone: 'warning' });
  expect(sharedStats(flight, true).filter(cell => ['Minimum GPS altitude', 'Maximum GPS altitude', 'Maximum ground speed'].includes(cell.label)).map(cell => cell.value)).toEqual(['—', '—', '—']);
});

it('keeps the four primary measured stats and the explicit Start/Stop expansion', () => {
  const flight = sharedFlight();
  expect(sharedStats(flight).map(cell => cell.label)).toEqual(['Recorded time', 'Track distance', 'Maximum GPS altitude', 'Maximum ground speed']);
  const extra = sharedStats(flight, true).slice(4);
  expect(extra.map(cell => cell.label)).toEqual(['Minimum GPS altitude', 'Start-to-stop straight-line distance', 'GPS fix count', 'Start', 'Stop', 'Recording timezone']);
  expect(extra.at(-1)?.value).toBe('UTC+8');
  expect(sharedStats(sharedFlight({ timezoneOffsetMinutes: null }), true).at(-1)?.value).toContain('Not captured');
});

it.each([0, 1])('does not invent distance from fewer than two fixes (%s)', fixCount => {
  const flight = sharedFlight({ routePreview: [[2.8, 101.5]], metrics: { ...sharedFlight().metrics, fixCount } });
  expect(sharedMeasurements(flight).distanceMetres).toBeNull();
  expect(sharedStats(flight, true).find(cell => cell.label === 'Start-to-stop straight-line distance')?.value).toBe('—');
  expect(sharedStatus(flight).label).toBe('No usable track');
});

it('preserves measured zero and negative GPS altitude without inferring archived point speed', () => {
  const flight = sharedFlight({ provenance: 'igc', metrics: { ...sharedFlight().metrics, trackDistanceMetres: 0, durationMs: 0,
    minGpsAltitude: -40, maxGpsAltitude: 0, maxGroundSpeed: null } });
  expect(sharedMeasurements(flight)).toMatchObject({ distanceMetres: 0, time: '0:00:00', minimumAltitude: '−40\u00a0m', maximumAltitude: '0\u00a0m', maximumSpeed: '—' });
  expect(sharedStats(flight, true).find(cell => cell.label === 'Track distance')?.value).not.toBe('—');
});

it('keeps no-track and corrupt measurements unavailable even if placeholder numbers exist', () => {
  const base = sharedFlight();
  expect(sharedMeasurements({ metrics: { ...base.metrics, quality: 'no_track' } })).toMatchObject({ distanceMetres: null, maximumAltitude: '—', maximumSpeed: '—' });
  expect(sharedMeasurements({ metrics: { ...base.metrics, durationMs: NaN, trackDistanceMetres: -1, maxGpsAltitude: Infinity, maxGroundSpeed: NaN } }))
    .toMatchObject({ time: '—', distanceMetres: null, maximumAltitude: '—', maximumSpeed: '—' });
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

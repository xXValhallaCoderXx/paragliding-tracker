import { sharedHeroSummary, sharedReplay, sharedStats, sharedStatus } from '../presentation';
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

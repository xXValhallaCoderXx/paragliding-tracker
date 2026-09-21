import type { ReplayFix } from '@/lib/replay/model';
import { publicationArtifact, recordedPublicationArtifact } from '../publication-artifact';

const fix = (timestamp: number, overrides: Partial<ReplayFix> = {}): ReplayFix => ({ sourceTimestamp: timestamp,
  sequence: timestamp, latitude: 1.3, longitude: 103.8, gpsAltitude: 120, speed: 5, mocked: false, ...overrides });
const bounds = { startedAt: 1000, endedAt: 5000 };
it('projects all normalized original fixes with recorded precision while discarding private evidence', () => {
  const input = [fix(3000), fix(1500, { speed: -1, gpsAltitude: NaN }), fix(3000, { sequence: 4000, latitude: 1.4 }),
    fix(4000, { mocked: true }), fix(6000), { ...fix(2500), pressure: 999, notes: 'private', sessionId: 'secret' }];
  expect(recordedPublicationArtifact(input, bounds, true)).toEqual({ schemaVersion: 1, provenance: 'recorded', bounds, partial: true,
    points: [
      { timestamp: 1500, latitude: 1.3, longitude: 103.8, altitude: null, speed: null },
      { timestamp: 2500, latitude: 1.3, longitude: 103.8, altitude: 120, speed: 5 },
      { timestamp: 3000, latitude: 1.4, longitude: 103.8, altitude: 120, speed: 5 },
    ] });
});
it('preserves one usable point and represents a no-track flight without inventing replay samples', () => {
  expect(recordedPublicationArtifact([fix(1500)], bounds, false).points).toHaveLength(1);
  expect(recordedPublicationArtifact([], bounds, false).points).toEqual([]);
});
it('makes restored IGC provenance explicit and never fabricates recorded ground speed', () => {
  const artifact = publicationArtifact([{ timestamp: 1000, latitude: 1, longitude: 2, altitude: null, speed: 99 }], bounds, false, 'igc');
  expect(artifact).toMatchObject({ provenance: 'igc', points: [{ speed: null }] });
});

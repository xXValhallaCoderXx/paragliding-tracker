import type { SharedFlightSummary, SharedReplayArtifactV1 } from '../feed-types';
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
export const G = '44444444-4444-4444-8444-444444444444';
export const artifact: SharedReplayArtifactV1 = { schemaVersion: 1, provenance: 'recorded', partial: false,
  bounds: { startedAt: 1000, endedAt: 4000 }, points: [
    { timestamp: 1000, latitude: 1, longitude: 2, altitude: null, speed: 3 },
    { timestamp: 4000, latitude: 1.001, longitude: 2.001, altitude: 24, speed: null },
  ] };
export function flight(activityId = A): SharedFlightSummary {
  return { activityId, author: { userId: B, displayName: 'Pilot B' }, publishedAt: '2026-09-21T01:00:00.123456+00:00',
    title: 'Evening flight', site: 'The ridge', siteSource: 'manual', startedAt: 1000, endedAt: 4000, timezoneOffsetMinutes: 480,
    status: 'completed', metrics: { durationMs: 3000, trackDistanceMetres: 140, minGpsAltitude: null, maxGpsAltitude: 24, maxGroundSpeed: 3, fixCount: 2, quality: 'healthy' },
    routePreview: [[1, 2, 1.001, 2.001]], provenance: 'recorded', replayAvailable: true,
    artifact: { generation: G, sha256: 'a'.repeat(64), byteCount: 300 }, kudos: { count: 0, givenByMe: false } };
}

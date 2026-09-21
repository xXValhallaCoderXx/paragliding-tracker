import { normalizeReplayPoints, type ReplayBounds, type ReplayFix, type ReplayPoint } from '@/lib/replay/model';
import type { SharedReplayArtifactV1 } from '@/social/feed-types';
import { parseSharedReplay } from '@/social/feed-validation';

/** Deliberate projection: identifiers, pressure, headers, diagnostics and notes cannot escape. */
export function recordedPublicationArtifact(fixes: readonly ReplayFix[], bounds: ReplayBounds, partial: boolean): SharedReplayArtifactV1 {
  return publicationArtifact(normalizeReplayPoints(fixes, bounds), bounds, partial, 'recorded');
}
export function publicationArtifact(points: readonly ReplayPoint[], bounds: ReplayBounds, partial: boolean,
  provenance: SharedReplayArtifactV1['provenance']): SharedReplayArtifactV1 {
  return parseSharedReplay({ schemaVersion: 1, provenance, bounds: { startedAt: bounds.startedAt, endedAt: bounds.endedAt }, partial,
    points: points.map(point => ({ timestamp: point.timestamp, latitude: point.latitude, longitude: point.longitude,
      altitude: point.altitude, speed: provenance === 'igc' ? null : point.speed })) });
}

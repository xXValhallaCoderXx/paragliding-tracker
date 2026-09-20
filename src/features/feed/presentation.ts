import type { FlightHeroSummary, DetailStatus } from '@/features/flights/components/hero';
import type { StatCell } from '@/features/flights/components/stat-grid';
import { formatAirtime, formatDistanceParts, formatGroundSpeed, formatMetres, formatThousands } from '@/lib/format/flight-format';
import type { FlightReplay } from '@/lib/replay/model';
import { straightLineMetres } from '@/lib/track/stats';
import type { SharedFlightSummary, SharedReplayArtifactV1 } from '@/social/feed-types';

export function sharedHeadline(flight: SharedFlightSummary): string {
  return flight.title?.trim() || flight.site?.trim() || 'A day in the sky';
}

/** Explicit projection: the reusable hero never receives a complete remote object. */
export function sharedHeroSummary(flight: SharedFlightSummary): FlightHeroSummary {
  return { source: 'shared', startedAt: flight.startedAt, endedAt: flight.endedAt,
    timezoneOffsetMinutes: flight.timezoneOffsetMinutes, title: flight.title, site: flight.site,
    metrics: { durationMs: flight.metrics.durationMs, trackDistanceMetres: flight.metrics.trackDistanceMetres,
      maxGpsAltitude: flight.metrics.maxGpsAltitude, fixCount: flight.metrics.fixCount, quality: flight.metrics.quality } };
}

export function sharedStatus(flight: SharedFlightSummary): DetailStatus {
  if (flight.status === 'partial' || flight.metrics.quality === 'partial') return { label: 'Partial flight', tone: 'warning' };
  if (flight.metrics.quality === 'no_track') return { label: 'No track', tone: 'warning' };
  if (flight.metrics.quality === 'gaps') return { label: 'Track gaps', tone: 'warning' };
  return { label: 'Shared flight', tone: 'muted' };
}

export function sharedStats(flight: SharedFlightSummary): StatCell[] {
  const distance = formatDistanceParts(flight.metrics.trackDistanceMetres);
  const straight = formatDistanceParts(straightLineMetres(flight.routePreview));
  return [flight.metrics.trackDistanceMetres > 0 ? { label: 'Airtime', value: formatAirtime(flight.metrics.durationMs) }
    : { label: 'Track distance', value: distance?.value ?? '—', unit: distance?.unit },
  { label: 'Straight line', value: straight?.value ?? '—', unit: straight?.unit },
  { label: 'Max altitude', value: formatMetres(flight.metrics.maxGpsAltitude) },
  { label: 'Min altitude', value: formatMetres(flight.metrics.minGpsAltitude) },
  { label: 'Max ground speed', value: formatGroundSpeed(flight.metrics.maxGroundSpeed) },
  { label: 'GPS fixes', value: formatThousands(flight.metrics.fixCount) }];
}

/** Renderer adapter only: no fake session, journal entry, or archive ownership. */
export function sharedReplay(activityId: string, artifact: SharedReplayArtifactV1): Extract<FlightReplay, { kind: 'available' }> {
  return { kind: 'available', flightId: activityId, bounds: artifact.bounds, points: artifact.points, partial: artifact.partial };
}

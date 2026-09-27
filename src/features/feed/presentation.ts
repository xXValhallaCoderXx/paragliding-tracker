import type { StatCell } from '@/features/flights/components/stat-grid';
import { formatAirtime, formatClockTime, formatDistance, formatGroundSpeed, formatLongDate, formatMetres, formatUtcOffset } from '@/lib/format/flight-format';
import type { FlightReplay } from '@/lib/replay/model';
import { straightLineMetres } from '@/lib/track/stats';
import { trackPointCount } from '@/lib/track/simplify';
import type { SharedFlightSummary, SharedReplayArtifactV1 } from '@/social/feed-types';

export function sharedHeadline(flight: SharedFlightSummary): string {
  return flight.title?.trim() || flight.site?.trim() || 'A day in the sky';
}

/** Publication days use the viewer's timezone; recorded dates keep the flight's timezone. */
export function sharedFeedRows(flights: readonly SharedFlightSummary[], {
  now = Date.now(), timeZone,
}: { now?: number; timeZone?: string } = {}): { flight: SharedFlightSummary; heading: string | null }[] {
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
  const today = day.format(now);
  let previousDay: string | null | undefined;
  return flights.map(flight => {
    const publishedAt = Date.parse(flight.publishedAt);
    const date = Number.isFinite(publishedAt) ? day.format(publishedAt) : null;
    const heading = date === previousDay ? null : date === today ? 'Shared today' : date ? `Shared ${date}` : 'Shared recently';
    previousDay = date;
    return { flight, heading };
  });
}

export function sharedStatus(flight: SharedFlightSummary): { label: string; tone: 'warning' | 'muted' } {
  if (flight.status === 'partial' || flight.metrics.quality === 'partial') return { label: 'Partial flight', tone: 'warning' };
  if (flight.metrics.quality === 'no_track' || flight.metrics.fixCount < 2) return { label: 'No usable track', tone: 'warning' };
  if (flight.metrics.quality === 'gaps') return { label: 'Track gaps', tone: 'warning' };
  return { label: 'Shared flight', tone: 'muted' };
}

/** Same measurement rules as the journal, without constructing a private flight/session. */
export function sharedMeasurements(flight: Pick<SharedFlightSummary, 'metrics'>) {
  const m = flight.metrics;
  const finite = (value: number | null) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const nonnegative = (value: number | null) => finite(value) !== null && value! >= 0 ? value : null;
  const fixes = Number.isSafeInteger(m.fixCount) && m.fixCount >= 0 ? m.fixCount : null;
  const usable = fixes !== null && fixes > 0 && m.quality !== 'no_track';
  const duration = nonnegative(m.durationMs);
  return {
    time: duration === null ? '—' : formatAirtime(duration),
    distanceMetres: usable && fixes >= 2 ? nonnegative(m.trackDistanceMetres) : null,
    maximumAltitude: formatMetres(usable ? finite(m.maxGpsAltitude) : null),
    minimumAltitude: formatMetres(usable ? finite(m.minGpsAltitude) : null),
    maximumSpeed: formatGroundSpeed(usable ? nonnegative(m.maxGroundSpeed) : null),
    fixCount: fixes === null ? '—' : String(fixes),
  };
}

export function sharedStats(flight: SharedFlightSummary, expanded = false): StatCell[] {
  const values = sharedMeasurements(flight);
  const offset = flight.timezoneOffsetMinutes;
  const stamp = (time: number) => Number.isFinite(time) ? `${formatLongDate(time, offset)} · ${formatClockTime(time, offset)}` : '—';
  return [
    { label: 'Recorded time', value: values.time },
    { label: 'Track distance', value: formatDistance(values.distanceMetres) },
    { label: 'Maximum GPS altitude', value: values.maximumAltitude },
    { label: 'Maximum ground speed', value: values.maximumSpeed },
    ...(expanded ? [
      { label: 'Minimum GPS altitude', value: values.minimumAltitude },
      { label: 'Start-to-stop straight-line distance', value: formatDistance(values.distanceMetres !== null && trackPointCount(flight.routePreview) >= 2 ? straightLineMetres(flight.routePreview) : null) },
      { label: 'GPS fix count', value: values.fixCount },
      { label: 'Start', value: stamp(flight.startedAt) }, { label: 'Stop', value: stamp(flight.endedAt) },
      { label: 'Recording timezone', value: offset === null ? 'Not captured · times use this device’s timezone' : formatUtcOffset(offset) },
    ] : []),
  ];
}

/** Renderer adapter only: no fake session, journal entry, or archive ownership. */
export function sharedReplay(activityId: string, artifact: SharedReplayArtifactV1): Extract<FlightReplay, { kind: 'available' }> {
  return { kind: 'available', flightId: activityId, bounds: artifact.bounds, points: artifact.points, partial: artifact.partial };
}

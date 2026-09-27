import type { FlightDetail, FlightSummary } from '@/recorder/types';
import { journalFlightMetrics, journalQualityFlags } from '@/features/logbook/journal-query';
import { isFlightProcessing } from '@/features/logbook/logbook';
import { formatAirtime, formatGroundSpeed, formatMetres } from '@/lib/format/flight-format';
import type { Coordinate } from '@/sites/types';

export function recordingCoordinate(flight: FlightSummary): Coordinate | null {
  return typeof flight.takeoffLatitude === 'number' && Number.isFinite(flight.takeoffLatitude) && Math.abs(flight.takeoffLatitude) <= 90 &&
    typeof flight.takeoffLongitude === 'number' && Number.isFinite(flight.takeoffLongitude) && Math.abs(flight.takeoffLongitude) <= 180
    ? { latitude: flight.takeoffLatitude, longitude: flight.takeoffLongitude } : null;
}
export function ownFlightAvailability(flight: FlightDetail) {
  const open = flight.sessionStatus === 'recording' || flight.sessionStatus === 'interrupted';
  const processing = !open && isFlightProcessing(flight);
  const finished = !open && !processing && flight.endedAt !== null && ['completed', 'partial'].includes(flight.status);
  const archived = flight.source === 'archive';
  const hasFile = archived ? flight.archive.downloadedAt !== null : Boolean(flight.metrics && flight.metrics.fixCount > 0 && flight.metrics.quality !== 'no_track');
  const hasTrack = archived ? hasFile : !journalQualityFlags(flight).includes('no_track');
  const reason = open ? 'Open the recorder to stop or save this flight.' : processing ? 'Wait for the saved flight to finish processing.' : 'This flight is unavailable.';
  return { open, processing, finished, archived,
    editReason: finished ? null : reason,
    replayReason: !finished ? reason : !hasTrack ? archived ? 'Download the archived route from Pilot first.' : 'At least two usable GPS fixes are needed for replay.' : null,
    igcReason: !finished ? reason : !hasFile ? archived ? 'The original archived IGC has not been downloaded.' : 'No usable GPS fixes are available to export.' : null,
    diagnostics: finished && !archived,
  };
}
export function ownFlightMetrics(flight: FlightSummary) {
  const values = journalFlightMetrics(flight);
  const metrics = !isFlightProcessing(flight) && !['recording', 'interrupted'].includes(flight.sessionStatus ?? '') ? flight.metrics : null;
  const usable = metrics && metrics.fixCount > 0 && metrics.quality !== 'no_track';
  const finite = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return { ...values,
    time: values.durationMs === null ? '—' : formatAirtime(values.durationMs),
    maximumAltitude: formatMetres(usable ? finite(metrics.maxGpsAltitude) : null),
    minimumAltitude: formatMetres(usable ? finite(metrics.minGpsAltitude) : null),
    maximumSpeed: formatGroundSpeed(usable ? finite(metrics.maxGroundSpeed) : null),
    fixCount: metrics && Number.isSafeInteger(metrics.fixCount) && metrics.fixCount >= 0 ? String(metrics.fixCount) : '—',
  };
}
/** Compare only measurements available in the local journal; never infer an account-wide best. */
export function ownFlightInsight(flight: FlightSummary, catalogue: readonly FlightSummary[]): string | null {
  const eligible = catalogue.filter(candidate => candidate.endedAt !== null && ['completed', 'partial'].includes(candidate.status));
  if (!eligible.some(candidate => candidate.id === flight.id) || eligible.length < 2) return null;
  const others = eligible.filter(candidate => candidate.id !== flight.id);
  const current = journalFlightMetrics(flight);
  const comparisons = others.map(journalFlightMetrics);
  if (current.durationMs !== null && current.durationMs > 0 && comparisons.every(value => value.durationMs !== null && value.durationMs < current.durationMs!)) {
    return 'Your longest recorded time in the locally available journal.';
  }
  if (current.distanceMetres !== null && current.distanceMetres > 0 && comparisons.every(value => value.distanceMetres !== null && value.distanceMetres < current.distanceMetres!)) {
    return 'Your longest track distance in the locally available journal.';
  }
  return null;
}

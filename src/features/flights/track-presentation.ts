import { formatClockTime, formatDistance } from '@/lib/format/flight-format';
import type { TrackPlate, TrackPlateState } from '@/lib/track/plate';
import { trackPointCount } from '@/lib/track/simplify';
import type { TrackSegments } from '@/lib/track/types';
import { isFlightProcessing } from '@/features/logbook/logbook';
import type { FlightSummary } from '@/recorder/types';

/**
 * Turning a flight into something the plate can draw.
 *
 * The split is deliberate: `src/lib/track` knows about coordinates and viewBoxes and
 * nothing else, and everything that needs a `FlightSummary` — which state the plate is in,
 * what the labels say, what a screen reader hears — lives here, beside the component and
 * still in a `.ts` that jest actually collects.
 */

export function trackPlateState(flight: FlightSummary, track: TrackSegments): TrackPlateState {
  if (flight.status === 'recording') return 'recording';
  if (isFlightProcessing(flight)) return 'processing';
  // The stored track outranks the quality verdict when the two disagree. `no_track` is a
  // judgement about whether the recording is usable evidence; a shape that exists is a
  // fact, and refusing to draw one the pilot can see would be the odder answer.
  if (trackPointCount(track) > 0) return 'ready';
  return flight.metrics?.quality === 'no_track' ? 'no_track' : 'ready';
}

/** The two moments worth naming on the plate, in the flight's own local time. */
export function trackPlateLabels(flight: FlightSummary): {
  takeoff: string | null;
  landing: string | null;
} {
  const offset = flight.timezoneOffsetMinutes;
  return {
    takeoff: `TAKEOFF ${formatClockTime(flight.startedAt, offset)}`,
    // A flight still in the air has no landing time, and inventing "now" would claim it
    // had ended.
    landing: flight.endedAt === null ? null : `LANDED ${formatClockTime(flight.endedAt, offset)}`,
  };
}

/**
 * What a screen reader says instead of the drawing.
 *
 * A polyline is invisible to assistive technology, so this has to carry the same
 * information the plate does: how far, and — when there is nothing to draw — why not.
 */
export function trackPlateAccessibilityLabel(flight: FlightSummary, plate: TrackPlate): string {
  switch (plate.kind) {
    case 'track': {
      const distance = flight.metrics?.trackDistanceMetres;
      const flown = distance ? `, ${formatDistance(distance)} flown` : '';
      const gap = plate.segmentCount > 1 ? ', with a gap in the recording' : '';
      return `Map of this flight's track${flown}${gap}`;
    }
    case 'point':
      return 'This flight recorded a single position, so there is no track to map';
    case 'empty':
      return `Map of this flight's track: ${plate.caption.toLowerCase()}`;
    case 'none':
      return '';
  }
}

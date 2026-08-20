import { isFinishedWithMetrics } from '@/features/logbook/logbook';
import { flightLocalDate } from '@/lib/format/flight-format';
import { sanitizeIgcHeaderValue } from '@/recorder/igc';
import type { FlightSummary, PilotProfile } from '@/recorder/types';

/**
 * What the Account screen shows about the pilot, as pure functions.
 *
 * Kept out of the `.tsx` because jest's `testMatch` only collects `.ts` — a rule that
 * lives in a component is a rule nothing checks. The IGC preview in particular has to be
 * tested, because it is a promise about the contents of an evidence file.
 */

const MONTHS_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

/**
 * "RG" for the avatar. Takes the first and last word so a middle name does not win, and
 * returns an empty string rather than a placeholder glyph when there is no name — the
 * card renders its unnamed state instead of a fake monogram.
 */
export function pilotInitials(profile: PilotProfile): string {
  const words = (profile.pilotName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return `${first}${last}`.toUpperCase();
}

/** The name shown beside the avatar, or a prompt when setup was skipped. */
export function identityName(profile: PilotProfile): string {
  return profile.pilotName?.trim() || 'Add your name';
}

/** The pilot's glider, or null when they have not named one. */
export function identitySubtitle(profile: PilotProfile): string | null {
  return profile.gliderType?.trim() || null;
}

export interface AccountStats {
  flightCount: number;
  airtimeMs: number;
  /** "AUG 26", or null when there are no flights to have started from. */
  sinceLabel: string | null;
}

/**
 * Totals for the identity card's stat row.
 *
 * Counts only finished flights with computed metrics, the same predicate the season card
 * uses, so the two can never disagree about how many flights this phone holds.
 */
export function accountStats(flights: FlightSummary[]): AccountStats {
  const finished = flights.filter(isFinishedWithMetrics);
  if (finished.length === 0) {
    return { flightCount: 0, airtimeMs: 0, sinceLabel: null };
  }
  const earliest = finished.reduce((oldest, flight) =>
    flight.startedAt < oldest.startedAt ? flight : oldest,
  );
  const local = flightLocalDate(earliest.startedAt, earliest.timezoneOffsetMinutes);
  return {
    flightCount: finished.length,
    airtimeMs: finished.reduce((total, flight) => total + flight.metrics.durationMs, 0),
    sinceLabel: `${MONTHS_SHORT[local.monthIndex]} ${String(local.year).slice(-2)}`,
  };
}

/**
 * The header lines an IGC exported right now would carry.
 *
 * Built from the same `sanitizeIgcHeaderValue` the emitter uses, and deliberately listing
 * only the records `buildUnsignedIgc` actually writes. If this and the file ever
 * disagree, the screen is lying about an evidence file — which is why it is tested
 * against the emitter rather than hand-maintained.
 *
 * The registration ID is absent on purpose. It is a licence or federation number, and
 * there is no IGC header that means that; `HFCIDCOMPETITIONID` means the competition
 * number assigned for a specific event, so putting a licence there would misrepresent it
 * to every tool that reads the file.
 */
export function igcHeaderPreview(profile: PilotProfile): string[] {
  const pilotName = sanitizeIgcHeaderValue(profile.pilotName) ?? 'UNSPECIFIED';
  const gliderType = sanitizeIgcHeaderValue(profile.gliderType) ?? 'PARAGLIDER';
  const gliderId = sanitizeIgcHeaderValue(profile.gliderId) ?? 'UNSPECIFIED';
  return [
    `HFPLTPILOTINCHARGE:${pilotName}`,
    `HFGTYGLIDERTYPE:${gliderType}`,
    `HFGIDGLIDERID:${gliderId}`,
  ];
}

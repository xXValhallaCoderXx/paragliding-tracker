import type { FlightSummary } from '@/recorder/types';

import { flightLocalDate, flightMonthKey, formatMonthLabel } from './flight-format';

export interface LogbookSection {
  key: string;
  title: string;
  flights: FlightSummary[];
}

export interface LogbookLayout {
  /** The single unfinished flight (recording or interrupted), pinned above the list. */
  open: FlightSummary | null;
  sections: LogbookSection[];
}

export interface SeasonSummary {
  year: number;
  airtimeMs: number;
  flightCount: number;
  longestMs: number;
  bestDistanceMetres: number;
}

function isUnfinished(flight: FlightSummary): boolean {
  return flight.sessionStatus === 'recording' || flight.sessionStatus === 'interrupted';
}

/** A finished flight whose stats exist and can be summed honestly. */
export function isFinishedWithMetrics(
  flight: FlightSummary,
): flight is FlightSummary & { metrics: NonNullable<FlightSummary['metrics']> } {
  return (
    !isUnfinished(flight) &&
    (flight.status === 'completed' || flight.status === 'partial') &&
    flight.metrics !== null
  );
}

/**
 * Splits the repository list into the pinned unfinished flight and
 * reverse-chronological month sections. The database allows at most one
 * unfinished session, but the layout tolerates more by pinning the newest.
 */
export function buildLogbookLayout(flights: FlightSummary[]): LogbookLayout {
  const ordered = [...flights].sort((left, right) => right.startedAt - left.startedAt);
  const open = ordered.find(isUnfinished) ?? null;
  const sections: LogbookSection[] = [];
  for (const flight of ordered) {
    if (flight === open) continue;
    if (isUnfinished(flight)) continue;
    const key = flightMonthKey(flight.startedAt, flight.timezoneOffsetMinutes);
    const section = sections[sections.length - 1];
    if (section && section.key === key) {
      section.flights.push(flight);
    } else {
      sections.push({
        key,
        title: formatMonthLabel(flight.startedAt, flight.timezoneOffsetMinutes),
        flights: [flight],
      });
    }
  }
  return { open, sections };
}

/**
 * Season totals derived only from finished flights with computed stats.
 * Uses the current calendar year when it has flights, otherwise the most
 * recent year that does, so the card never shows an empty season while the
 * logbook has history.
 */
export function seasonSummary(
  flights: FlightSummary[],
  currentYear: number = new Date().getFullYear(),
): SeasonSummary | null {
  const finished = flights.filter(isFinishedWithMetrics);
  if (finished.length === 0) return null;
  const years = finished.map((flight) => flightLocalDate(flight.startedAt, flight.timezoneOffsetMinutes).year);
  const year = years.includes(currentYear) ? currentYear : Math.max(...years);
  const inSeason = finished.filter(
    (flight) => flightLocalDate(flight.startedAt, flight.timezoneOffsetMinutes).year === year,
  );
  return {
    year,
    airtimeMs: inSeason.reduce((total, flight) => total + flight.metrics.durationMs, 0),
    flightCount: inSeason.length,
    longestMs: Math.max(...inSeason.map((flight) => flight.metrics.durationMs)),
    bestDistanceMetres: Math.max(...inSeason.map((flight) => flight.metrics.trackDistanceMetres)),
  };
}

export type FlightInsight =
  | { kind: 'first' }
  | { kind: 'longest' }
  | { kind: 'farthest' }
  | { kind: 'first_at_site'; site: string }
  | { kind: 'ranked_duration'; rank: number };

/**
 * One honest sentence about where a finished flight sits in the local
 * logbook. Only ever compares against flights recorded on this phone.
 */
export function flightInsight(
  flight: FlightSummary,
  allFlights: FlightSummary[],
): FlightInsight | null {
  if (!isFinishedWithMetrics(flight)) return null;
  const others = allFlights
    .filter(isFinishedWithMetrics)
    .filter((candidate) => candidate.id !== flight.id);
  if (others.length === 0) return { kind: 'first' };

  const duration = flight.metrics.durationMs;
  const distance = flight.metrics.trackDistanceMetres;
  const longerOthers = others.filter((other) => other.metrics.durationMs >= duration).length;
  if (duration > 0 && longerOthers === 0) return { kind: 'longest' };
  const fartherOthers = others.filter((other) => other.metrics.trackDistanceMetres >= distance).length;
  if (distance > 0 && fartherOthers === 0) return { kind: 'farthest' };

  const site = flight.site?.trim();
  if (site) {
    const sameSite = others.some(
      (other) => other.site?.trim().toLowerCase() === site.toLowerCase(),
    );
    if (!sameSite) return { kind: 'first_at_site', site };
  }

  const rank = longerOthers + 1;
  if (duration > 0 && rank <= 3) return { kind: 'ranked_duration', rank };
  return null;
}

export function flightInsightText(insight: FlightInsight): string {
  switch (insight.kind) {
    case 'first':
      return 'Your first flight in this logbook.';
    case 'longest':
      return 'Your longest flight in this logbook so far.';
    case 'farthest':
      return 'Your farthest track in this logbook so far.';
    case 'first_at_site':
      return `Your first logged flight from ${insight.site}.`;
    case 'ranked_duration':
      return `Your ${insight.rank === 2 ? 'second' : 'third'}-longest flight in this logbook.`;
  }
}

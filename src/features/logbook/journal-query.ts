import type { EquipmentSnapshot, Sport } from '@/equipment/types';
import { flightLocalDate, flightMonthKey, formatLongDate, formatMonthLabel } from '@/lib/format/flight-format';
import type { FlightSummary } from '@/recorder/types';
import type { JournalCriteria, JournalQuality, JournalSort } from '@/journal/criteria';

export type { JournalCriteria, JournalQuality, JournalSort } from '@/journal/criteria';
export { defaultJournalCriteria } from '@/journal/criteria';
export interface JournalFacetOption { value: string; label: string }
export interface JournalFacets {
  sites: JournalFacetOption[];
  sports: JournalFacetOption[];
  aircraft: JournalFacetOption[];
  years: JournalFacetOption[];
  qualities: JournalFacetOption[];
}
export interface JournalSummary {
  flightCount: number;
  recordedTimeMs: number | null;
  longestMs: number | null;
  longestDistanceMetres: number | null;
  timeCount: number;
  distanceCount: number;
}
export interface JournalSection { key: string; title: string; flights: FlightSummary[] }
export interface JournalResult {
  open: FlightSummary | null;
  flights: FlightSummary[];
  sections: JournalSection[];
  facets: JournalFacets;
  summary: JournalSummary;
  totalCount: number;
  matchedCount: number;
}
export type JournalFilterCategory = 'sites' | 'sports' | 'aircraft' | 'year' | 'qualities';
export interface JournalFilterChip { category: JournalFilterCategory; value: string; label: string }
export const JOURNAL_SORT_OPTIONS: readonly { value: JournalSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
  { value: 'duration', label: 'Longest recorded time' }, { value: 'distance', label: 'Longest track distance' },
];
const SPORT_LABELS: Record<Sport, string> = { paragliding: 'Paragliding', hang_gliding: 'Hang gliding', speedflying: 'Speedflying' };
const QUALITY_LABELS: Record<JournalQuality, string> = {
  healthy: 'Good track', gaps: 'Track gaps', partial: 'Partial', no_track: 'No usable track', unknown: 'Stats pending/unavailable',
};
const qualityOrder: JournalQuality[] = ['healthy', 'gaps', 'partial', 'no_track', 'unknown'];
const cleanText = (value: string) => value.trim().replace(/\s+/g, ' ');
const alphabetical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const newest = (left: FlightSummary, right: FlightSummary) => right.startedAt - left.startedAt || alphabetical(left.id, right.id);
const unfinished = (flight: FlightSummary) => flight.sessionStatus === 'recording' || flight.sessionStatus === 'interrupted';
const finished = (flight: FlightSummary) => !unfinished(flight) && (flight.status === 'completed' || flight.status === 'partial');
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const usableFixCount = (flight: FlightSummary) => Number.isSafeInteger(flight.metrics?.fixCount) && flight.metrics!.fixCount >= 2;

/** Persisted statistics only. Elapsed-time guesses and a one-point route are not measurements. */
export function journalFlightMetrics(flight: FlightSummary): { durationMs: number | null; distanceMetres: number | null } {
  const metrics = finished(flight) ? flight.metrics : null;
  return {
    durationMs: validNumber(metrics?.durationMs) ? metrics.durationMs : null,
    distanceMetres: metrics && metrics.quality !== 'no_track' && usableFixCount(flight) && validNumber(metrics.trackDistanceMetres) ? metrics.trackDistanceMetres : null,
  };
}

/** Partial and no usable track may overlap; a good-track badge cannot contradict either. */
export function journalQualityFlags(flight: FlightSummary): JournalQuality[] {
  if (!finished(flight)) return ['unknown'];
  if (!flight.metrics) return flight.status === 'partial' ? ['partial', 'unknown'] : ['unknown'];
  const partial = flight.status === 'partial' || flight.metrics.quality === 'partial';
  const noTrack = flight.metrics.quality === 'no_track' || !usableFixCount(flight);
  const result: JournalQuality[] = [];
  if (partial) result.push('partial');
  if (noTrack) result.push('no_track');
  if (flight.metrics.quality === 'gaps') result.push('gaps');
  if (!partial && !noTrack && flight.metrics.quality === 'healthy') result.push('healthy');
  return result.length ? result : ['unknown'];
}

export function journalQualityExplanation(flight: FlightSummary): string | null {
  const flags = journalQualityFlags(flight);
  const notes: string[] = [];
  if (flags.includes('partial')) notes.push('This is a partial recording. Recorded time describes the saved recording, not detected airtime.');
  if (flags.includes('unknown')) notes.push(flight.source !== 'archive' && flight.endedAt !== null
    ? 'Stats are still being prepared. Available measurements will appear when processing finishes.'
    : 'Saved statistics are unavailable for this flight.');
  if (flags.includes('gaps')) notes.push('The track has gaps. Its route and distance may be incomplete.');
  if (flags.includes('no_track')) notes.push('There is no usable track. Track distance is unavailable.');
  return notes.length ? notes.join(' ') : null;
}

function siteKey(flight: FlightSummary): string {
  const name = flight.site && cleanText(flight.site);
  return name ? `site:${name.toLowerCase()}` : 'unknown';
}
function sportKey(flight: FlightSummary): string { return flight.equipmentSnapshot?.sport ?? 'unknown'; }
function aircraftKey(flight: FlightSummary): string {
  return !flight.equipmentSnapshot ? 'unknown' : flight.equipmentSnapshot.aircraftId ?? 'none';
}
function fallbackLabel(category: JournalFilterCategory, value: string): string {
  if (category === 'year') return value;
  if (category === 'sites') return value === 'unknown' ? 'Unnamed site' : value.startsWith('site:') ? value.slice(5) : 'Unavailable site';
  if (category === 'sports') return value === 'unknown' ? 'Unknown sport' : SPORT_LABELS[value as Sport] ?? 'Unavailable sport';
  if (category === 'aircraft') return value === 'unknown' ? 'Unknown aircraft' : value === 'none' ? 'No aircraft selected' : 'Unavailable aircraft';
  return QUALITY_LABELS[value as JournalQuality] ?? 'Unavailable quality';
}
function options(values: Map<string, string>, selected: readonly string[], category: JournalFilterCategory): JournalFacetOption[] {
  for (const value of selected) if (!values.has(value)) values.set(value, fallbackLabel(category, value));
  return [...values].map(([value, label]) => ({ value, label }))
    .sort((left, right) => alphabetical(left.label.toLowerCase(), right.label.toLowerCase()) || alphabetical(left.value, right.value));
}

function aircraftOptions(saved: readonly FlightSummary[], selected: readonly string[]): JournalFacetOption[] {
  const snapshots = new Map<string, EquipmentSnapshot>();
  const latest = new Map<string, FlightSummary>();
  const labels = new Map<string, string>();
  // saved is newest-first, so later inventory edits never relabel historical snapshots.
  for (const flight of saved) {
    const id = aircraftKey(flight);
    if (labels.has(id)) continue;
    const snapshot = flight.equipmentSnapshot;
    labels.set(id, snapshot?.aircraftId ? cleanText(snapshot.model ?? '') || 'Unnamed aircraft' : fallbackLabel('aircraft', id));
    if (snapshot?.aircraftId) { snapshots.set(id, snapshot); latest.set(id, flight); }
  }
  const counts = (values: Map<string, string>) => {
    const result = new Map<string, number>();
    for (const label of values.values()) result.set(label.toLowerCase(), (result.get(label.toLowerCase()) ?? 0) + 1);
    return result;
  };
  const names = new Map(labels);
  const nameCounts = counts(names);
  for (const [id, snapshot] of snapshots) {
    if (nameCounts.get(names.get(id)!.toLowerCase()) === 1) continue;
    labels.set(id, [names.get(id), snapshot.sport && SPORT_LABELS[snapshot.sport], snapshot.size, snapshot.registrationId].filter(Boolean).join(' · '));
  }
  const details = new Map(labels);
  const detailCounts = counts(details);
  for (const id of snapshots.keys()) if (detailCounts.get(details.get(id)!.toLowerCase())! > 1) {
    const flight = latest.get(id)!;
    labels.set(id, `${details.get(id)} · Last recorded ${formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes)}`);
  }
  const dated = new Map(labels);
  const groups = new Map<string, string[]>();
  for (const id of snapshots.keys()) {
    const key = dated.get(id)!.toLowerCase();
    const group = groups.get(key);
    if (group) group.push(id);
    else groups.set(key, [id]);
  }
  // Identical saved details and dates are legal. Use stable ordinals without exposing storage identifiers.
  for (const group of groups.values()) if (group.length > 1) group.sort(alphabetical).forEach((id, index) => {
    labels.set(id, `${dated.get(id)} · Aircraft ${index + 1}`);
  });
  return options(labels, selected, 'aircraft');
}

function buildFacets(saved: readonly FlightSummary[], criteria: JournalCriteria, currentYear?: number): JournalFacets {
  const sites = new Map<string, string>();
  const sports = new Map<string, string>();
  const years = new Map<string, string>();
  const qualities = new Map<string, string>();
  for (const flight of saved) {
    const site = siteKey(flight);
    if (!sites.has(site)) sites.set(site, site === 'unknown' ? 'Unnamed site' : cleanText(flight.site!));
    const sport = sportKey(flight);
    sports.set(sport, fallbackLabel('sports', sport));
    const year = String(flightLocalDate(flight.startedAt, flight.timezoneOffsetMinutes).year);
    years.set(year, year);
    for (const quality of journalQualityFlags(flight)) qualities.set(quality, QUALITY_LABELS[quality]);
  }
  if (currentYear !== undefined && Number.isInteger(currentYear)) years.set(String(currentYear), String(currentYear));
  return {
    sites: options(sites, criteria.sites, 'sites'), sports: options(sports, criteria.sports, 'sports'),
    aircraft: aircraftOptions(saved, criteria.aircraft),
    years: options(years, criteria.year === null ? [] : [String(criteria.year)], 'year').sort((left, right) => Number(right.value) - Number(left.value)),
    qualities: options(qualities, criteria.qualities, 'qualities').sort((left, right) => qualityOrder.indexOf(left.value as JournalQuality) - qualityOrder.indexOf(right.value as JournalQuality)),
  };
}

function summary(flights: readonly FlightSummary[]): JournalSummary {
  const result: JournalSummary = { flightCount: flights.length, recordedTimeMs: null, longestMs: null, longestDistanceMetres: null, timeCount: 0, distanceCount: 0 };
  for (const flight of flights) {
    const { durationMs, distanceMetres } = journalFlightMetrics(flight);
    if (durationMs !== null) {
      result.timeCount += 1;
      result.recordedTimeMs = (result.recordedTimeMs ?? 0) + durationMs;
      result.longestMs = Math.max(result.longestMs ?? 0, durationMs);
    }
    if (distanceMetres !== null) {
      result.distanceCount += 1;
      result.longestDistanceMetres = Math.max(result.longestDistanceMetres ?? 0, distanceMetres);
    }
  }
  return result;
}
function compareMetric(left: number | null, right: number | null): number {
  return left === null ? right === null ? 0 : 1 : right === null ? -1 : right - left;
}
function sections(flights: FlightSummary[], sort: JournalSort): JournalSection[] {
  if (!flights.length) return [];
  if (sort === 'duration' || sort === 'distance') return [{ key: sort, title: JOURNAL_SORT_OPTIONS.find(option => option.value === sort)!.label, flights }];
  const result: JournalSection[] = [];
  for (const flight of flights) {
    const month = flightMonthKey(flight.startedAt, flight.timezoneOffsetMinutes);
    const previous = result.at(-1);
    if (previous?.key.startsWith(`${month}:`)) previous.flights.push(flight);
    // UTC ordering can revisit a local month across timezone boundaries. Keep order and unique section keys.
    else result.push({ key: `${month}:${result.length}`, title: formatMonthLabel(flight.startedAt, flight.timezoneOffsetMinutes), flights: [flight] });
  }
  return result;
}

/** One complete, already-visible catalogue in; no pagination, storage, network, or derived measurements. */
export function selectJournal(flights: readonly FlightSummary[], criteria: JournalCriteria, currentYear?: number): JournalResult {
  const ordered = [...flights].sort(newest);
  const open = ordered.find(unfinished) ?? null;
  const saved = ordered.filter(flight => !unfinished(flight));
  const sites = new Set(criteria.sites), sports = new Set(criteria.sports), aircraft = new Set(criteria.aircraft), qualities = new Set(criteria.qualities);
  const matching = saved.filter(flight => (!sites.size || sites.has(siteKey(flight))) &&
    (!sports.size || sports.has(sportKey(flight))) && (!aircraft.size || aircraft.has(aircraftKey(flight))) &&
    (criteria.year === null || flightLocalDate(flight.startedAt, flight.timezoneOffsetMinutes).year === criteria.year) &&
    (!qualities.size || journalQualityFlags(flight).some(value => qualities.has(value))));
  matching.sort((left, right) => {
    if (criteria.sort === 'oldest') return left.startedAt - right.startedAt || alphabetical(left.id, right.id);
    if (criteria.sort === 'newest') return newest(left, right);
    const a = journalFlightMetrics(left), b = journalFlightMetrics(right);
    return compareMetric(criteria.sort === 'duration' ? a.durationMs : a.distanceMetres,
      criteria.sort === 'duration' ? b.durationMs : b.distanceMetres) || newest(left, right);
  });
  return { open, flights: matching, sections: sections(matching, criteria.sort), facets: buildFacets(saved, criteria, currentYear),
    summary: summary(matching), totalCount: saved.length, matchedCount: matching.length };
}

export function activeFilterCount(criteria: JournalCriteria): number {
  return [criteria.sites, criteria.sports, criteria.aircraft, criteria.qualities].filter(values => values.length > 0).length +
    (criteria.year === null ? 0 : 1);
}
export function journalFilterChips(criteria: JournalCriteria, facets: JournalFacets): JournalFilterChip[] {
  const chips: JournalFilterChip[] = [];
  for (const category of ['sites', 'sports', 'aircraft', 'year', 'qualities'] as const) {
    const values = category === 'year' ? criteria.year === null ? [] : [String(criteria.year)] : criteria[category];
    const choices = category === 'year' ? facets.years : facets[category];
    for (const value of new Set(values)) chips.push({ category, value,
      label: choices.find(option => option.value === value)?.label ?? fallbackLabel(category, value) });
  }
  return chips;
}
export function removeJournalFilter(criteria: JournalCriteria, chip: Pick<JournalFilterChip, 'category' | 'value'>): JournalCriteria {
  return chip.category === 'year'
    ? { ...criteria, year: criteria.year !== null && String(criteria.year) === chip.value ? null : criteria.year }
    : { ...criteria, [chip.category]: criteria[chip.category].filter(value => value !== chip.value) };
}

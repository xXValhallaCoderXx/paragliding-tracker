import type { TrackQuality } from '@/recorder/types';

const NBSP = '\u00A0';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface FlightLocalDate {
  year: number;
  monthIndex: number;
  day: number;
  weekdayIndex: number;
  hours: number;
  minutes: number;
}

/**
 * Breaks a timestamp into calendar fields in the timezone the flight was
 * recorded in. `timezoneOffsetMinutes` follows `Date#getTimezoneOffset`
 * (minutes behind UTC, so UTC+7 is -420). When it is unknown, the phone's
 * current timezone is used.
 */
export function flightLocalDate(
  timestamp: number,
  timezoneOffsetMinutes: number | null,
): FlightLocalDate {
  if (timezoneOffsetMinutes === null || !Number.isFinite(timezoneOffsetMinutes)) {
    const local = new Date(timestamp);
    return {
      year: local.getFullYear(),
      monthIndex: local.getMonth(),
      day: local.getDate(),
      weekdayIndex: local.getDay(),
      hours: local.getHours(),
      minutes: local.getMinutes(),
    };
  }
  const shifted = new Date(timestamp - timezoneOffsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekdayIndex: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatClockTime(timestamp: number, timezoneOffsetMinutes: number | null): string {
  const local = flightLocalDate(timestamp, timezoneOffsetMinutes);
  return `${two(local.hours)}:${two(local.minutes)}`;
}

/** "Sun 16 Aug" */
export function formatDayLabel(timestamp: number, timezoneOffsetMinutes: number | null): string {
  const local = flightLocalDate(timestamp, timezoneOffsetMinutes);
  return `${WEEKDAYS[local.weekdayIndex]!.slice(0, 3)} ${local.day} ${MONTHS[local.monthIndex]!.slice(0, 3)}`;
}

/** "Sun 16 Aug 2026" */
export function formatLongDate(timestamp: number, timezoneOffsetMinutes: number | null): string {
  const local = flightLocalDate(timestamp, timezoneOffsetMinutes);
  return `${formatDayLabel(timestamp, timezoneOffsetMinutes)} ${local.year}`;
}

/** "August 2026" */
export function formatMonthLabel(timestamp: number, timezoneOffsetMinutes: number | null): string {
  const local = flightLocalDate(timestamp, timezoneOffsetMinutes);
  return `${MONTHS[local.monthIndex]} ${local.year}`;
}

/** Stable key for grouping flights by their local month, e.g. "2026-08". */
export function flightMonthKey(timestamp: number, timezoneOffsetMinutes: number | null): string {
  const local = flightLocalDate(timestamp, timezoneOffsetMinutes);
  return `${local.year}-${two(local.monthIndex + 1)}`;
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export function partOfDay(timestamp: number, timezoneOffsetMinutes: number | null): PartOfDay {
  const { hours } = flightLocalDate(timestamp, timezoneOffsetMinutes);
  if (hours >= 5 && hours < 12) return 'morning';
  if (hours >= 12 && hours < 17) return 'afternoon';
  if (hours >= 17 && hours < 21) return 'evening';
  return 'night';
}

/** "Sunday afternoon" */
export function formatDayPartLabel(
  timestamp: number,
  timezoneOffsetMinutes: number | null,
): string {
  const local = flightLocalDate(timestamp, timezoneOffsetMinutes);
  return `${WEEKDAYS[local.weekdayIndex]} ${partOfDay(timestamp, timezoneOffsetMinutes)}`;
}

/** "UTC+7", "UTC+5:30", "UTC−3", "UTC" */
export function formatUtcOffset(timezoneOffsetMinutes: number): string {
  const aheadMinutes = -timezoneOffsetMinutes;
  if (aheadMinutes === 0) return 'UTC';
  const sign = aheadMinutes > 0 ? '+' : '−';
  const absolute = Math.abs(aheadMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `UTC${sign}${hours}${minutes ? `:${two(minutes)}` : ''}`;
}

export function utcOffsetDiffersFromDevice(
  timezoneOffsetMinutes: number | null,
  deviceOffsetMinutes: number = new Date().getTimezoneOffset(),
): boolean {
  return timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== deviceOffsetMinutes;
}

function splitDuration(durationMs: number): { hours: number; minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

/** "3:12:04" — hours are not zero-padded, minutes and seconds are. */
export function formatAirtime(durationMs: number): string {
  const { hours, minutes, seconds } = splitDuration(durationMs);
  return `${hours}:${two(minutes)}:${two(seconds)}`;
}

/** "3:12" — hours:minutes for cards and season totals. */
export function formatAirtimeShort(durationMs: number): string {
  const { hours, minutes } = splitDuration(durationMs);
  return `${hours}:${two(minutes)}`;
}

/** "3 h 12", "48 min", "2 h" — for prose. */
export function formatAirtimeWords(durationMs: number): string {
  const { hours, minutes } = splitDuration(durationMs);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${two(minutes)}`;
}

/** Legacy zero-padded "03:12:04" form kept for diagnostics-style output. */
export function formatDuration(durationMs: number): string {
  const { hours, minutes, seconds } = splitDuration(durationMs);
  return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

/** Thin-space thousands: 11486 → "11 486" (non-breaking). */
export function formatThousands(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '−' : '';
  const digits = String(Math.abs(rounded));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return `${sign}${groups.join(NBSP)}`;
}

export interface DistanceParts {
  value: string;
  unit: 'km' | 'm';
}

export function formatDistanceParts(metres: number | null): DistanceParts | null {
  if (metres === null || !Number.isFinite(metres) || metres < 0) return null;
  if (metres < 1_000) return { value: formatThousands(metres), unit: 'm' };
  return { value: (metres / 1_000).toFixed(1), unit: 'km' };
}

export function formatDistance(metres: number | null): string {
  const parts = formatDistanceParts(metres);
  return parts ? `${parts.value}${NBSP}${parts.unit}` : '—';
}

export function formatMetres(metres: number | null): string {
  return metres === null || !Number.isFinite(metres) ? '—' : `${formatThousands(metres)}${NBSP}m`;
}

export const formatAltitude = formatMetres;

export function formatGroundSpeed(metresPerSecond: number | null): string {
  return metresPerSecond === null || !Number.isFinite(metresPerSecond)
    ? '—'
    : `${Math.round(metresPerSecond * 3.6)}${NBSP}km/h`;
}

export function formatAccuracy(metres: number | null): string {
  return metres === null || !Number.isFinite(metres) ? '—' : `±${Math.round(metres)}${NBSP}m`;
}

export function formatGap(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—';
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}${NBSP}ms`
    : `${(milliseconds / 1_000).toFixed(1)}${NBSP}s`;
}

/** Battery level as reported by expo-battery (0..1). */
export function formatBattery(level: number | null): string | null {
  if (level === null || !Number.isFinite(level) || level < 0) return null;
  return `${Math.round(level * 100)}%`;
}

export function formatFlightDate(
  startedAt: number,
  timezoneOffsetMinutes: number | null,
  includeTime = true,
): string {
  const date = formatLongDate(startedAt, timezoneOffsetMinutes);
  return includeTime ? `${date} · ${formatClockTime(startedAt, timezoneOffsetMinutes)}` : date;
}

export function qualityLabel(quality: TrackQuality): string {
  switch (quality) {
    case 'healthy':
      return 'Good track';
    case 'gaps':
      return 'Track has gaps';
    case 'partial':
      return 'Partial flight';
    case 'no_track':
      return 'No usable track';
  }
}

export function flightDisplayName(title: string | null, site: string | null): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) return trimmedTitle;
  const trimmedSite = site?.trim();
  if (trimmedSite) return trimmedSite;
  return 'Untitled flight';
}

/**
 * Card/detail headline: the pilot's title, else the site, else a calm
 * time-based name such as "Sunday afternoon flight".
 */
export function flightHeadline(flight: {
  title: string | null;
  site: string | null;
  startedAt: number;
  timezoneOffsetMinutes: number | null;
}): string {
  const trimmedTitle = flight.title?.trim();
  if (trimmedTitle) return trimmedTitle;
  const trimmedSite = flight.site?.trim();
  if (trimmedSite) return trimmedSite;
  return `${formatDayPartLabel(flight.startedAt, flight.timezoneOffsetMinutes)} flight`;
}

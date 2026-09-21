import type { ReplayBounds, ReplayPoint } from '@/lib/replay/model';

const DAY_MS = 86_400_000;
/** A resource limit for a downloaded artifact, not a flight-duration limit. */
export const MAX_ARCHIVED_IGC_BYTES = 25 * 1024 * 1024;

export class ArchivedIgcError extends Error {
  constructor(readonly code: 'too_large' | 'invalid_format' | 'invalid_date' | 'invalid_fix' | 'invalid_timing', message: string) {
    super(message);
    this.name = 'ArchivedIgcError';
  }
}

export interface ParsedArchivedIgc {
  points: ReplayPoint[];
  /** The archived samples' extent; the cloud summary retains the original flight times. */
  bounds: ReplayBounds | null;
}

function fail(code: ArchivedIgcError['code'], message: string): never {
  throw new ArchivedIgcError(code, message);
}

function ascii(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_ARCHIVED_IGC_BYTES) fail('too_large', 'The archived IGC is too large to open.');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    const chunk = bytes.subarray(offset, offset + 4096);
    for (const byte of chunk) {
      if (byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) {
        fail('invalid_format', 'The archived IGC contains invalid text.');
      }
    }
    chunks.push(String.fromCharCode(...chunk));
  }
  return chunks.join('');
}

function firstDay(date: string, bounds: ReplayBounds): number {
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const shortYear = Number(date.slice(4, 6));
  const startYear = new Date(bounds.startedAt).getUTCFullYear();
  const endYear = new Date(bounds.endedAt).getUTCFullYear();
  const candidates = new Set<number>();
  for (const reference of [startYear, endYear]) {
    for (const delta of [-100, 0, 100]) {
      const year = Math.floor(reference / 100) * 100 + shortYear + delta;
      const timestamp = Date.UTC(year, month - 1, day);
      const parsed = new Date(timestamp);
      if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) continue;
      if (timestamp <= bounds.endedAt && timestamp + DAY_MS > bounds.startedAt) candidates.add(timestamp);
    }
  }
  if (candidates.size !== 1) fail('invalid_date', 'The archived IGC date does not match this flight.');
  return [...candidates][0]!;
}

function coordinate(degrees: string, minutes: string, hemisphere: string, limit: number): number {
  const whole = Number(degrees);
  const fraction = Number(minutes);
  if (fraction >= 60_000 || whole > limit || (whole === limit && fraction !== 0)) {
    fail('invalid_fix', 'The archived IGC contains an invalid position.');
  }
  const value = whole + fraction / 60_000;
  return hemisphere === 'S' || hemisphere === 'W' ? -value : value;
}

/**
 * Reads the app's archived HFDTE/B-record format, not arbitrary third-party flight files.
 * Never fabricates recorder sessions, speed, pressure measurements or sub-second precision.
 * Callers verify the original artifact hash before trusting or storing these derived points.
 */
export function parseArchivedIgc(bytes: Uint8Array, cloudBounds: ReplayBounds): ParsedArchivedIgc {
  if (!Number.isFinite(cloudBounds.startedAt) || !Number.isFinite(cloudBounds.endedAt) ||
      !Number.isFinite(new Date(cloudBounds.startedAt).getTime()) ||
      !Number.isFinite(new Date(cloudBounds.endedAt).getTime()) || cloudBounds.endedAt < cloudBounds.startedAt) {
    fail('invalid_timing', 'This flight has invalid archived start or end times.');
  }
  // The writer discards milliseconds; a sample may legitimately precede startedAt by <1s.
  const allowed = {
    startedAt: Math.floor(cloudBounds.startedAt / 1000) * 1000,
    endedAt: Math.floor(cloudBounds.endedAt / 1000) * 1000,
  };
  const lines = ascii(bytes).split(/\r?\n/).filter((line) => line.length > 0);
  if (!/^AXCL[A-Z0-9]{6}$/.test(lines[0] ?? '')) fail('invalid_format', 'This is not a supported Flight Log Alpha archive.');
  const dates = lines.filter((line) => line.startsWith('HFDTE'));
  const date = dates[0]?.match(/^HFDTE(?:DATE:)?(\d{6})(?:,\d{2})?$/)?.[1];
  if (dates.length !== 1 || !date) fail('invalid_date', 'The archived IGC has no single valid UTC date.');
  let day = firstDay(date, allowed);
  let previous: number | null = null;
  const points: ReplayPoint[] = [];
  let recordCount = 0;
  for (const line of lines) {
    if (!line.startsWith('B')) continue;
    recordCount += 1;
    const fields = line.match(/^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{5})([NS])(\d{3})(\d{5})([EW])([AV])(-\d{4}|\d{5})(-\d{4}|\d{5})(?:\d{3})?$/);
    if (!fields) fail('invalid_fix', `Archived IGC position ${recordCount} is malformed.`);
    const [, hours, minutes, seconds, latDegrees, latMinutes, northSouth, lonDegrees, lonMinutes, eastWest, validity, , altitude] = fields;
    const h = Number(hours), m = Number(minutes), s = Number(seconds);
    if (h > 23 || m > 59 || s > 59) fail('invalid_timing', 'The archived IGC contains an invalid UTC time.');
    const latitude = coordinate(latDegrees!, latMinutes!, northSouth!, 90);
    const longitude = coordinate(lonDegrees!, lonMinutes!, eastWest!, 180);
    let timestamp = day + (h * 3600 + m * 60 + s) * 1000;
    if (previous !== null && timestamp < previous) {
      day += DAY_MS;
      timestamp += DAY_MS;
    }
    if (timestamp < allowed.startedAt || timestamp > allowed.endedAt || timestamp === previous) {
      fail('invalid_timing', 'The archived IGC positions do not match this flight’s time window.');
    }
    previous = timestamp;
    if (validity === 'A') points.push({ timestamp, latitude, longitude, altitude: Number(altitude), speed: null });
  }
  if (recordCount === 0) fail('invalid_format', 'The archived IGC contains no position records.');
  // The first fix is anchored by HFDTE. A whole missing day before a later fix is
  // ambiguous only if the remainder of the reconstructed track also fits one day later.
  if (recordCount > 1 && previous! + DAY_MS <= allowed.endedAt) {
    fail('invalid_timing', 'The archived IGC has an ambiguous date gap.');
  }
  return {
    points,
    bounds: points.length ? { startedAt: points[0]!.timestamp, endedAt: points.at(-1)!.timestamp } : null,
  };
}

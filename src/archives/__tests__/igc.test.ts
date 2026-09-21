import { buildUnsignedIgc } from '@/recorder/igc';
import type { LocationFixRecord } from '@/recorder/types';
import { ArchivedIgcError, MAX_ARCHIVED_IGC_BYTES, parseArchivedIgc } from '../igc';

const start = Date.UTC(2026, 8, 20, 23, 59, 59, 800);
const end = start + 20_400;
const bytes = (text: string) => new TextEncoder().encode(text);
const fix = (sourceTimestamp: number, sequence: number, extra: Partial<LocationFixRecord> = {}): LocationFixRecord => ({
  sessionId: 'archive-session', sequence, sourceTimestamp, receiptTimestamp: sourceTimestamp + 50,
  callbackId: 'callback', batchIndex: 0, latitude: -33.8651432, longitude: 151.2099012,
  gpsAltitude: -5.2, horizontalAccuracy: 12, verticalAccuracy: null, speed: 18, heading: null,
  mocked: false, ...extra,
});
const content = (fixes = [fix(start, 1), fix(end, 2)]) => buildUnsignedIgc({ id: 'archive-session', startedAt: start, endedAt: end }, fixes).content;

it('reads the writer format across UTC midnight without pretending to restore lost precision or speed', () => {
  const original = bytes(content([fix(start, 1), fix(start + 50, 2), fix(end, 3)]));
  const retained = original.slice();
  const result = parseArchivedIgc(original, { startedAt: start, endedAt: end });
  expect(original).toEqual(retained);
  expect(result.bounds).toEqual({ startedAt: start - 800, endedAt: end - 200 });
  expect(result.points).toHaveLength(2);
  expect(result.points[0]).toMatchObject({ altitude: -5, speed: null });
  expect(result.points[0]!.latitude).toBeCloseTo(-33.86515, 7);
  expect(result.points[0]!.longitude).toBeCloseTo(151.2099, 7);
});

it.each([
  [Date.UTC(2024, 1, 29, 23, 59, 59), Date.UTC(2024, 2, 1, 0, 0, 1)],
  [Date.UTC(2099, 11, 31, 23, 59, 59), Date.UTC(2100, 0, 1, 0, 0, 1)],
])('resolves calendar rollover from the archived first-fix date and cloud interval', (startedAt, endedAt) => {
  const archive = buildUnsignedIgc({ id: 'calendar', startedAt, endedAt }, [fix(startedAt, 1), fix(endedAt, 2)]);
  expect(parseArchivedIgc(bytes(archive.content), { startedAt, endedAt }).points.map((point) => point.timestamp)).toEqual([startedAt, endedAt]);
});

it('uses the first exported fix date even when recording started on the preceding UTC date', () => {
  const first = Date.UTC(2026, 8, 21, 0, 0, 1);
  const result = parseArchivedIgc(bytes(content([fix(first, 1), fix(end, 2)])), { startedAt: start, endedAt: end });
  expect(result.bounds!.startedAt).toBe(first);
});

it.each([
  (text: string) => text.replace('HFDTE200926', 'HFDTE310226'),
  (text: string) => text.replace('HFDTE200926', 'HFDTE200926\r\nHFDTE200926'),
  (text: string) => text.replace('B235959', 'B246000'),
  (text: string) => text.replace('3351909S', '3360000S'),
  (text: string) => text.replace('15112594E', '18112594E'),
  (text: string) => text.replace(/^B[^\r\n]+/m, 'Btruncated'),
  (text: string) => text.replace(/^B[^\r\n]+/m, (line) => `${line}\r\n${line}`),
  (text: string) => text.replace('B000020', 'B235958'),
])('rejects malformed dates, coordinates, truncated records and invalid chronology', (damage) => {
  const original = content();
  const damaged = damage(original);
  expect(damaged).not.toBe(original);
  expect(() => parseArchivedIgc(bytes(damaged), { startedAt: start, endedAt: end })).toThrow(ArchivedIgcError);
});

it('preserves gaps and a single archived position without manufacturing replay samples', () => {
  const result = parseArchivedIgc(bytes(content([fix(start, 1)])), { startedAt: start, endedAt: end });
  expect(result.points).toHaveLength(1);
  expect(result.bounds).toEqual({ startedAt: start - 800, endedAt: start - 800 });
  expect(parseArchivedIgc(bytes(content()), { startedAt: start, endedAt: end }).points[1]!.timestamp - result.points[0]!.timestamp).toBe(21_000);
});

it('does not turn invalid-fix records into usable positions', () => {
  const invalid = content().replace(/A00000/g, 'V00000');
  expect(parseArchivedIgc(bytes(invalid), { startedAt: start, endedAt: end })).toEqual({ points: [], bounds: null });
});

it('refuses to guess a missing whole day when time-only records fit multiple days', () => {
  expect(() => parseArchivedIgc(bytes(content()), { startedAt: start, endedAt: end + 2 * 86_400_000 }))
    .toThrow('ambiguous date gap');
});

it('accepts a flight longer than a day when its ordered rollovers and end bound resolve the dates', () => {
  const startedAt = Date.UTC(2026, 8, 20, 6);
  const endedAt = startedAt + 27 * 3_600_000;
  const fixes = Array.from({ length: 28 }, (_, hour) => fix(startedAt + hour * 3_600_000, hour));
  const archive = buildUnsignedIgc({ id: 'multi-day', startedAt, endedAt }, fixes);
  const result = parseArchivedIgc(bytes(archive.content), { startedAt, endedAt });
  expect(result.points.map((point) => point.timestamp)).toEqual(fixes.map((point) => point.sourceTimestamp));
  expect(result.bounds).toEqual({ startedAt, endedAt });
});

it('rejects oversized or non-ASCII artifacts before parsing', () => {
  expect(() => parseArchivedIgc(new Uint8Array(MAX_ARCHIVED_IGC_BYTES + 1), { startedAt: start, endedAt: end })).toThrow('too large');
  expect(() => parseArchivedIgc(bytes(`${content()}\u0000`), { startedAt: start, endedAt: end })).toThrow('invalid text');
});

it('keeps six hours of archived timestamps and the stored discontinuities without inventing speed', () => {
  const startedAt = Date.UTC(2026, 8, 20, 6);
  const endedAt = startedAt + 6 * 60 * 60 * 1000;
  const fixes = Array.from({ length: 21_601 }, (_, index) => fix(startedAt + index * 1000, index))
    .filter((entry) => entry.sequence < 100 || entry.sequence > 120);
  const archive = buildUnsignedIgc({ id: 'long-flight', startedAt, endedAt }, fixes);
  const result = parseArchivedIgc(bytes(archive.content), { startedAt, endedAt });
  expect(result.points).toHaveLength(fixes.length);
  expect(result.bounds).toEqual({ startedAt, endedAt });
  expect(result.points[100]!.timestamp - result.points[99]!.timestamp).toBe(22_000);
  expect(result.points.every((point) => point.speed === null)).toBe(true);
});

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_REPLAY_POINTS = 100_000;
export interface ReplayPoint { timestamp: number; latitude: number; longitude: number; altitude: number | null; speed: number | null }
export interface SharedArtifact {
  schemaVersion: 1;
  provenance: 'recorded' | 'igc';
  bounds: { startedAt: number; endedAt: number };
  partial: boolean;
  points: ReplayPoint[];
}
export class ArtifactError extends Error { constructor() { super('shared_artifact_invalid'); } }
const fail = (): never => { throw new ArtifactError(); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) return fail();
  return record;
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function validateArtifact(value: unknown, expected?: { startedAt: number; endedAt: number; partial: boolean }): SharedArtifact {
  const record = object(value, ['schemaVersion', 'provenance', 'bounds', 'partial', 'points']);
  if (record.schemaVersion !== 1 || !['recorded', 'igc'].includes(String(record.provenance)) || typeof record.partial !== 'boolean') return fail();
  const bounds = object(record.bounds, ['startedAt', 'endedAt']);
  if (!finite(bounds.startedAt, 0, 8.64e15) || !finite(bounds.endedAt, bounds.startedAt, 8.64e15) ||
      !Number.isSafeInteger(bounds.startedAt) || !Number.isSafeInteger(bounds.endedAt)) return fail();
  if (expected && (bounds.startedAt < Math.floor(expected.startedAt / 1000) * 1000 ||
      bounds.endedAt > expected.endedAt || record.partial !== expected.partial)) return fail();
  if (!Array.isArray(record.points) || record.points.length > MAX_REPLAY_POINTS) return fail();
  let previous = -Infinity;
  for (const value of record.points) {
    const point = object(value, ['timestamp', 'latitude', 'longitude', 'altitude', 'speed']);
    if (!finite(point.timestamp, bounds.startedAt, bounds.endedAt) || !Number.isSafeInteger(point.timestamp) || point.timestamp <= previous ||
        !finite(point.latitude, -90, 90) || !finite(point.longitude, -180, 180) ||
        (point.altitude !== null && !finite(point.altitude, -100_000, 100_000)) ||
        (point.speed !== null && !finite(point.speed, 0, 100_000))) return fail();
    if (record.provenance === 'igc' && (point.speed !== null || point.timestamp % 1000 !== 0 ||
        (point.altitude !== null && !Number.isInteger(point.altitude)))) return fail();
    previous = point.timestamp;
  }
  return record as unknown as SharedArtifact;
}

/** A bounded overview only; the full replay retains all samples and timing gaps. */
export function routePreview(points: ReplayPoint[]): number[][] {
  const runs: ReplayPoint[][] = [];
  for (const point of points) {
    const previous = runs.at(-1)?.at(-1);
    if (!previous || point.timestamp - previous.timestamp > 15_000) runs.push([]);
    runs.at(-1)!.push(point);
  }
  // At most 200 runs, selected across the whole flight; never bridge omitted gaps.
  const selected = runs.filter((_, index) => index % Math.max(1, Math.ceil(runs.length / 200)) === 0);
  const budget = Math.max(2, Math.floor(600 / Math.max(1, selected.length)));
  return selected.map((run) => {
    const count = Math.min(run.length, budget);
    const result: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const point = run[count === 1 ? 0 : Math.round(index * (run.length - 1) / (count - 1))]!;
      result.push(point.latitude, point.longitude);
    }
    return result;
  });
}
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

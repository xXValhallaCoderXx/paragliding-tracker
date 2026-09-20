import type { FeedCursor, FeedPage, KudosPage, KudosResult, KudosSummary, PreparedShare, RemotePublication, SharedArtifactManifest, SharedFlightDetail, SharedReplayArtifactV1, SharingPreferences } from './feed-types';
import { SocialError } from './types';

export const MAX_SHARED_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_SHARED_REPLAY_POINTS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (): never => { throw new SocialError('invalid_response', 'Shared flights returned unexpected data. Refresh Friends and try again.'); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(row: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(row).length !== keys.length || keys.some(key => !(key in row))) invalid();
}
function uuid(value: unknown): string { return typeof value === 'string' && UUID.test(value) ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function number(value: unknown, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : invalid();
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, min, max); return Number.isSafeInteger(result) ? result : invalid();
}
function nullableNumber(value: unknown, min = -Infinity, max = Infinity): number | null { return value === null ? null : number(value, min, max); }
function text(value: unknown, max: number): string | null { return value === null ? null : typeof value === 'string' && value.length <= max ? value : invalid(); }
function date(value: unknown): string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : invalid(); }
function enumeration<T extends string>(value: unknown, allowed: readonly T[]): T { return allowed.includes(value as T) ? value as T : invalid(); }

export function parseSharingPreferences(value: unknown): SharingPreferences {
  const row = object(value);
  const result = { enabled: bool(row.enabled), generation: row.generation === null ? null : uuid(row.generation) };
  if (result.enabled && !result.generation) invalid();
  return result;
}
export function parseManifest(value: unknown): SharedArtifactManifest {
  const row = object(value);
  if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) return invalid();
  return { generation: uuid(row.generation), sha256: row.sha256, byteCount: integer(row.byteCount, 1, MAX_SHARED_ARTIFACT_BYTES) };
}
export function parseKudosSummary(value: unknown): KudosSummary {
  const row = object(value);
  const result = { count: integer(row.count), givenByMe: bool(row.givenByMe) };
  if (result.givenByMe && result.count === 0) invalid();
  return result;
}
export function parseKudosResult(value: unknown): KudosResult {
  const row = object(value);
  return { activityId: uuid(row.activityId), ...parseKudosSummary(row) };
}
export function parseKudosPage(value: unknown): KudosPage {
  const row = object(value), summary = parseKudosResult(row);
  if (!Array.isArray(row.items) || row.items.length > 25 || row.items.length > summary.count) return invalid();
  const items = row.items.map(value => {
    const item = object(value), displayName = text(item.displayName, 120);
    if (!displayName?.trim() || Array.from(displayName).length > 60) return invalid();
    return { id: uuid(item.id), displayName };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) invalid();
  const cursor = row.nextCursor === null ? null : object(row.nextCursor);
  const nextCursor = cursor ? { createdAt: date(cursor.createdAt), id: uuid(cursor.id) } : null;
  if (nextCursor && (!items.length || items.at(-1)!.id !== nextCursor.id)) invalid();
  return { ...summary, items, nextCursor };
}
export function parseSharedFlight(value: unknown): SharedFlightDetail {
  const row = object(value), author = object(row.author), metrics = object(row.metrics);
  const displayName = text(author.displayName, 120);
  if (!displayName?.trim() || Array.from(displayName).length > 60 || !Array.isArray(row.routePreview)) return invalid();
  let vertices = 0;
  const routePreview = row.routePreview.map(segment => {
    if (!Array.isArray(segment) || segment.length % 2 !== 0 || segment.length === 0) return invalid();
    vertices += segment.length / 2;
    return segment.map((coordinate, index) => number(coordinate, index % 2 ? -180 : -90, index % 2 ? 180 : 90));
  });
  if (vertices > 600) return invalid();
  const startedAt = integer(row.startedAt), endedAt = integer(row.endedAt, startedAt);
  const timezoneOffsetMinutes = row.timezoneOffsetMinutes === null ? null : integer(row.timezoneOffsetMinutes, -1440, 1440);
  return {
    activityId: uuid(row.activityId), author: { userId: uuid(author.userId), displayName }, publishedAt: date(row.publishedAt),
    title: text(row.title, 10_000), site: text(row.site, 10_000),
    siteSource: row.siteSource === null ? null : enumeration(row.siteSource, ['paraglidingearth', 'osm', 'manual'] as const),
    startedAt, endedAt, timezoneOffsetMinutes, status: enumeration(row.status, ['completed', 'partial']),
    metrics: { durationMs: number(metrics.durationMs, 0), trackDistanceMetres: number(metrics.trackDistanceMetres, 0),
      minGpsAltitude: nullableNumber(metrics.minGpsAltitude), maxGpsAltitude: nullableNumber(metrics.maxGpsAltitude),
      maxGroundSpeed: nullableNumber(metrics.maxGroundSpeed, 0), fixCount: integer(metrics.fixCount),
      quality: enumeration(metrics.quality, ['healthy', 'gaps', 'partial', 'no_track']) },
    routePreview, provenance: enumeration(row.provenance, ['recorded', 'igc']),
    replayAvailable: bool(row.replayAvailable), artifact: parseManifest(row.artifact),
    kudos: row.kudos === undefined || row.kudos === null ? null : parseKudosSummary(row.kudos),
  };
}
function cursor(value: unknown): FeedCursor {
  const row = object(value); return { publishedAt: date(row.publishedAt), activityId: uuid(row.activityId) };
}
export function parseFeedPage(value: unknown): FeedPage {
  const row = object(value);
  if (!Array.isArray(row.items) || row.items.length > 25) return invalid();
  const items = row.items.map(parseSharedFlight);
  if (new Set(items.map(item => item.activityId)).size !== items.length) return invalid();
  const nextCursor = row.nextCursor === null ? null : cursor(row.nextCursor);
  if (nextCursor && (!items.length || items.at(-1)!.activityId !== nextCursor.activityId || items.at(-1)!.publishedAt !== nextCursor.publishedAt)) invalid();
  return { items, nextCursor };
}
export function parsePublication(value: unknown): RemotePublication {
  const row = object(value);
  return { flightId: uuid(row.flightId), activityId: row.activityId === null ? null : uuid(row.activityId),
    revision: integer(row.revision), state: enumeration(row.state, ['private', 'pending', 'shared', 'hidden']) };
}
export function parsePreparedShare(value: unknown): PreparedShare {
  const row = object(value);
  return { activityId: uuid(row.activityId), revision: integer(row.revision), uploadToken: uuid(row.uploadToken), alreadyPublished: bool(row.alreadyPublished) };
}
export function parseSharedReplay(value: unknown): SharedReplayArtifactV1 {
  const row = object(value);
  exact(row, ['schemaVersion', 'provenance', 'bounds', 'partial', 'points']);
  if (row.schemaVersion !== 1 || !Array.isArray(row.points) || row.points.length > MAX_SHARED_REPLAY_POINTS) return invalid();
  const provenance = enumeration(row.provenance, ['recorded', 'igc']);
  const bounds = object(row.bounds); exact(bounds, ['startedAt', 'endedAt']);
  const startedAt = integer(bounds.startedAt), endedAt = integer(bounds.endedAt, startedAt);
  let lastTimestamp = -Infinity;
  const points = row.points.map(value => {
    const point = object(value); exact(point, ['timestamp', 'latitude', 'longitude', 'altitude', 'speed']);
    const timestamp = integer(point.timestamp, startedAt, endedAt);
    if (timestamp <= lastTimestamp || (provenance === 'igc' && point.speed !== null)) return invalid();
    lastTimestamp = timestamp;
    return { timestamp, latitude: number(point.latitude, -90, 90), longitude: number(point.longitude, -180, 180),
      altitude: nullableNumber(point.altitude), speed: nullableNumber(point.speed, 0) };
  });
  return { schemaVersion: 1, provenance, bounds: { startedAt, endedAt }, partial: bool(row.partial), points };
}

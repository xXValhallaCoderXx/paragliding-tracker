import { formatAirtime, formatDistance, formatLongDate, formatMetres } from '@/lib/format/flight-format';
import { projectSegments, toPathData } from '@/lib/track/projection';
import type { TrackSegments } from '@/lib/track/types';
import type { FlightSummary, PilotProfile } from '@/recorder/types';
import { siteAttribution } from '@/features/flights/site-picker';

export type PostcardFormat = 'square' | 'story';
export type PostcardScene = 'flying' | 'launch' | 'landing';
export interface PostcardDraft {
  format: PostcardFormat;
  scene: PostcardScene;
  caption: string;
  signature: boolean;
}
export const CAPTION_LIMIT = 140;
export const POSTCARD_SIZE = { square: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } } as const;

export function canSharePostcard(flight: FlightSummary): boolean {
  return (flight.status === 'completed' || flight.status === 'partial') &&
    flight.sessionStatus === 'completed' && flight.endedAt !== null && flight.metrics !== null;
}

export function postcardCaption(value: string): string {
  // Count Unicode code points, so an emoji surrogate pair is never cut in half.
  return Array.from(value).slice(0, CAPTION_LIMIT).join('');
}

export interface PostcardSource {
  title: string;
  site: string | null;
  date: string;
  airtime: string;
  distance: string;
  altitude: string;
  labels: readonly string[];
  attribution: string | null;
  pilotName: string | null;
  segments: TrackSegments;
}

/** Copies only postcard fields. Notes, account details and replay samples never enter a draft. */
export function postcardSource(flight: FlightSummary, track: TrackSegments, profile?: PilotProfile | null): PostcardSource {
  if (!canSharePostcard(flight)) throw new Error('Postcards are available after the flight statistics are complete.');
  const metrics = flight.metrics!;
  const site = flight.site?.trim() || null;
  const title = flight.title?.trim() || site || 'A day in the sky';
  const hasGps = metrics.quality !== 'no_track' && metrics.fixCount > 0;
  const segments = hasGps ? track.filter((segment) => segment.length >= 2).map((segment) => Object.freeze([...segment])) : [];
  const partial = flight.status === 'partial' || metrics.quality === 'partial';
  const gaps = metrics.quality === 'gaps' || segments.length > 1;
  return Object.freeze({
    title, site: site && site.toLocaleLowerCase() !== title.toLocaleLowerCase() ? site : null,
    date: Number.isFinite(flight.startedAt) ? formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes) : 'Date unavailable',
    airtime: Number.isFinite(metrics.durationMs) && metrics.durationMs >= 0 ? formatAirtime(metrics.durationMs) : 'Unavailable',
    distance: hasGps && Number.isFinite(metrics.trackDistanceMetres) && metrics.trackDistanceMetres >= 0 ? formatDistance(metrics.trackDistanceMetres) : 'Unavailable',
    altitude: hasGps && metrics.maxGpsAltitude !== null && Number.isFinite(metrics.maxGpsAltitude) ? formatMetres(metrics.maxGpsAltitude) : 'Unavailable',
    labels: Object.freeze([...(partial ? ['Partial flight'] : []), ...(gaps ? ['Track gaps'] : [])]),
    attribution: site ? siteAttribution(flight.siteSource) : null,
    pilotName: profile?.pilotName?.trim() || null,
    segments: Object.freeze(segments),
  });
}

export function initialPostcardDraft(source: PostcardSource): PostcardDraft {
  return { format: 'square', scene: 'flying', caption: '', signature: Boolean(source.pilotName) };
}

export function postcardPresentation(source: PostcardSource, draft: PostcardDraft) {
  const view = { width: draft.format === 'square' ? 156 : 328, height: draft.format === 'square' ? 56 : 124, padding: 10 };
  const projection = projectSegments(source.segments, view);
  const points = projection.segments.flat();
  return {
    ...source, ...POSTCARD_SIZE[draft.format], view,
    route: points.length === 0 ? 'unavailable' as const : projection.degenerate ? 'point' as const : 'track' as const,
    path: toPathData(projection.segments), first: points[0], last: points.at(-1),
    caption: postcardCaption(draft.caption),
    signature: draft.signature && source.pilotName ? `From ${source.pilotName}’s flight journal.` : null,
  };
}

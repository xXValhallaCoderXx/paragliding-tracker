import type { FlightDetail, FlightMetadataPatch, FlightSummary } from '../recorder/types';
import { assertFlightScope, captureFlightScope, type FlightActionScope } from './flight-scope';

export type StoredFlightMetadata = Pick<FlightDetail, 'title' | 'site' | 'siteSource' | 'notes'>;
export interface FlightMutationTarget {
  flightId: string;
  source: 'recorded' | 'archive';
  recordingSessionId: string;
  ownerUserId: string | null;
  createdAt: number;
  startedAt: number;
}
export interface FlightMutationGuard { target: FlightMutationTarget; scope: FlightActionScope }
export interface FlightEditGuard extends FlightMutationGuard { original: StoredFlightMetadata }
export interface FlightUpdateRequest extends FlightEditGuard { patch: FlightMetadataPatch }
export const storedFlightMetadata = (flight: StoredFlightMetadata): StoredFlightMetadata => ({
  title: flight.title, site: flight.site, notes: flight.notes, siteSource: flight.siteSource,
});
export function flightMutationGuard(flight: FlightSummary): FlightMutationGuard {
  return { scope: captureFlightScope(), target: {
    flightId: flight.id, source: flight.source === 'archive' ? 'archive' : 'recorded',
    recordingSessionId: flight.recordingSessionId,
    ownerUserId: flight.source === 'archive' ? flight.ownerUserId : flight.cloudOwnerUserId ?? null,
    createdAt: flight.createdAt, startedAt: flight.startedAt,
  } };
}
export function assertFlightTarget(flight: FlightSummary, guard: FlightMutationGuard) {
  assertFlightScope(guard.scope);
  const actual = flightMutationGuard(flight).target;
  if ((Object.keys(actual) as (keyof FlightMutationTarget)[]).some(key => actual[key] !== guard.target[key])) {
    throw new Error('This flight changed or is no longer available. Reopen it before continuing.');
  }
  if (actual.ownerUserId && (actual.ownerUserId !== guard.scope.journalOwnerId ||
    (guard.scope.authUserId !== null && actual.ownerUserId !== guard.scope.authUserId))) {
    throw new Error('This flight belongs to another account. Reopen it from the owning account.');
  }
  if (!['completed', 'partial'].includes(flight.status) || flight.endedAt === null ||
    (flight.source !== 'archive' && flight.sessionStatus !== 'completed')) {
    throw new Error('Finish saving this flight before changing its details or deleting it.');
  }
}
export type MetadataConflictField = 'title' | 'site' | 'notes';
export class FlightMetadataConflict extends Error {
  readonly code = 'flight_metadata_conflict';
  constructor(readonly saved: StoredFlightMetadata, readonly fields: MetadataConflictField[]) {
    super('These details changed since you started editing. Review the saved details before saving again.');
  }
}
export function assertFlightMetadata(flight: StoredFlightMetadata, patch: FlightMetadataPatch, original: StoredFlightMetadata) {
  const fields = (['title', 'site', 'notes'] as const).filter(field => Object.hasOwn(patch, field) &&
    (flight[field] !== original[field] || (field === 'site' && flight.siteSource !== original.siteSource)));
  if (fields.length) throw new FlightMetadataConflict(storedFlightMetadata(flight), fields);
}
/** Also recognizes the serializable RTK Query error after it crosses the cache. */
export function metadataConflict(error: unknown): { saved: StoredFlightMetadata; fields: MetadataConflictField[] } | null {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'flight_metadata_conflict' ||
    !('saved' in error) || !('fields' in error)) return null;
  return error as FlightMetadataConflict;
}

import type { FlightMetadataPatch, FlightRecord } from '@/recorder/types';
import type { MetadataFormValues } from './components/metadata-form';

export function flightDraft(flight: FlightRecord): MetadataFormValues {
  return { title: flight.title ?? '', site: flight.site ?? '', notes: flight.notes ?? '', siteSource: flight.siteSource };
}

/** Save only edited fields so a concurrent refresh cannot roll back untouched metadata. */
export function flightPatch(draft: MetadataFormValues, initial: MetadataFormValues): FlightMetadataPatch {
  const patch: FlightMetadataPatch = {};
  if (draft.title !== initial.title) patch.title = draft.title.trim() || null;
  if (draft.notes !== initial.notes) patch.notes = draft.notes.trim() || null;
  // The repository changes provenance alongside the site name, including when only
  // the selected catalogue changed. These two fields always travel together.
  if (draft.site !== initial.site || draft.siteSource !== initial.siteSource) {
    patch.site = draft.site.trim() || null;
    patch.siteSource = patch.site ? draft.siteSource ?? 'manual' : null;
  }
  return patch;
}

/** Compare drafts, including provenance; upstream cache refreshes must not erase a draft. */
export function hasFlightEdits(draft: MetadataFormValues, initial: MetadataFormValues): boolean {
  return draft.title !== initial.title || draft.site !== initial.site || draft.notes !== initial.notes || draft.siteSource !== initial.siteSource;
}

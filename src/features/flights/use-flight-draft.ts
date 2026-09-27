import { useEffect, useRef, useState } from 'react';
import type { FlightDetail } from '@/recorder/types';
import { flightMutationGuard, metadataConflict, storedFlightMetadata, type FlightUpdateRequest, type StoredFlightMetadata } from '@/lib/flight-mutations';
import { assertFlightScope } from '@/lib/flight-scope';
import { errorMessage } from '@/lib/format/error-message';
import { flightDraft, flightPatch, hasFlightEdits } from './metadata-editor';

/** Mounted per editing visit. Cache refreshes cannot replace a component-local draft. */
export function useFlightDraft(flight: FlightDetail, onSave: (request: FlightUpdateRequest) => Promise<FlightDetail>) {
  const [guard] = useState(() => flightMutationGuard(flight));
  const [original, setOriginal] = useState(() => storedFlightMetadata(flight));
  const [draft, setDraft] = useState(() => flightDraft(flight));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ReturnType<typeof metadataConflict>>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => {
    if (!mounted.current) return false;
    try { assertFlightScope(guard.scope); return true; } catch { return false; }
  };
  const initial = flightDraft(original);
  const dirty = hasFlightEdits(draft, initial);
  const reload = (saved: StoredFlightMetadata) => {
    if (!current() || locked.current) return;
    setOriginal(saved); setDraft(flightDraft(saved)); setConflict(null); setError(null);
  };
  const rebase = () => {
    if (!conflict || !current() || locked.current) return;
    // Keep only the user's edited fields. Newer untouched fields must remain untouched.
    const patch = flightPatch(draft, initial);
    const savedDraft = flightDraft(conflict.saved);
    setDraft({ ...savedDraft,
      ...(Object.hasOwn(patch, 'title') ? { title: draft.title } : {}),
      ...(Object.hasOwn(patch, 'notes') ? { notes: draft.notes } : {}),
      ...(Object.hasOwn(patch, 'site') ? { site: draft.site, siteSource: draft.siteSource } : {}),
    });
    setOriginal(conflict.saved); setConflict(null);
    setError('Your edits are ready. Review them and press Save again.');
  };
  const save = async (): Promise<FlightDetail | null> => {
    if (locked.current || !current() || conflict) return null;
    if (!dirty) return flight;
    locked.current = true; setSaving(true); setError(null);
    try {
      const saved = await onSave({ ...guard, original, patch: flightPatch(draft, initial) });
      if (!current()) return null;
      setOriginal(storedFlightMetadata(saved)); setDraft(flightDraft(saved));
      return saved;
    } catch (cause) {
      if (current()) { setConflict(metadataConflict(cause)); setError(errorMessage(cause)); }
      return null;
    } finally {
      locked.current = false;
      if (current()) setSaving(false);
    }
  };
  return { draft, setDraft, dirty, saving, error, conflict, current, locked, save,
    useSaved: () => { if (conflict) reload(conflict.saved); }, keepEdits: rebase };
}

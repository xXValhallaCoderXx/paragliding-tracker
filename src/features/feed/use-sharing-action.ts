import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from '@/lib/format/error-message';
import { assertFlightScope, captureFlightScope } from '@/lib/flight-scope';

/** Prevent repeat taps and keep an old screen's mutation result out of a new confirmation. */
export function useSharingAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<object | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [identityScope] = useState(captureFlightScope);
  const invalidate = useCallback(() => { generation.current += 1; }, []);
  const clearError = useCallback(() => setError(null), []);
  useFocusEffect(useCallback(() => {
    active.current = true;
    generation.current += 1;
    return () => { active.current = false; generation.current += 1; };
  }, []));
  const run = async (action: () => Promise<void>, onSuccess: () => void) => {
    if (request.current || !active.current) return;
    const token = {};
    const version = generation.current;
    request.current = token;
    setPending(true); setError(null);
    try {
      assertFlightScope(identityScope);
      await action();
      assertFlightScope(identityScope);
      if (active.current && generation.current === version) onSuccess();
    } catch (problem) {
      if (active.current && generation.current === version) setError(errorMessage(problem));
    } finally {
      if (request.current === token) { request.current = null; if (mounted.current) setPending(false); }
    }
  };
  return { pending, error, clearError, invalidate, run };
}

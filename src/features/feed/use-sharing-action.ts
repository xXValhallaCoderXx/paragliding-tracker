import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { errorMessage } from '@/lib/format/error-message';

/** Prevent repeat taps and keep an old screen's mutation result out of a new confirmation. */
export function useSharingAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<object | null>(null);
  const generation = useRef(0);
  useFocusEffect(useCallback(() => {
    generation.current += 1;
    return () => { generation.current += 1; };
  }, []));
  const run = async (action: () => Promise<void>, onSuccess: () => void) => {
    if (request.current) return;
    const token = {};
    const version = generation.current;
    request.current = token;
    setPending(true); setError(null);
    try {
      await action();
      if (generation.current === version) onSuccess();
    } catch (problem) {
      if (generation.current === version) setError(errorMessage(problem));
    } finally {
      if (request.current === token) { request.current = null; setPending(false); }
    }
  };
  return { pending, error, clearError: () => setError(null), run };
}

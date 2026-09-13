import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { cloudConfigured } from '@/cloud/config';
import { cloudSyncEngine } from '@/cloud/sync-engine';
import type { SyncSnapshot, SyncTrigger } from '@/cloud/types';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';

import { useCloudAuth } from './auth-provider';

interface CloudSyncState extends SyncSnapshot {
  requestSync: (trigger: SyncTrigger) => void;
  /** Rebinds this device to the signed-in account. Never touches local flights. */
  rebindToCurrentAccount: () => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncState | null>(null);

/**
 * Drives backup cycles.
 *
 * Sits inside `RecorderLifecycleProvider` so it can see `recovering` and stay out of the
 * way while the recorder is putting itself back together after a cold launch.
 */
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const auth = useCloudAuth();
  const recorderLifecycle = useRecorderLifecycle();
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() => cloudSyncEngine.getSnapshot());

  const enabled = cloudConfigured;

  // `recovering` flips false -> true -> false on every app foreground, so closing over it
  // would give `requestSync` a new identity twice per foreground. That identity is load
  // bearing: it flows into the context value, and the logbook's focus effect depends on
  // it, so an unstable one re-runs that effect — and its three database reads — every
  // time the engine publishes. A ref keeps the value current without touching identity.
  // Reading a ref inside a callback is fine; only reading one during render is what the
  // React Compiler rules forbid.
  const recorderRecovering = !recorderLifecycle.ready || recorderLifecycle.recovering;
  const recoveringRef = useRef(recorderRecovering);
  useEffect(() => {
    recoveringRef.current = recorderRecovering;
  }, [recorderRecovering]);

  const requestSync = useCallback(
    (trigger: SyncTrigger) => {
      if (!enabled) return;
      void cloudSyncEngine.requestSync(trigger, {
        recorderRecovering: recoveringRef.current,
      });
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    return cloudSyncEngine.subscribe(setSnapshot);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestSync('foreground');
    });
    return () => subscription.remove();
  }, [enabled, requestSync]);

  // Sign-in and completed recorder recovery both make a deferred backup eligible.
  const signedInUserId = auth.status === 'signed_in' ? auth.userId : null;
  useEffect(() => {
    if (!enabled || signedInUserId === null || recorderRecovering) return;
    let current = true;
    void cloudSyncEngine.requestSync('post-sign-in', { recorderRecovering: false }).then((result) => {
      // The engine coalesces overlapping requests. If this joined a cycle that
      // already captured recovery=true, wait for it to release its slot and retry.
      if (current && !recoveringRef.current && result.phase === 'blocked' && result.blockedBy === 'recovering') {
        requestSync('post-sign-in');
      }
    });
    return () => { current = false; };
  }, [enabled, signedInUserId, recorderRecovering, requestSync]);

  const userId = auth.userId;
  const rebindToCurrentAccount = useCallback(async () => {
    if (!enabled || userId === null) return;
    // Goes through the engine rather than reaching into the database from a component.
    // Keeping persistence behind the domain service preserves the provider boundary.
    await cloudSyncEngine.rebindTo(userId);
    requestSync('manual');
  }, [enabled, userId, requestSync]);

  const value = useMemo(
    () => ({ ...snapshot, requestSync, rebindToCurrentAccount }),
    [snapshot, requestSync, rebindToCurrentAccount],
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync(): CloudSyncState {
  const value = useContext(CloudSyncContext);
  if (!value) {
    throw new Error('useCloudSync must be used inside CloudSyncProvider.');
  }
  return value;
}

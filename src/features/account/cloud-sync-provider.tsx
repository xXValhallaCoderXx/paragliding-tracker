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
import { AppState, Platform } from 'react-native';

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

  const supported = Platform.OS !== 'web' && cloudConfigured;

  // `recovering` flips false -> true -> false on every app foreground, so closing over it
  // would give `requestSync` a new identity twice per foreground. That identity is load
  // bearing: it flows into the context value, and the logbook's focus effect depends on
  // it, so an unstable one re-runs that effect — and its three database reads — every
  // time the engine publishes. A ref keeps the value current without touching identity.
  // Reading a ref inside a callback is fine; only reading one during render is what the
  // React Compiler rules forbid.
  const recoveringRef = useRef(recorderLifecycle.recovering);
  useEffect(() => {
    recoveringRef.current = recorderLifecycle.recovering;
  }, [recorderLifecycle.recovering]);

  const requestSync = useCallback(
    (trigger: SyncTrigger) => {
      if (!supported) return;
      void cloudSyncEngine.requestSync(trigger, {
        recorderRecovering: recoveringRef.current,
      });
    },
    [supported],
  );

  useEffect(() => {
    if (!supported) return;
    return cloudSyncEngine.subscribe(setSnapshot);
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestSync('foreground');
    });
    return () => subscription.remove();
  }, [supported, requestSync]);

  // Signing in claims the whole existing logbook, so kick a cycle as soon as it happens.
  const signedInUserId = auth.status === 'signed_in' ? auth.userId : null;
  useEffect(() => {
    if (!supported || signedInUserId === null) return;
    requestSync('post-sign-in');
  }, [supported, signedInUserId, requestSync]);

  const userId = auth.userId;
  const rebindToCurrentAccount = useCallback(async () => {
    if (!supported || userId === null) return;
    // Goes through the engine rather than the database directly: `database.native` is a
    // platform-split module, and importing it from a shared component pulls expo-sqlite's
    // web worker into the web bundle and breaks `expo export --platform web`.
    await cloudSyncEngine.rebindTo(userId);
    requestSync('manual');
  }, [supported, userId, requestSync]);

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

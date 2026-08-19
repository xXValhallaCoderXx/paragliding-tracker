import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const recovering = recorderLifecycle.recovering;
  const supported = Platform.OS !== 'web' && cloudConfigured;

  const requestSync = useCallback(
    (trigger: SyncTrigger) => {
      if (!supported) return;
      void cloudSyncEngine.requestSync(trigger, { recorderRecovering: recovering });
    },
    [supported, recovering],
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

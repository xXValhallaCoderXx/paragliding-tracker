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
import * as Network from 'expo-network';
import { recorderService } from '@/recorder/recorder-service';
import { downloadNetwork } from '@/offline-maps/network';
import { EMPTY_RESTORE, type RestoreSnapshot } from '@/cloud/restore-plan';
import { subscribeJournal } from '@/journal/context';
import { store } from '@/store';
import { api } from '@/store/api';

import { cloudConfigured } from '@/cloud/config';
import { cloudSyncEngine } from '@/cloud/sync-engine';
import type { SyncSnapshot, SyncTrigger } from '@/cloud/types';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';

import { useCloudAuth } from './auth-provider';

interface CloudSyncState extends SyncSnapshot {
  restore: RestoreSnapshot;
  pauseRestore: () => void;
  resumeRestore: (options: { allowMobileData: boolean }) => void;
  retryRestore: (options: { allowMobileData: boolean }) => void;
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

  useEffect(() => subscribeJournal((change) => {
    if (change.kind === 'owner') {
      // Reset also discards in-flight responses; the recorder's own service is independent.
      store.dispatch(api.util.resetApiState());
      return;
    }
    store.dispatch(api.util.invalidateTags([
      { type: 'Flight', id: 'LIST' },
      ...(change.flightId ? [{ type: 'Flight' as const, id: change.flightId }] : ['Flight' as const]),
      ...(change.kind === 'artifact' || change.kind === 'delete'
        ? [{ type: 'FlightTrack' as const, id: 'LIST' }, { type: 'FlightTrack' as const, id: change.flightId }, { type: 'FlightReplay' as const, id: change.flightId }]
        : []),
    ]));
  }), []);

  useEffect(() => {
    void cloudSyncEngine.authChanged().catch(() => undefined);
  }, [auth.status, auth.userId]);

  useEffect(() => {
    if (!enabled) return;
    cloudSyncEngine.setEnvironment({ recorderReady: !recorderRecovering && !recorderLifecycle.recoveryError });
  }, [enabled, recorderRecovering, recorderLifecycle.recoveryError, recorderLifecycle.recoveryVersion]);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let networkRevision = 0;
    const updateNetwork = (state: Network.NetworkState) => {
      cloudSyncEngine.setEnvironment({ network: downloadNetwork(state) });
      requestSync('foreground');
    };
    const refreshNetwork = async () => {
      const revision = ++networkRevision;
      try {
        const state = await Network.getNetworkStateAsync();
        if (mounted && revision === networkRevision) updateNetwork(state);
      } catch { if (mounted && revision === networkRevision) cloudSyncEngine.setEnvironment({ network: 'unknown' }); }
    };
    cloudSyncEngine.setEnvironment({ foreground: AppState.currentState === 'active' });
    void refreshNetwork();
    const network = Network.addNetworkStateListener((state) => { networkRevision += 1; updateNetwork(state); });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') { cloudSyncEngine.setEnvironment({ network: 'unknown' }); void refreshNetwork(); }
    });
    const activity = recorderService.subscribeActivity((state) => {
      cloudSyncEngine.setEnvironment({ recorderBusy: state.lifecycleBusy || !['idle', 'completed'].includes(state.state) });
    });
    return () => { mounted = false; network.remove(); app.remove(); activity(); cloudSyncEngine.setEnvironment({ foreground: false }); };
  }, [enabled, requestSync]);


  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      cloudSyncEngine.setEnvironment({ foreground: state === 'active', ...(state === 'active' ? { recorderReady: false } : {}) });
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
    () => ({ ...snapshot, restore: snapshot.restore ?? EMPTY_RESTORE, requestSync, rebindToCurrentAccount,
      pauseRestore: cloudSyncEngine.pauseRestore, resumeRestore: cloudSyncEngine.resumeRestore, retryRestore: cloudSyncEngine.retryRestore }),
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

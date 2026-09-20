import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';

import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { recorderService } from '@/recorder/recorder-service';
import { nativeOfflineBackend } from './backend';
import { OfflineCoverageContext } from './coverage-context';
import { downloadNetwork } from './network';
import { createOfflineRegistry } from './registry';
import { OfflineMapService } from './service';
import type { OfflineEnvironment } from './types';

interface Runtime { service: OfflineMapService; environment: OfflineEnvironment }
const OfflineContext = createContext<Runtime | null>(null);

/** Owns transfer lifecycle across navigation; creates no MapView and does not gate startup. */
export function OfflineMapsProvider({ children }: { children: ReactNode }) {
  const lifecycle = useRecorderLifecycle();
  const [service] = useState(() => new OfflineMapService({ backend: nativeOfflineBackend, registry: createOfflineRegistry() }));
  const [environment, setEnvironment] = useState<OfflineEnvironment>({
    foreground: AppState.currentState === 'active', recorderReady: false, recorderBusy: true, network: 'unknown',
  });
  const current = useRef(environment);
  const lifetime = useRef(0);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const activation = useRef<Promise<void> | null>(null);
  const activate = useCallback(() => {
    if (service.getSnapshot().initialized || activation.current) return;
    activation.current = service.initialize().catch(() => undefined).finally(() => { activation.current = null; });
  }, [service]);
  const update = useCallback((patch: Partial<OfflineEnvironment>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    // Synchronous revocation precedes asynchronous native cancellation and React rendering.
    service.setEnvironment(next);
    setEnvironment(next);
  }, [service]);

  useEffect(() => {
    const ready = lifecycle.ready && !lifecycle.recovering && !lifecycle.recoveryError;
    update({ recorderReady: ready });
    if (ready && !environment.recorderBusy && current.current.foreground && service.getSnapshot().initialized) {
      // A foreground refresh can run before recovery completes; finish deferred cleanup once idle.
      void service.refresh().catch(() => undefined);
    }
  }, [lifecycle.ready, lifecycle.recovering, lifecycle.recoveryError, lifecycle.recoveryVersion, environment.recorderBusy, service, update]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const mountedLifetime = ++lifetime.current;
    const isLatestLifetime = () => lifetime.current === mountedLifetime;
    update({ foreground: AppState.currentState === 'active' });
    let mounted = true;
    let networkRevision = 0;
    const readNetwork = async () => {
      const revision = ++networkRevision;
      try {
        const network = await Network.getNetworkStateAsync();
        if (mounted && revision === networkRevision) update({ network: downloadNetwork(network) });
      } catch { if (mounted && revision === networkRevision) update({ network: 'unknown' }); }
    };
    const network = Network.addNetworkStateListener((state) => {
      networkRevision += 1;
      update({ network: downloadNetwork(state) });
    });
    void readNetwork();
    const activity = recorderService.subscribeActivity((state) => {
      update({ recorderBusy: state.lifecycleBusy || !['idle', 'completed'].includes(state.state) });
    });
    const app = AppState.addEventListener('change', (state) => {
      update({ foreground: state === 'active', ...(state === 'active' ? { recorderReady: false } : {}) });
      if (state === 'active') {
        void readNetwork();
        if (service.getSnapshot().initialized) void service.refresh().catch(() => undefined);
      }
    });
    return () => {
      mounted = false; network.remove(); activity(); app.remove();
      service.setEnvironment({ ...current.current, foreground: false });
      // StrictMode reattaches effects synchronously; a real unmount releases native listeners.
      void Promise.resolve().then(() => { if (isLatestLifetime()) service.dispose(); });
    };
  }, [service, update]);

  return <OfflineContext.Provider value={{ service, environment }}>
    <OfflineCoverageContext.Provider value={{ regions: snapshot.regions, network: environment.network, activate }}>
      {children}
    </OfflineCoverageContext.Provider>
  </OfflineContext.Provider>;
}

export function useOfflineMaps() {
  const runtime = useContext(OfflineContext);
  if (!runtime) throw new Error('OfflineMapsProvider is required.');
  const snapshot = useSyncExternalStore(
    (listener) => runtime.service.subscribe(listener),
    () => runtime.service.getSnapshot(),
    () => runtime.service.getSnapshot(),
  );
  return { ...runtime, snapshot };
}

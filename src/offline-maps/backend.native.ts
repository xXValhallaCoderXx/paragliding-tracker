import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import { loadMapboxSdk } from '@/components/flight-map/sdk';
import type { NativeDownloadEvent, OfflineMapBackend } from './types';

type NativeOfflineBridge = Omit<OfflineMapBackend, 'subscribe'> & {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

function bridge(): NativeOfflineBridge {
  const module = NativeModules.XCOfflineMaps as NativeOfflineBridge | undefined;
  if (Platform.OS !== 'android' || !module ||
    !['prepare', 'list', 'estimate', 'cancelEstimate', 'start', 'pause', 'remove', 'storage']
      .every((name) => typeof (module as unknown as Record<string, unknown>)[name] === 'function')) {
    throw Object.assign(new Error('Offline maps need the latest Android app build.'), { code: 'UNSUPPORTED' });
  }
  return module;
}

function downloadEvent(value: unknown): value is NativeDownloadEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<NativeDownloadEvent>;
  return typeof event.nativeId === 'string' && typeof event.operationId === 'string' &&
    ['progress', 'complete', 'error', 'paused'].includes(event.kind ?? '') &&
    [event.completedResources, event.requiredResources, event.completedBytes].every((n) =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

/** Kept lazy: constructing the service never opens Mapbox or a map view. */
export const nativeOfflineBackend: OfflineMapBackend = {
  async prepare() { bridge(); await loadMapboxSdk(); },
  list: () => bridge().list(),
  estimate: (requestId, spec) => bridge().estimate(requestId, spec),
  cancelEstimate: (requestId) => bridge().cancelEstimate(requestId),
  start: (request) => bridge().start(request),
  pause: (nativeId, operationId) => bridge().pause(nativeId, operationId),
  remove: (nativeId) => bridge().remove(nativeId),
  storage: () => bridge().storage(),
  subscribe(listener) {
    let native: NativeOfflineBridge;
    try { native = bridge(); } catch { return () => undefined; }
    const emitter = new NativeEventEmitter(native);
    const subscription = emitter.addListener('xcOfflineMapDownload', (event: unknown) => {
      if (downloadEvent(event)) listener(event);
    });
    return () => subscription.remove();
  },
};

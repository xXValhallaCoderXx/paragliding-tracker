import type { OfflineMapBackend } from './types';

const unavailable = async (): Promise<never> => {
  throw Object.assign(new Error('Offline maps are available in the Android app.'), { code: 'UNSUPPORTED' });
};
export const nativeOfflineBackend: OfflineMapBackend = {
  prepare: unavailable, list: unavailable, estimate: unavailable,
  cancelEstimate: unavailable, start: unavailable, pause: unavailable,
  remove: unavailable, storage: unavailable, subscribe: () => () => undefined,
};

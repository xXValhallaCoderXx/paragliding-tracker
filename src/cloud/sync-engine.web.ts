import type { CloudSyncEngine, SyncSnapshot } from './types';

const UNSUPPORTED: SyncSnapshot = {
  phase: 'blocked',
  blockedBy: 'unsupported',
  lastSyncAt: null,
  pendingFlights: 0,
  pendingDeletions: 0,
  cloudOnlyFlights: 0,
  lastError: null,
};

export const cloudSyncEngine: CloudSyncEngine = {
  getSnapshot: () => UNSUPPORTED,
  rebindTo: async () => undefined,
  requestSync: async () => UNSUPPORTED,
  subscribe: (listener) => {
    listener(UNSUPPORTED);
    return () => undefined;
  },
};

import type { EquipmentRepositoryCore } from './repository-core';
import { subscribeEquipment } from './events';
const unavailable = async (): Promise<never> => { throw new Error('Aircraft management is available in the native app.'); };
export const equipmentRepository: Pick<EquipmentRepositoryCore, keyof EquipmentRepositoryCore> = {
  subscribe: subscribeEquipment,
  getActiveOwner: async () => 'guest',
  getInventory: async () => ({ owner: 'guest', aircraft: [], identities: [], selection: {
    kind: 'selection', id: 'current', value: { aircraftId: null }, generation: 0, serverRevision: 0, pending: false, conflict: null,
  } }),
  saveAircraft: unavailable, saveIdentity: unavailable, setCurrent: unavailable, setArchived: unavailable,
  listPending: async () => [], isPending: async () => false, applyRemote: unavailable, acknowledge: unavailable, recordSyncFailure: unavailable, resolveConflict: unavailable,
};

import { notifyEquipment, subscribeEquipment } from '../lib/equipment-events';
import { normalizeAircraft, normalizeEquipmentValue, normalizeIdentity, normalizeRemoteEntity } from './equipment-validation';
import type {
  Aircraft, EquipmentCaptureIntent, EquipmentDatabaseAccess, EquipmentEntity, EquipmentEntityKind,
  EquipmentInventory, EquipmentMutation, EquipmentRemoteEntity, EquipmentSelection, EquipmentSnapshot,
  EquipmentSqlExecutor, EquipmentValue, SaveAircraftInput, Sport, SportIdentity,
} from '../lib/equipment-types';

interface EntityRow {
  owner_key: string; kind: EquipmentEntityKind; entity_id: string; value_json: string;
  local_generation: number; server_revision: number; operation_id: string | null;
  conflict_json: string | null; last_error: string | null;
}
const entitySql = 'SELECT * FROM equipment_entities WHERE owner_key = ? AND kind = ? AND entity_id = ?';
const stale = () => new Error('These aircraft details changed. Review the latest details and try again.');
const equal = (left: EquipmentValue, right: EquipmentValue) => JSON.stringify(left) === JSON.stringify(right);
const currentValue = (row: EntityRow): EquipmentValue => normalizeEquipmentValue(row.kind, row.entity_id, JSON.parse(row.value_json));
const entity = (row: EntityRow): EquipmentEntity => ({
  kind: row.kind, id: row.entity_id, value: currentValue(row), generation: row.local_generation,
  serverRevision: row.server_revision, pending: row.operation_id !== null,
  conflict: row.conflict_json ? normalizeRemoteEntity(JSON.parse(row.conflict_json)) : null, lastError: row.last_error,
});
const emptySelection = (): EquipmentEntity<EquipmentSelection> => ({
  kind: 'selection', id: 'current', value: { aircraftId: null }, generation: 0, serverRevision: 0, pending: false, conflict: null,
});
export async function readEquipmentOwner(db: EquipmentSqlExecutor): Promise<string> {
  const row = await db.getFirstAsync<{ user_id: string | null }>('SELECT user_id FROM cloud_link WHERE id = 1');
  if (row?.user_id) return row.user_id;
  const remembered = await db.getFirstAsync<{ active_owner: string }>('SELECT active_owner FROM equipment_settings WHERE id=1');
  return remembered?.active_owner ?? 'guest';
}
export async function rememberEquipmentOwner(db: EquipmentSqlExecutor, owner: string): Promise<void> {
  await db.runAsync('UPDATE equipment_settings SET active_owner=? WHERE id=1', owner);
}
async function checkOwner(db: EquipmentSqlExecutor, owner: string): Promise<void> {
  if (await readEquipmentOwner(db) !== owner) throw new Error('The aircraft account changed. Reopen Pilot and try again.');
}
async function readInventory(db: EquipmentSqlExecutor, owner: string): Promise<EquipmentInventory> {
  const rows = await db.getAllAsync<EntityRow>('SELECT * FROM equipment_entities WHERE owner_key = ? ORDER BY entity_id', owner);
  const entries = rows.map(entity);
  return {
    owner,
    aircraft: entries.filter(item => item.kind === 'aircraft') as EquipmentEntity<Aircraft>[],
    identities: entries.filter(item => item.kind === 'sport') as EquipmentEntity<SportIdentity>[],
    selection: (entries.find(item => item.kind === 'selection') as EquipmentEntity<EquipmentSelection> | undefined) ?? emptySelection(),
  };
}
async function requireGeneration(db: EquipmentSqlExecutor, owner: string, kind: EquipmentEntityKind, id: string, expected?: number): Promise<EntityRow | null> {
  const row = await db.getFirstAsync<EntityRow>(entitySql, owner, kind, id);
  if (expected !== undefined && expected !== (row?.local_generation ?? 0)) throw stale();
  if (row?.conflict_json) throw new Error('Resolve the saved aircraft conflict before editing these details.');
  return row;
}
async function writeLocal(db: EquipmentSqlExecutor, owner: string, kind: EquipmentEntityKind, id: string, value: EquipmentValue, operationId: string): Promise<void> {
  const normalized = normalizeEquipmentValue(kind, id, value);
  const old = await db.getFirstAsync<EntityRow>(entitySql, owner, kind, id);
  if (old?.conflict_json) throw new Error('Resolve the saved aircraft conflict before editing these details.');
  if (old && equal(currentValue(old), normalized)) return;
  await db.runAsync(`INSERT INTO equipment_entities
    (owner_key,kind,entity_id,value_json,local_generation,server_revision,operation_id,conflict_json,last_error)
    VALUES(?,?,?,?,1,0,?,NULL,NULL)
    ON CONFLICT(owner_key,kind,entity_id) DO UPDATE SET value_json=excluded.value_json,
      local_generation=equipment_entities.local_generation+1, operation_id=excluded.operation_id, last_error=NULL`,
  owner, kind, id, JSON.stringify(normalized), operationId);
}

/** Only the first unclaimed link transfers guest inventory. Rebinding never moves owned rows. */
export async function claimGuestEquipment(db: EquipmentSqlExecutor, owner: string): Promise<void> {
  const guests = await db.getAllAsync<EntityRow>("SELECT * FROM equipment_entities WHERE owner_key = 'guest'");
  for (const guest of guests) {
    const prior = await db.getFirstAsync<EntityRow>(entitySql, owner, guest.kind, guest.entity_id);
    if (prior) {
      // Preserve both drafts when an account inventory was restored before first binding.
      const conflict = { kind: prior.kind, id: prior.entity_id, value: currentValue(prior), revision: prior.server_revision };
      if (prior.server_revision < 1) throw new Error('This account already has unsent aircraft details. Resolve them before linking the guest inventory.');
      await db.runAsync(`UPDATE equipment_entities SET value_json=?, local_generation=local_generation+1,
        operation_id=?, conflict_json=?, last_error=NULL WHERE owner_key=? AND kind=? AND entity_id=?`,
      guest.value_json, guest.operation_id, JSON.stringify(conflict), owner, guest.kind, guest.entity_id);
      await db.runAsync("DELETE FROM equipment_entities WHERE owner_key='guest' AND kind=? AND entity_id=?", guest.kind, guest.entity_id);
    } else {
      await db.runAsync("UPDATE equipment_entities SET owner_key=? WHERE owner_key='guest' AND kind=? AND entity_id=?", owner, guest.kind, guest.entity_id);
    }
  }
}

/** Read inside createSession's exclusive transaction, after permission prompts finish. */
export async function captureEquipmentSnapshot(db: EquipmentSqlExecutor, capturedAt: number, intent?: EquipmentCaptureIntent): Promise<EquipmentSnapshot> {
  const owner = await readEquipmentOwner(db);
  if (intent?.owner !== undefined && intent.owner !== owner) throw new Error('The aircraft account changed. Review your aircraft before starting.');
  let id = intent?.aircraftId;
  if (!intent) {
    const selection = await db.getFirstAsync<EntityRow>(entitySql, owner, 'selection', 'current');
    id = selection ? (currentValue(selection) as EquipmentSelection).aircraftId : null;
  }
  if (id === null || id === undefined) return { version: 1, capturedAt, aircraftId: null, sport: null, model: null, size: null, registrationId: null };
  const row = await db.getFirstAsync<EntityRow>(entitySql, owner, 'aircraft', id);
  if (!row || (intent?.aircraftId !== null && intent?.expectedGeneration !== undefined && row.local_generation !== intent.expectedGeneration)) throw stale();
  const aircraft = currentValue(row) as Aircraft;
  if (aircraft.archived) throw new Error('This aircraft was archived. Choose another aircraft or start without one.');
  if (row.conflict_json) throw new Error('This aircraft has a backup conflict. Resolve it or start without aircraft details.');
  return { version: 1, capturedAt, aircraftId: aircraft.id, sport: aircraft.sport, model: aircraft.model,
    size: aircraft.size, registrationId: aircraft.registrationId };
}

export interface EquipmentRepositoryDependencies { database: EquipmentDatabaseAccess; uuid(): string }
export class EquipmentRepositoryCore {
  constructor(private readonly dependencies: EquipmentRepositoryDependencies) {}
  subscribe = subscribeEquipment;
  getActiveOwner(): Promise<string> { return this.dependencies.database.read(readEquipmentOwner); }
  getInventory(): Promise<EquipmentInventory> {
    return this.dependencies.database.read(async db => {
      const owner = await readEquipmentOwner(db);
      const result = await readInventory(db, owner);
      await checkOwner(db, owner);
      return result;
    });
  }
  private async edit(owner: string, operation: (db: EquipmentSqlExecutor) => Promise<void>): Promise<EquipmentInventory> {
    const result = await this.dependencies.database.write(async db => {
      await checkOwner(db, owner);
      await operation(db);
      return readInventory(db, owner);
    });
    notifyEquipment();
    return result;
  }
  async saveAircraft(input: SaveAircraftInput): Promise<EquipmentInventory> {
    const id = input.id ?? this.dependencies.uuid();
    const aircraft = normalizeAircraft({ id, sport: input.sport, model: input.model,
      size: input.size ?? null, registrationId: input.registrationId ?? null, archived: false });
    return this.edit(input.owner, async db => {
      const old = await requireGeneration(db, input.owner, 'aircraft', id, input.expectedGeneration);
      if (input.id && !old) throw stale();
      if (old && (currentValue(old) as Aircraft).archived) throw new Error('Restore this aircraft before editing it.');
      if (input.identity !== undefined) {
        await requireGeneration(db, input.owner, 'sport', input.sport, input.identity.expectedGeneration);
        await writeLocal(db, input.owner, 'sport', input.sport,
          normalizeIdentity({ sport: input.sport, pilotIdentifier: input.identity.pilotIdentifier }), this.dependencies.uuid());
      }
      await writeLocal(db, input.owner, 'aircraft', id, aircraft, this.dependencies.uuid());
      const selection = await db.getFirstAsync<EntityRow>(entitySql, input.owner, 'selection', 'current');
      const wasCurrent = selection && (currentValue(selection) as EquipmentSelection).aircraftId === id;
      if (input.makeCurrent === true || (input.makeCurrent === false && wasCurrent)) {
        await requireGeneration(db, input.owner, 'selection', 'current', input.expectedSelectionGeneration);
        await writeLocal(db, input.owner, 'selection', 'current', { aircraftId: input.makeCurrent ? id : null }, this.dependencies.uuid());
      }
    });
  }
  async saveIdentity(owner: string, sport: Sport, pilotIdentifier: string | null, expectedGeneration?: number): Promise<EquipmentInventory> {
    const value = normalizeIdentity({ sport, pilotIdentifier });
    return this.edit(owner, async db => {
      await requireGeneration(db, owner, 'sport', sport, expectedGeneration);
      await writeLocal(db, owner, 'sport', sport, value, this.dependencies.uuid());
    });
  }
  setCurrent(owner: string, aircraftId: string | null, expectedGeneration?: number): Promise<EquipmentInventory> {
    return this.edit(owner, async db => {
      await requireGeneration(db, owner, 'selection', 'current', expectedGeneration);
      if (aircraftId) {
        const aircraft = await requireGeneration(db, owner, 'aircraft', aircraftId);
        if (!aircraft || (currentValue(aircraft) as Aircraft).archived) throw new Error('Choose an active aircraft.');
      }
      await writeLocal(db, owner, 'selection', 'current', { aircraftId }, this.dependencies.uuid());
    });
  }
  setArchived(owner: string, id: string, archived: boolean, expectedGeneration: number): Promise<EquipmentInventory> {
    return this.edit(owner, async db => {
      const row = await requireGeneration(db, owner, 'aircraft', id, expectedGeneration);
      if (!row) throw stale();
      await writeLocal(db, owner, 'aircraft', id, { ...currentValue(row) as Aircraft, archived }, this.dependencies.uuid());
      const selection = await db.getFirstAsync<EntityRow>(entitySql, owner, 'selection', 'current');
      if (archived && selection && (currentValue(selection) as EquipmentSelection).aircraftId === id) {
        await writeLocal(db, owner, 'selection', 'current', { aircraftId: null }, this.dependencies.uuid());
      }
    });
  }
  listPending(owner: string, limit = 100): Promise<EquipmentMutation[]> {
    return this.dependencies.database.read(async db => {
      await checkOwner(db, owner);
      if (owner === 'guest') return [];
      const rows = await db.getAllAsync<EntityRow>(`SELECT * FROM equipment_entities WHERE owner_key=?
        AND operation_id IS NOT NULL AND conflict_json IS NULL
        ORDER BY CASE kind WHEN 'sport' THEN 0 WHEN 'aircraft' THEN 1 ELSE 2 END, entity_id LIMIT ?`, owner, limit);
      return rows.map(row => ({ owner, kind: row.kind, id: row.entity_id, value: currentValue(row),
        operationId: row.operation_id!, expectedRevision: row.server_revision, generation: row.local_generation }));
    });
  }
  isPending(mutation: EquipmentMutation): Promise<boolean> {
    return this.dependencies.database.read(async db => {
      if (await readEquipmentOwner(db) !== mutation.owner) return false;
      const row = await db.getFirstAsync<EntityRow>(entitySql, mutation.owner, mutation.kind, mutation.id);
      return row?.operation_id === mutation.operationId && row.local_generation === mutation.generation &&
        row.server_revision === mutation.expectedRevision && row.conflict_json === null;
    });
  }
  private async mergeRemote(db: EquipmentSqlExecutor, owner: string, input: EquipmentRemoteEntity): Promise<void> {
    const remote = normalizeRemoteEntity(input);
    const old = await db.getFirstAsync<EntityRow>(entitySql, owner, remote.kind, remote.id);
    if (old && old.server_revision > remote.revision) return;
    if (old?.conflict_json && normalizeRemoteEntity(JSON.parse(old.conflict_json)).revision > remote.revision) return;
    if (old?.operation_id && !equal(currentValue(old), remote.value)) {
      if (remote.revision <= old.server_revision) return;
      await db.runAsync('UPDATE equipment_entities SET conflict_json=? WHERE owner_key=? AND kind=? AND entity_id=?',
        JSON.stringify(remote), owner, remote.kind, remote.id);
      return;
    }
    await db.runAsync(`INSERT INTO equipment_entities
      (owner_key,kind,entity_id,value_json,local_generation,server_revision,operation_id,conflict_json,last_error)
      VALUES(?,?,?,?,1,?,NULL,NULL,NULL)
      ON CONFLICT(owner_key,kind,entity_id) DO UPDATE SET value_json=excluded.value_json,
        local_generation=CASE WHEN equipment_entities.value_json<>excluded.value_json THEN equipment_entities.local_generation+1 ELSE equipment_entities.local_generation END,
        server_revision=excluded.server_revision,operation_id=NULL,conflict_json=NULL,last_error=NULL`,
    owner, remote.kind, remote.id, JSON.stringify(remote.value), remote.revision);
  }
  async applyRemote(owner: string, entities: EquipmentRemoteEntity[], guard: () => void = () => {}): Promise<void> {
    await this.dependencies.database.write(async db => {
      guard(); await checkOwner(db, owner);
      for (const remote of entities) { guard(); await this.mergeRemote(db, owner, remote); }
      guard();
    });
    notifyEquipment();
  }
  async acknowledge(mutation: EquipmentMutation, result: { status: 'applied' | 'conflict'; entity: EquipmentRemoteEntity; related?: EquipmentRemoteEntity[] }, guard: () => void = () => {}): Promise<void> {
    const remote = normalizeRemoteEntity(result.entity);
    if (remote.kind !== mutation.kind || remote.id !== mutation.id) throw new Error('The equipment response belongs to another edit.');
    await this.dependencies.database.write(async db => {
      guard(); await checkOwner(db, mutation.owner);
      const row = await db.getFirstAsync<EntityRow>(entitySql, mutation.owner, mutation.kind, mutation.id);
      if (!row || row.server_revision > remote.revision) return;
      if (row.conflict_json && normalizeRemoteEntity(JSON.parse(row.conflict_json)).revision > remote.revision) return;
      const sameOperation = row.operation_id === mutation.operationId && row.local_generation === mutation.generation;
      if (result.status === 'applied' && sameOperation) {
        await db.runAsync(`UPDATE equipment_entities SET value_json=?,server_revision=?,operation_id=NULL,conflict_json=NULL,last_error=NULL
          WHERE owner_key=? AND kind=? AND entity_id=?`, JSON.stringify(remote.value), remote.revision, mutation.owner, mutation.kind, mutation.id);
      } else if (result.status === 'applied' && row.local_generation > mutation.generation) {
        // The older edit was accepted. Preserve the later local draft and rebase its next CAS.
        await db.runAsync(`UPDATE equipment_entities SET server_revision=?,conflict_json=NULL,last_error=NULL
          WHERE owner_key=? AND kind=? AND entity_id=?`, remote.revision, mutation.owner, mutation.kind, mutation.id);
      } else {
        await this.mergeRemote(db, mutation.owner, remote);
      }
      for (const related of result.related ?? []) await this.mergeRemote(db, mutation.owner, related);
      guard();
    });
    notifyEquipment();
  }
  async recordSyncFailure(mutation: EquipmentMutation, message: string, guard: () => void = () => {}): Promise<void> {
    await this.dependencies.database.write(async db => {
      guard(); await checkOwner(db, mutation.owner);
      await db.runAsync(`UPDATE equipment_entities SET last_error=? WHERE owner_key=? AND kind=? AND entity_id=? AND operation_id=? AND local_generation=?`,
        message.slice(0, 500), mutation.owner, mutation.kind, mutation.id, mutation.operationId, mutation.generation);
      guard();
    });
    notifyEquipment();
  }
  resolveConflict(owner: string, kind: EquipmentEntityKind, id: string, resolution: 'keep_local' | 'use_remote', expected?: { generation: number; remoteRevision: number }): Promise<EquipmentInventory> {
    return this.edit(owner, async db => {
      const row = await db.getFirstAsync<EntityRow>(entitySql, owner, kind, id);
      if (!row?.conflict_json) throw new Error('This conflict was already resolved. Reopen the latest aircraft details.');
      const remote = normalizeRemoteEntity(JSON.parse(row.conflict_json));
      if (expected && (row.local_generation !== expected.generation || remote.revision !== expected.remoteRevision)) throw stale();
      if (kind === 'selection' && resolution === 'keep_local') {
        const target = (currentValue(row) as EquipmentSelection).aircraftId;
        if (target) {
          const aircraft = await db.getFirstAsync<EntityRow>(entitySql, owner, 'aircraft', target);
          if (!aircraft || (currentValue(aircraft) as Aircraft).archived) throw new Error('The selected aircraft is archived. Use the saved selection, then choose an active aircraft.');
        }
      }
      await db.runAsync(`UPDATE equipment_entities SET value_json=?,local_generation=local_generation+1,server_revision=?,
        operation_id=?,conflict_json=NULL,last_error=NULL WHERE owner_key=? AND kind=? AND entity_id=?`,
      resolution === 'use_remote' ? JSON.stringify(remote.value) : row.value_json, remote.revision,
      resolution === 'keep_local' ? this.dependencies.uuid() : null, owner, kind, id);
    });
  }
}

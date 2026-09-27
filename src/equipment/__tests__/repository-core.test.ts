import { TestDatabase, schemaAt } from '../../../tests/support/sqlite';
import { EquipmentRepositoryCore, captureEquipmentSnapshot, claimGuestEquipment } from '../repository-core';
import type { EquipmentEntity, EquipmentRemoteEntity } from '../types';
import { parseEquipmentSnapshot } from '../validation';

let db: TestDatabase;
let repo: EquipmentRepositoryCore;
let sequence: number;
beforeEach(async () => {
  db = new TestDatabase(); await schemaAt(db, 11); sequence = 0;
  repo = new EquipmentRepositoryCore({ uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    database: { read: operation => operation(db), write: async operation => {
      let result!: Awaited<ReturnType<typeof operation>>;
      await db.withExclusiveTransactionAsync(async tx => { result = await operation(tx); });
      return result;
    } } });
});
afterEach(async () => db.closeAsync());
const add = (makeCurrent = true) => repo.saveAircraft({ owner: 'guest', sport: 'paragliding', model: '  Rush 6  ', size: ' MS ', registrationId: ' D-123 ', makeCurrent,
  identity: { pilotIdentifier: ' APPI-123 ', expectedGeneration: 0 } });
const first = async () => (await repo.getInventory()).aircraft[0]!;
async function bind(owner = 'owner-a') {
  await db.withExclusiveTransactionAsync(async tx => {
    await claimGuestEquipment(tx, owner);
    await tx.runAsync('UPDATE cloud_link SET user_id=? WHERE id=1', owner);
  });
}
const remote = (entry: EquipmentEntity, revision: number, value = entry.value): EquipmentRemoteEntity => ({ kind: entry.kind, id: entry.id, value, revision });

it('atomically saves identity, aircraft and optional default and preserves neutral legacy identifiers', async () => {
  await db.runAsync("UPDATE pilot_profile SET registration_id='LEGACY',glider_type='Old wing',glider_id='OLD'");
  const inventory = await add();
  expect(inventory.aircraft[0]!.value).toMatchObject({ model: 'Rush 6', size: 'MS', registrationId: 'D-123', archived: false });
  expect(inventory.identities[0]!.value).toEqual({ sport: 'paragliding', pilotIdentifier: 'APPI-123' });
  expect(inventory.selection.value.aircraftId).toBe(inventory.aircraft[0]!.id);
  expect(await db.getFirstAsync('SELECT registration_id,glider_type,glider_id FROM pilot_profile'))
    .toEqual({ registration_id: 'LEGACY', glider_type: 'Old wing', glider_id: 'OLD' });
  await db.execAsync("CREATE TRIGGER fail_selection BEFORE UPDATE ON equipment_entities WHEN NEW.kind='selection' BEGIN SELECT RAISE(ABORT,'disk full'); END");
  await expect(repo.saveAircraft({ owner: 'guest', sport: 'hang_gliding', model: 'Falcon', makeCurrent: true,
    identity: { pilotIdentifier: 'HG-1' } })).rejects.toThrow('disk full');
  expect((await repo.getInventory()).aircraft).toHaveLength(1);
  expect((await repo.getInventory()).identities).toHaveLength(1);
});

it('guards dirty drafts and default changes using local generations', async () => {
  const inventory = await add(); const aircraft = inventory.aircraft[0]!;
  await repo.setCurrent('guest', null, inventory.selection.generation);
  await expect(repo.saveAircraft({ owner: 'guest', id: aircraft.id, expectedGeneration: aircraft.generation,
    sport: 'paragliding', model: 'Changed', makeCurrent: true, expectedSelectionGeneration: inventory.selection.generation })).rejects.toThrow('changed');
  expect((await first()).value.model).toBe('Rush 6');
  await repo.saveAircraft({ owner: 'guest', id: aircraft.id, expectedGeneration: aircraft.generation, sport: 'paragliding', model: 'New model' });
  await expect(repo.setArchived('guest', aircraft.id, true, aircraft.generation)).rejects.toThrow('changed');
});

it('archive clears current atomically, restore does not select it, and no-current is valid', async () => {
  await add(); const aircraft = await first();
  const archived = await repo.setArchived('guest', aircraft.id, true, aircraft.generation);
  expect(archived.selection.value.aircraftId).toBeNull();
  await expect(repo.setCurrent('guest', aircraft.id)).rejects.toThrow('active');
  const restored = await repo.setArchived('guest', aircraft.id, false, archived.aircraft[0]!.generation);
  expect(restored.selection.value.aircraftId).toBeNull();
});

it('captures canonical aircraft at start and rejects stale, archived or foreign-owner selections', async () => {
  await add(); const aircraft = await first();
  const intent = { owner: 'guest', aircraftId: aircraft.id, expectedGeneration: aircraft.generation };
  const snapshot = await captureEquipmentSnapshot(db, 3000, intent);
  expect(snapshot).toEqual({ version: 1, capturedAt: 3000, aircraftId: aircraft.id, sport: 'paragliding', model: 'Rush 6', size: 'MS', registrationId: 'D-123' });
  await repo.saveAircraft({ owner: 'guest', id: aircraft.id, expectedGeneration: aircraft.generation, sport: 'paragliding', model: 'New wing' });
  await expect(captureEquipmentSnapshot(db, 4000, intent)).rejects.toThrow('changed');
  expect(snapshot.model).toBe('Rush 6');
  const none = await captureEquipmentSnapshot(db, 4000, { owner: 'guest', aircraftId: null });
  expect(none.aircraftId).toBeNull(); expect(parseEquipmentSnapshot(none)).toEqual(none);
  expect(parseEquipmentSnapshot(null)).toBeNull();
  await bind();
  await expect(captureEquipmentSnapshot(db, 4000, intent)).rejects.toThrow('account changed');
  // The preflight query may be unavailable: explicit no-aircraft needs no cached owner.
  expect(await captureEquipmentSnapshot(db, 5000, { aircraftId: null })).toMatchObject({ capturedAt: 5000, aircraftId: null });
  await expect(captureEquipmentSnapshot(db, 5000, { owner: 'guest', aircraftId: null })).rejects.toThrow('account changed');
});

it('claims guest once, separates account partitions, and rejects stale editors after a switch', async () => {
  await add(); const aircraft = await first(); await bind();
  expect((await repo.getInventory()).owner).toBe('owner-a');
  expect(await repo.listPending('owner-a')).toHaveLength(3);
  await expect(repo.setArchived('guest', aircraft.id, true, aircraft.generation)).rejects.toThrow('account changed');
  await db.runAsync("UPDATE cloud_link SET user_id='owner-b'");
  expect((await repo.getInventory()).aircraft).toEqual([]);
  await db.runAsync("UPDATE cloud_link SET user_id='owner-a'");
  expect((await repo.getInventory()).aircraft).toHaveLength(1);
});

it('persists stable operation IDs across retries and retains newer edits after an older acknowledgement', async () => {
  await add(false); await bind(); const aircraft = await first();
  const mutation = (await repo.listPending('owner-a')).find(item => item.kind === 'aircraft')!;
  expect((await repo.listPending('owner-a')).find(item => item.kind === 'aircraft')).toEqual(mutation);
  await repo.saveAircraft({ owner: 'owner-a', id: aircraft.id, expectedGeneration: aircraft.generation, sport: 'paragliding', model: 'Newer draft' });
  await repo.acknowledge(mutation, { status: 'applied', entity: remote(aircraft, 1) });
  const next = (await repo.listPending('owner-a')).find(item => item.kind === 'aircraft')!;
  expect(next).toMatchObject({ value: { model: 'Newer draft' }, expectedRevision: 1, generation: 2 });
  expect(next.operationId).not.toBe(mutation.operationId);
  expect(await repo.isPending(mutation)).toBe(false);
  expect(await repo.isPending(next)).toBe(true);
  await repo.acknowledge(next, { status: 'applied', entity: { kind: next.kind, id: next.id, value: next.value, revision: 2 } });
  expect((await first()).pending).toBe(false);
});

it('persists remote conflicts without losing drafts and makes Keep mine a fresh compare-and-swap', async () => {
  await add(false); await bind(); const aircraft = await first();
  await repo.applyRemote('owner-a', [remote(aircraft, 2, { ...aircraft.value, model: 'Other phone' })]);
  expect((await first()).value.model).toBe('Rush 6');
  expect((await first()).conflict?.value).toMatchObject({ model: 'Other phone' });
  expect((await repo.listPending('owner-a')).some(item => item.kind === 'aircraft')).toBe(false);
  await expect(repo.saveAircraft({ owner: 'owner-a', id: aircraft.id, sport: 'paragliding', model: 'Oops' })).rejects.toThrow('conflict');
  await repo.resolveConflict('owner-a', 'aircraft', aircraft.id, 'keep_local');
  const pending = (await repo.listPending('owner-a')).find(item => item.kind === 'aircraft')!;
  expect(pending.expectedRevision).toBe(2); expect(pending.value).toMatchObject({ model: 'Rush 6' });
  await repo.applyRemote('owner-a', [remote(aircraft, 3, { ...aircraft.value, model: 'Other newer phone' })]);
  await expect(repo.resolveConflict('owner-a', 'aircraft', aircraft.id, 'keep_local', {
    generation: (await first()).generation, remoteRevision: 2,
  })).rejects.toThrow('changed');
  await repo.resolveConflict('owner-a', 'aircraft', aircraft.id, 'use_remote');
  expect(await first()).toMatchObject({ value: { model: 'Other newer phone' }, pending: false, conflict: null });
});

it('rolls back an in-progress cloud merge when its auth or recorder guard becomes stale', async () => {
  await add(false); await bind(); const aircraft = await first();
  let calls = 0;
  await expect(repo.applyRemote('owner-a', [remote(aircraft, 2, { ...aircraft.value, model: 'Remote' })], () => {
    if (++calls === 3) throw new Error('stale account');
  })).rejects.toThrow('stale account');
  expect((await first()).conflict).toBeNull();
});

it('an older retry or acknowledgement cannot erase a newer remote conflict', async () => {
  await add(false); await bind(); const aircraft = await first();
  const mutation = (await repo.listPending('owner-a')).find(item => item.kind === 'aircraft')!;
  await repo.saveAircraft({ owner: 'owner-a', id: aircraft.id, expectedGeneration: aircraft.generation, sport: 'paragliding', model: 'Newer local' });
  await repo.applyRemote('owner-a', [remote(aircraft, 3, { ...aircraft.value, model: 'Latest other phone' })]);
  await repo.acknowledge(mutation, { status: 'applied', entity: remote(aircraft, 1) });
  await repo.applyRemote('owner-a', [remote(aircraft, 2, { ...aircraft.value, model: 'Older other phone' })]);
  expect(await first()).toMatchObject({ value: { model: 'Newer local' }, conflict: { revision: 3, value: { model: 'Latest other phone' } } });
});

it.each(['paragliding', 'hang_gliding', 'speedflying'] as const)('accepts %s with shared validation and no fabricated identifier', async sport => {
  const inventory = await repo.saveAircraft({ owner: 'guest', sport, model: 'Known model', makeCurrent: false });
  expect(inventory.aircraft[0]!.value.sport).toBe(sport);
  expect(inventory.identities).toEqual([]);
  await expect(repo.saveAircraft({ owner: 'guest', sport, model: 'x'.repeat(61) })).rejects.toThrow('60');
});

it('does not accept contradictory empty snapshots or silently treat malformed snapshots as legacy', () => {
  expect(() => parseEquipmentSnapshot({ version: 1, capturedAt: 1, aircraftId: null, sport: 'paragliding' })).toThrow();
  expect(() => parseEquipmentSnapshot('{oops')).toThrow();
});

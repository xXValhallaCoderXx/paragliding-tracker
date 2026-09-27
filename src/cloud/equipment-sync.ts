import { equipmentRepository } from '@/equipment/repository';
import { SPORTS, type Aircraft, type EquipmentEntityKind, type EquipmentMutation, type EquipmentRemoteEntity, type EquipmentValue } from '@/equipment/types';
import type { Json } from './database.types';
import { getSupabase } from './supabase';

type Guard = () => void;
type EquipmentReply = { status: 'applied' | 'conflict'; entity: EquipmentRemoteEntity; related: EquipmentRemoteEntity[] };
const invalid = () => new Error('The aircraft backup response was invalid. Retry synchronization.');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nullableText = (value: unknown, maximum: number) => value === null || typeof value === 'string' && value.length <= maximum;
const sport = (value: unknown) => typeof value === 'string' && (SPORTS as readonly string[]).includes(value);

/** The wire contract is an explicit private projection; never trust a JSON cast. */
export function parseEquipmentEntity(input: unknown): EquipmentRemoteEntity {
  if (!object(input) || !['aircraft', 'sport', 'selection'].includes(String(input.kind)) ||
      typeof input.key !== 'string' || !Number.isSafeInteger(input.revision) || Number(input.revision) < 1 || !object(input.payload)) throw invalid();
  const value = input.payload;
  const kind = input.kind as EquipmentEntityKind;
  let parsed: EquipmentValue;
  if (kind === 'aircraft') {
    if (value.id !== input.key || !sport(value.sport) || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 60 ||
      !nullableText(value.size, 20) || !nullableText(value.registrationId, 30) || typeof value.archived !== 'boolean') throw invalid();
    parsed = { id: input.key, sport: value.sport as Aircraft['sport'], model: value.model,
      size: value.size as string | null, registrationId: value.registrationId as string | null, archived: value.archived };
  } else if (kind === 'sport') {
    if (value.sport !== input.key || !sport(value.sport) || !nullableText(value.pilotIdentifier, 30)) throw invalid();
    parsed = { sport: value.sport as Aircraft['sport'], pilotIdentifier: value.pilotIdentifier as string | null };
  } else {
    if (input.key !== 'current' || !nullableText(value.aircraftId, 36)) throw invalid();
    parsed = { aircraftId: value.aircraftId as string | null };
  }
  return { kind, id: input.key, value: parsed, revision: Number(input.revision) };
}

export function parseEquipmentReply(input: unknown, mutation: EquipmentMutation): EquipmentReply {
  if (!object(input) || !['applied', 'conflict'].includes(String(input.status)) || !Array.isArray(input.related)) throw invalid();
  const entity = parseEquipmentEntity(input.entity);
  if (entity.kind !== mutation.kind || entity.id !== mutation.id) throw invalid();
  if (input.status === 'applied') {
    const dispatched = parseEquipmentEntity({ kind: mutation.kind, key: mutation.id, payload: mutation.value, revision: entity.revision });
    if (entity.revision !== mutation.expectedRevision + 1 || JSON.stringify(entity.value) !== JSON.stringify(dispatched.value)) throw invalid();
  }
  const related = input.related.map(parseEquipmentEntity);
  if (related.length > 1 || related.some(item => item.kind !== 'selection' || item.id !== 'current')) throw invalid();
  return { status: input.status as EquipmentReply['status'], entity, related };
}

export async function equipmentPending(): Promise<{ pending: number; conflicts: number }> {
  const inventory = await equipmentRepository.getInventory();
  const entities = [...inventory.aircraft, ...inventory.identities, inventory.selection];
  return { pending: entities.filter(entity => entity.pending && entity.conflict === null).length,
    conflicts: entities.filter(entity => entity.conflict !== null).length };
}

/** A bound inventory cannot follow an unrelated sign-in. Recorder/network guards also fence local commits. */
export async function syncEquipment(owner: string, guard: Guard): Promise<void> {
  guard();
  if (await equipmentRepository.getActiveOwner() !== owner) return;
  guard();
  const client = getSupabase();
  const session = await client.auth.getSession();
  guard();
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== owner) throw new Error('The aircraft backup account changed. Sign in again.');
  // The RPC derives its owner from the token. Pin it so auth-js cannot substitute a newly signed-in account while resolving fetch headers.
  const authorization = `Bearer ${session.data.session.access_token}`;
  const { data, error } = await client.rpc('read_private_equipment').setHeader('Authorization', authorization);
  if (error) throw error;
  guard();
  if (!object(data) || !Array.isArray(data.entities)) throw invalid();
  const remote = data.entities.map(parseEquipmentEntity);
  if (new Set(remote.map(entity => `${entity.kind}:${entity.id}`)).size !== remote.length) throw invalid();
  await equipmentRepository.applyRemote(owner, remote, guard);
  guard();
  const pending = await equipmentRepository.listPending(owner);
  const failures: unknown[] = [];
  for (const mutation of pending) {
    guard();
    if (mutation.owner !== owner) throw new Error('The aircraft change belongs to another account.');
    if (!await equipmentRepository.isPending(mutation)) continue;
    guard();
    try {
      const result = await client.rpc('write_private_equipment', { p_kind: mutation.kind,
        p_key: mutation.id, p_payload: { ...mutation.value } as Json, p_expected_revision: mutation.expectedRevision,
        p_operation_id: mutation.operationId }).setHeader('Authorization', authorization);
      guard();
      if (result.error) throw result.error;
      await equipmentRepository.acknowledge(mutation, parseEquipmentReply(result.data, mutation), guard);
      guard();
    } catch (failure) {
      guard();
      await equipmentRepository.recordSyncFailure(mutation,
        failure instanceof Error ? failure.message : String((failure as { message?: string })?.message ?? failure), guard);
      failures.push(failure);
    }
  }
  if (failures.length) throw failures[0];
}

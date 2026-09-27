import { SPORTS, type Aircraft, type EquipmentEntityKind, type EquipmentRemoteEntity, type EquipmentSnapshot, type EquipmentValue, type Sport, type SportIdentity } from '../lib/equipment-types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid aircraft details.');
  return value as Record<string, unknown>;
}
export function equipmentText(value: unknown, label: string, limit: number, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  if (required && !normalized) throw new Error(`${label} is required.`);
  return normalized || null;
}
export function equipmentSport(value: unknown): Sport {
  if (!SPORTS.includes(value as Sport)) throw new Error('Choose a supported sport.');
  return value as Sport;
}
export function normalizeAircraft(value: unknown): Aircraft {
  const row = object(value);
  if (typeof row.archived !== 'boolean') throw new Error('Invalid aircraft archive state.');
  return {
    id: equipmentText(row.id, 'Aircraft ID', 128, true)!,
    sport: equipmentSport(row.sport),
    model: equipmentText(row.model, 'Aircraft model', 60, true)!,
    size: equipmentText(row.size, 'Size', 20),
    registrationId: equipmentText(row.registrationId, 'Aircraft registration', 30),
    archived: row.archived,
  };
}
export function normalizeIdentity(value: unknown): SportIdentity {
  const row = object(value);
  return { sport: equipmentSport(row.sport), pilotIdentifier: equipmentText(row.pilotIdentifier, 'Pilot identifier', 30) };
}
export function normalizeEquipmentValue(kind: EquipmentEntityKind, id: string, value: unknown): EquipmentValue {
  if (kind === 'aircraft') {
    const aircraft = normalizeAircraft(value);
    if (aircraft.id !== id) throw new Error('Aircraft identity changed.');
    return aircraft;
  }
  if (kind === 'sport') {
    const identity = normalizeIdentity(value);
    if (identity.sport !== id) throw new Error('Sport identity changed.');
    return identity;
  }
  if (kind !== 'selection' || id !== 'current') throw new Error('Invalid equipment entity.');
  return { aircraftId: equipmentText(object(value).aircraftId, 'Aircraft ID', 128) };
}
export function normalizeRemoteEntity(remote: EquipmentRemoteEntity): EquipmentRemoteEntity {
  if (!Number.isSafeInteger(remote.revision) || remote.revision < 1) throw new Error('Invalid equipment revision.');
  return { kind: remote.kind, id: remote.id, revision: remote.revision, value: normalizeEquipmentValue(remote.kind, remote.id, remote.value) };
}
/** Missing is the legacy state. A malformed captured snapshot never becomes legacy. */
export function parseEquipmentSnapshot(input: unknown): EquipmentSnapshot | null {
  if (input === null || input === undefined) return null;
  const row = object(typeof input === 'string' ? JSON.parse(input) : input);
  if (row.version !== 1 || !Number.isSafeInteger(row.capturedAt) || (row.capturedAt as number) < 0) throw new Error('Invalid recorded aircraft snapshot.');
  if (row.aircraftId === null) {
    if (['sport', 'model', 'size', 'registrationId'].some(key => row[key] !== null)) throw new Error('Invalid empty aircraft snapshot.');
    return { version: 1, capturedAt: row.capturedAt as number, aircraftId: null, sport: null, model: null, size: null, registrationId: null };
  }
  return { version: 1, capturedAt: row.capturedAt as number,
    aircraftId: equipmentText(row.aircraftId, 'Aircraft ID', 128, true)!, sport: equipmentSport(row.sport),
    model: equipmentText(row.model, 'Aircraft model', 60, true)!, size: equipmentText(row.size, 'Size', 20),
    registrationId: equipmentText(row.registrationId, 'Aircraft registration', 30) };
}

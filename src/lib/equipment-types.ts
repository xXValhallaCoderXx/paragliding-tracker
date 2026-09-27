import type { SqlExecutor } from '../recorder/repository-core';

export const SPORTS = ['paragliding', 'hang_gliding', 'speedflying'] as const;
export type Sport = (typeof SPORTS)[number];
export type EquipmentOwner = string;
export type EquipmentEntityKind = 'aircraft' | 'sport' | 'selection';
export interface Aircraft {
  id: string;
  sport: Sport;
  model: string;
  size: string | null;
  registrationId: string | null;
  archived: boolean;
}
export interface SportIdentity { sport: Sport; pilotIdentifier: string | null }
export interface EquipmentSelection { aircraftId: string | null }
export type EquipmentValue = Aircraft | SportIdentity | EquipmentSelection;
export interface EquipmentEntity<T extends EquipmentValue = EquipmentValue> {
  kind: EquipmentEntityKind;
  id: string;
  value: T;
  generation: number;
  serverRevision: number;
  pending: boolean;
  conflict: EquipmentRemoteEntity | null;
  lastError?: string | null;
}
export interface EquipmentRemoteEntity {
  kind: EquipmentEntityKind;
  id: string;
  value: EquipmentValue;
  revision: number;
}
export interface EquipmentInventory {
  owner: EquipmentOwner;
  aircraft: EquipmentEntity<Aircraft>[];
  identities: EquipmentEntity<SportIdentity>[];
  selection: EquipmentEntity<EquipmentSelection>;
}
export interface EquipmentMutation {
  owner: EquipmentOwner;
  kind: EquipmentEntityKind;
  id: string;
  value: EquipmentValue;
  operationId: string;
  expectedRevision: number;
  generation: number;
}
export interface SaveAircraftInput {
  owner: EquipmentOwner;
  id?: string;
  expectedGeneration?: number;
  sport: Sport;
  model: string;
  size?: string | null;
  registrationId?: string | null;
  makeCurrent?: boolean;
  expectedSelectionGeneration?: number;
  /** Present only when the aircraft form also edits this sport's identifier. */
  identity?: { pilotIdentifier: string | null; expectedGeneration?: number };
}
export type EquipmentCaptureIntent =
  | { owner: EquipmentOwner; aircraftId: string; expectedGeneration: number }
  | { owner?: EquipmentOwner; aircraftId: null };
export interface EquipmentSnapshot {
  version: 1;
  capturedAt: number;
  aircraftId: string | null;
  sport: Sport | null;
  model: string | null;
  size: string | null;
  registrationId: string | null;
}
export type FlightEquipmentSnapshot = EquipmentSnapshot;
export interface EquipmentSqlExecutor extends SqlExecutor {
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
}
export interface EquipmentDatabaseAccess {
  read<T>(operation: (database: EquipmentSqlExecutor) => Promise<T>): Promise<T>;
  write<T>(operation: (transaction: EquipmentSqlExecutor) => Promise<T>): Promise<T>;
}

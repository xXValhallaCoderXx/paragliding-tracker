import { SQLiteStorage } from 'expo-sqlite/kv-store';

import type { OfflineMapRegistry, OfflineRegion, OfflineRegionSpec } from './types';

type KeyValueStore = Pick<SQLiteStorage, 'getItem' | 'setItem'>;
const KEY = 'regions-v1';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';

function validSpec(value: unknown): value is OfflineRegionSpec {
  if (!record(value) || !Array.isArray(value.bounds) || value.bounds.length !== 4 ||
    !value.bounds.every(finite) || !Array.isArray(value.center) || value.center.length !== 2 ||
    !value.center.every(finite)) return false;
  const [west, south, east, north] = value.bounds;
  return ['id', 'name', 'context', 'styleURL', 'attribution'].every((key) => typeof value[key] === 'string') &&
    west >= -180 && east <= 180 && west < east && south >= -85.051129 && north <= 85.051129 && south < north &&
    value.center[0] >= -180 && value.center[0] <= 180 && value.center[1] >= -90 && value.center[1] <= 90 &&
    finite(value.minZoom) && finite(value.maxZoom) && value.minZoom >= 0 && value.maxZoom <= 22 &&
    value.minZoom <= value.maxZoom;
}

function validRegion(value: unknown): value is OfflineRegion {
  if (!record(value) || typeof value.id !== 'string' || !validSpec(value.spec)) return false;
  return ['ready', 'downloading', 'updating', 'paused', 'error', 'deleting'].includes(String(value.status)) &&
    typeof value.available === 'boolean' && typeof value.allowMobileData === 'boolean' &&
    nullableString(value.activeNativeId) && nullableString(value.pendingNativeId) && nullableString(value.operationId) &&
    Array.isArray(value.obsoleteNativeIds) && value.obsoleteNativeIds.every((id) => typeof id === 'string') &&
    (value.completedAt === null || finite(value.completedAt)) &&
    (value.pauseReason === null || ['user', 'background', 'network', 'recording', 'storage', 'interrupted'].includes(String(value.pauseReason))) &&
    (value.error === null || (record(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string')) &&
    (value.progress === null || (record(value.progress) &&
      ['completedResources', 'requiredResources', 'completedBytes'].every((key) =>
        finite(value.progress && (value.progress as Record<string, unknown>)[key]) &&
        Number((value.progress as Record<string, unknown>)[key]) >= 0)));
}

/** Corrupt/future metadata is surfaced for recovery; never reset a user's downloads silently. */
export function parseOfflineRegistry(raw: string | null): OfflineRegion[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (record(value) && value.version === 1 && Array.isArray(value.regions) && value.regions.every(validRegion) &&
      new Set(value.regions.map((r) => r.id)).size === value.regions.length) return value.regions;
  } catch { /* handled as metadata failure below */ }
  throw Object.assign(new Error('Saved map information could not be read. Your recorded flights are unaffected. Retry opening offline maps.'),
    { code: 'REGISTRY_INVALID' });
}

export function createOfflineRegistry(storage: KeyValueStore = new SQLiteStorage('xc-offline-maps.db')): OfflineMapRegistry {
  return {
    async read() { return parseOfflineRegistry(await storage.getItem(KEY)); },
    async write(regions) {
      const raw = JSON.stringify({ version: 1, regions });
      parseOfflineRegistry(raw);
      await storage.setItem(KEY, raw);
    },
  };
}

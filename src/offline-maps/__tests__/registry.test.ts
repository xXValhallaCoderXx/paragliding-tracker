import { createOfflineRegistry, parseOfflineRegistry } from '../registry';
import type { OfflineRegion } from '../types';

jest.mock('expo-sqlite/kv-store', () => ({ SQLiteStorage: jest.fn() }));

const region: OfflineRegion = {
  id: 'jugra', spec: { id: 'jugra', name: 'Around Jugra', context: 'Malaysia',
    bounds: [101, 2, 102, 3], center: [101.5, 2.5], styleURL: 'mapbox://styles/mapbox/outdoors-v12',
    minZoom: 0, maxZoom: 14, attribution: '© OpenStreetMap contributors' },
  status: 'paused', available: false, activeNativeId: null, pendingNativeId: 'native-1',
  obsoleteNativeIds: [], operationId: null, completedAt: null, progress: null,
  error: null, pauseReason: 'interrupted', allowMobileData: false,
};

it('round-trips intent atomically and leaves storage errors visible', async () => {
  let raw: string | null = null;
  const store = { getItem: jest.fn(async () => raw), setItem: jest.fn(async (_key: string, value: string) => { raw = value; }) };
  const registry = createOfflineRegistry(store);
  expect(await registry.read()).toEqual([]);
  await registry.write([region]);
  expect(await registry.read()).toEqual([region]);
  store.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(registry.write([])).rejects.toThrow('disk full');
  expect(await registry.read()).toEqual([region]);
});

it('rejects malformed, future or duplicate metadata without clearing the existing store', () => {
  for (const raw of ['{', '{}', JSON.stringify({ version: 2, regions: [] }),
    JSON.stringify({ version: 1, regions: [region, region] }),
    JSON.stringify({ version: 1, regions: [{ ...region, spec: { ...region.spec, bounds: [101, 3, 102, 2] } }] }),
    JSON.stringify({ version: 1, regions: [{ ...region, progress: { completedResources: -1 } }] })]) {
    expect(() => parseOfflineRegistry(raw)).toThrow('Saved map information could not be read');
  }
});

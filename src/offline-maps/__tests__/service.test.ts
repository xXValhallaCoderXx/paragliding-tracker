import { OfflineMapService, coversRegion, downloadPauseReason } from '../service';
import {
  OFFLINE_MAP_FREE_SPACE_RESERVE,
  type NativeDownloadEvent,
  type NativeOfflineRegion,
  type OfflineEnvironment,
  type OfflineMapBackend,
  type OfflineMapRegistry,
  type OfflineRegion,
  type OfflineRegionSpec,
} from '../types';

const spec: OfflineRegionSpec = {
  id: 'jugra', name: 'Bukit Jugra', context: 'Selangor, Malaysia', bounds: [101, 2, 102, 3],
  center: [101.5, 2.5], styleURL: 'mapbox://styles/mapbox/outdoors-v12', minZoom: 0, maxZoom: 14, attribution: 'OpenStreetMap',
};
const environment: OfflineEnvironment = { foreground: true, recorderReady: true, recorderBusy: false, network: 'wifi' };
const options = { allowMobileData: false, allowUnknownEstimate: true };
const progress = { completedResources: 5, requiredResources: 10, completedBytes: 1_000 };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let count = 0; count < 50; count++) await Promise.resolve(); };

function fixture(initial: OfflineRegion[] = []) {
  let stored = structuredClone(initial);
  let native: NativeOfflineRegion[] = [];
  let listener: ((event: NativeDownloadEvent) => void) | null = null;
  let time = 1_000;
  let count = 0;
  const registry: OfflineMapRegistry = {
    read: jest.fn(async () => structuredClone(stored)),
    write: jest.fn(async (rows) => { stored = structuredClone([...rows]); }),
  };
  const backend: OfflineMapBackend = {
    prepare: jest.fn(async () => undefined),
    list: jest.fn(async () => structuredClone(native)),
    estimate: jest.fn(async () => ({ transferBytes: 500, storageBytes: 1_000, errorMargin: 0.1 })),
    cancelEstimate: jest.fn(async () => undefined),
    start: jest.fn(async (request) => { native.push({ ...progress, id: request.nativeId, logicalRegionId: request.logicalRegionId, spec: request.spec, ready: false }); }),
    pause: jest.fn(async () => undefined),
    remove: jest.fn(async (id) => { native = native.filter((row) => row.id !== id); }),
    storage: jest.fn(async () => ({ usedBytes: 1_000, freeBytes: 20 * OFFLINE_MAP_FREE_SPACE_RESERVE })),
    subscribe: jest.fn((next) => { listener = next; return jest.fn(() => { listener = null; }); }),
  };
  const service = new OfflineMapService({ backend, registry, id: () => `id-${++count}`, now: () => time });
  service.setEnvironment(environment);
  const request = () => jest.mocked(backend.start).mock.calls.at(-1)![0];
  const emit = (kind: NativeDownloadEvent['kind'], extra: Partial<NativeDownloadEvent> = {}) => {
    const current = request();
    listener?.({ ...progress, nativeId: current.nativeId, operationId: current.operationId, kind, ...extra });
  };
  const complete = async () => {
    const current = request();
    native = native.map((row) => row.id === current.nativeId ? { ...row, ready: true } : row);
    emit('complete'); await tick();
  };
  return { service, backend, registry, request, emit, complete, stored: () => stored,
    setNative: (rows: NativeOfflineRegion[]) => { native = rows; }, native: () => native,
    advance: () => { time += 3_000; } };
}

it('persists intent before native start, verifies completion and reuses fully covered selections', async () => {
  const f = fixture(); await f.service.initialize();
  const write = deferred();
  jest.mocked(f.registry.write).mockImplementationOnce(async (rows) => { expect(rows[0].status).toBe('downloading'); await write.promise; });
  const starting = f.service.download(spec, options); await tick();
  expect(f.backend.start).not.toHaveBeenCalled();
  write.resolve(); const id = await starting;
  await f.complete();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ id, available: true, status: 'ready', pendingNativeId: null });
  expect(await f.service.download({ ...spec, id: 'smaller', bounds: [101.2, 2.2, 101.4, 2.4], maxZoom: 13 }, options)).toBe(id);
  expect(f.backend.start).toHaveBeenCalledTimes(1);
});

it('accepts an immediate native completion for reused resources', async () => {
  const f = fixture(); await f.service.initialize();
  jest.mocked(f.backend.start).mockImplementationOnce(async (request) => {
    f.setNative([{ ...progress, id: request.nativeId, logicalRegionId: request.logicalRegionId, spec, ready: true }]);
    f.emit('complete');
  });
  await f.service.download(spec, options); await tick();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'ready', available: true });
});

it('reuses adjacent ready areas that jointly cover a selection without creating another download', async () => {
  const f = fixture(); await f.service.initialize();
  await f.service.download({ ...spec, bounds: [10, 10, 11, 11] }, options); await f.complete();
  const first = await f.service.download(spec, options); await f.complete();
  await f.service.download({ ...spec, bounds: [102, 2, 103, 3] }, options); await f.complete();
  expect(await f.service.download({ ...spec, bounds: [101.5, 2, 102.5, 3] }, options)).toBe(first);
  expect(f.backend.start).toHaveBeenCalledTimes(3);
  expect(f.service.getSnapshot().regions).toHaveLength(3);
});

it('does not reuse a union that lacks lower zoom coverage requested by the new selection', async () => {
  const f = fixture(); await f.service.initialize();
  await f.service.download({ ...spec, minZoom: 10 }, options); await f.complete();
  await f.service.download({ ...spec, bounds: [102, 2, 103, 3], minZoom: 10 }, options); await f.complete();
  await f.service.download({ ...spec, bounds: [101.5, 2, 102.5, 3] }, options);
  expect(f.backend.start).toHaveBeenCalledTimes(3);
  expect(f.service.getSnapshot().regions).toHaveLength(3);
});

it('rejects an unverified completion receipt and keeps it resumable', async () => {
  const f = fixture(); await f.service.initialize(); await f.service.download(spec, options);
  f.emit('complete'); await tick();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ available: false, status: 'error', error: { code: 'completion_unverified' } });
});

it('revokes synchronously on recording and ignores completion racing native start acceptance', async () => {
  const f = fixture(); await f.service.initialize();
  const accepted = deferred();
  jest.mocked(f.backend.start).mockImplementationOnce(async () => accepted.promise);
  const starting = f.service.download(spec, options); await tick();
  f.service.setEnvironment({ ...environment, recorderBusy: true });
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'paused', pauseReason: 'recording' });
  expect(f.backend.pause).toHaveBeenCalledTimes(1);
  f.emit('complete'); accepted.resolve(); await starting; await tick();
  expect(f.backend.pause).toHaveBeenCalledTimes(2);
  expect(f.service.getSnapshot().regions[0].available).toBe(false);
  f.service.setEnvironment(environment); await tick();
  expect(f.backend.start).toHaveBeenCalledTimes(1);
});

it('does not start after the app backgrounds while intent is being persisted', async () => {
  const f = fixture(); await f.service.initialize();
  const persisted = deferred(); jest.mocked(f.registry.write).mockImplementationOnce(() => persisted.promise);
  const starting = f.service.download(spec, options); await tick();
  f.service.setEnvironment({ ...environment, foreground: false });
  persisted.resolve(); await starting; await tick();
  expect(f.backend.start).not.toHaveBeenCalled();
  expect(f.stored()[0]).toMatchObject({ status: 'paused', pauseReason: 'background' });
});

it('Wi-Fi loss pauses, returning Wi-Fi never resumes, and explicit mobile override allows a new attempt', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options);
  f.service.setEnvironment({ ...environment, network: 'other' }); await tick();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'paused', pauseReason: 'network' });
  await expect(f.service.resume(id, options)).rejects.toMatchObject({ code: 'network' });
  await f.service.resume(id, { ...options, allowMobileData: true });
  expect(f.request().allowMobileData).toBe(true);
  f.service.setEnvironment({ ...environment, network: 'offline' }); await tick();
  f.service.setEnvironment(environment); await tick();
  expect(f.backend.start).toHaveBeenCalledTimes(2);
});

it('serializes transfers, cancels a new download and rejects its late callbacks', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options);
  await expect(f.service.download({ ...spec, bounds: [10, 10, 11, 11] }, options)).rejects.toMatchObject({ code: 'download_busy' });
  await f.service.cancel(id); f.emit('complete'); await tick();
  expect(f.service.getSnapshot().regions).toEqual([]);
  expect(f.backend.remove).toHaveBeenCalledWith(f.request().nativeId);
});

it('failed and cancelled updates keep the completed original native region available', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  const original = f.request().nativeId;
  await f.service.update(id, options);
  expect(f.request()).toMatchObject({ refresh: true });
  expect(f.request().nativeId).not.toBe(original);
  f.emit('error', { error: { code: 'network', message: 'No signal' } }); await tick();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'error', available: true, activeNativeId: original });
  await f.service.cancel(id);
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'ready', available: true, activeNativeId: original });
  expect(f.backend.remove).not.toHaveBeenCalledWith(original);
});

it('successful update swaps only after native verification and tracks cleanup failure for retry', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  const original = f.request().nativeId;
  await f.service.update(id, options);
  jest.mocked(f.backend.remove).mockRejectedValueOnce(new Error('busy'));
  await f.complete();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ available: true, activeNativeId: f.request().nativeId, obsoleteNativeIds: [original] });
  await f.service.refresh();
  expect(f.service.getSnapshot().regions[0].obsoleteNativeIds).toEqual([]);
});

it('deleting an overlapping region only removes its own native ids', async () => {
  const f = fixture(); await f.service.initialize(); const first = await f.service.download(spec, options); await f.complete();
  const firstNative = f.request().nativeId;
  const second = await f.service.download({ ...spec, bounds: [101.5, 2.5, 102.5, 3.5] }, options); await f.complete();
  const secondNative = f.request().nativeId;
  await f.service.remove(first);
  expect(f.backend.remove).toHaveBeenCalledWith(firstNative);
  expect(f.backend.remove).not.toHaveBeenCalledWith(secondNative);
  expect(f.service.getSnapshot().regions).toEqual([expect.objectContaining({ id: second, available: true })]);
});

it('persists deletion intent and retries a partial native deletion after restart', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  jest.mocked(f.backend.remove).mockRejectedValueOnce(new Error('busy'));
  await expect(f.service.remove(id)).rejects.toThrow('busy');
  expect(f.stored()[0].status).toBe('deleting');
  await f.service.refresh();
  expect(f.service.getSnapshot().regions).toEqual([]);
});

it('cold reconciliation distrusts missing ready regions and makes unfinished work manually resumable', async () => {
  const f = fixture(); await f.service.initialize(); await f.service.download(spec, options); await f.complete();
  const saved = f.stored();
  const next = fixture(saved); await next.service.initialize();
  expect(next.service.getSnapshot().regions[0]).toMatchObject({ available: false, status: 'paused', pauseReason: 'interrupted' });
  expect(next.backend.start).not.toHaveBeenCalled();
});

it('retains an existing unverified saved region through cold refresh until explicitly deleted', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  const original = f.request().nativeId;
  const next = fixture(f.stored());
  // Tiles can be complete while shared style resources or the receipt need repair.
  next.setNative(f.native().map((row) => ({ ...row, completedResources: row.requiredResources, ready: false })));
  await next.service.initialize();
  await next.service.refresh();
  expect(next.service.getSnapshot().regions[0]).toMatchObject({
    available: false, status: 'paused', activeNativeId: original, pendingNativeId: null,
  });
  expect(next.stored()[0].activeNativeId).toBe(original);
  expect(next.backend.remove).not.toHaveBeenCalled();
  expect(next.backend.start).not.toHaveBeenCalled();

  await next.service.remove(id);
  expect(next.backend.remove).toHaveBeenCalledWith(original);
  expect(next.native()).toEqual([]);
  expect(next.stored()).toEqual([]);
});

it('cancels an update with an unverified original without deleting it and repairs on resume', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  const original = f.request().nativeId;
  await f.service.update(id, options);
  const unfinished = f.request().nativeId;
  const next = fixture(f.stored());
  next.setNative(f.native().map((row) => ({ ...row, ready: false })));
  await next.service.initialize();
  expect(next.backend.remove).not.toHaveBeenCalled();

  await next.service.cancel(id);
  expect(next.backend.remove).toHaveBeenCalledWith(unfinished);
  expect(next.backend.remove).not.toHaveBeenCalledWith(original);
  expect(next.stored()[0]).toMatchObject({
    available: false, status: 'paused', activeNativeId: original, pendingNativeId: null,
  });

  await next.service.resume(id, options);
  expect(next.request()).toMatchObject({ refresh: true });
  expect(next.request().nativeId).not.toBe(original);
  expect(next.backend.remove).not.toHaveBeenCalledWith(original);
  await next.complete();
  expect(next.stored()[0]).toMatchObject({ available: true, status: 'ready', activeNativeId: next.request().nativeId });
  expect(next.backend.remove).toHaveBeenCalledWith(original);
});

it('reconstructs native owned regions after metadata loss without downloading again', async () => {
  const f = fixture(); f.setNative([{ ...progress, id: 'native', logicalRegionId: 'saved', spec, ready: true }]);
  await f.service.initialize();
  expect(f.stored()[0]).toMatchObject({ id: 'saved', status: 'ready', activeNativeId: 'native', available: true, completedAt: null });
  expect(f.backend.start).not.toHaveBeenCalled();
});

it('a completion discovered after restart does not reuse an older generation timestamp', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  await f.service.update(id, options);
  const next = fixture(f.stored());
  next.setNative(f.native().map((row) => ({ ...row, ready: true })));
  await next.service.initialize();
  expect(next.service.getSnapshot().regions[0]).toMatchObject({ available: true, completedAt: null });
});

it('defers deletion and obsolete cleanup while recording or recovering and retries when idle', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  f.service.setEnvironment({ ...environment, recorderBusy: true });
  await f.service.remove(id);
  expect(f.backend.remove).not.toHaveBeenCalled();
  expect(f.stored()[0].status).toBe('deleting');
  await f.service.refresh(); expect(f.backend.remove).not.toHaveBeenCalled();
  f.service.setEnvironment(environment); await f.service.refresh();
  expect(f.backend.remove).toHaveBeenCalledTimes(1);
  expect(f.service.getSnapshot().regions).toEqual([]);
});

it.each([
  ['BACKGROUND', 'background'], ['NETWORK', 'network'], ['STORAGE', 'storage'], ['USER_PAUSED', 'user'],
])('maps native %s pauses to a useful manual-resume reason', async (code, pauseReason) => {
  const f = fixture(); await f.service.initialize(); await f.service.download(spec, options);
  f.emit('paused', { error: { code, message: 'Paused' } }); await tick();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'paused', pauseReason });
});

it('registry failure prevents native download and can be retried without losing recorder availability', async () => {
  const f = fixture(); await f.service.initialize();
  jest.mocked(f.registry.write).mockRejectedValueOnce(new Error('disk full'));
  await expect(f.service.download(spec, options)).rejects.toThrow('disk full');
  expect(f.backend.start).not.toHaveBeenCalled();
  const region = f.service.getSnapshot().regions[0];
  expect(region).toMatchObject({ status: 'error', available: false });
  await f.service.resume(region.id, options);
  expect(f.backend.start).toHaveBeenCalledTimes(1);
});

it('requires unknown-size consent and enforces reserve plus estimated storage margin', async () => {
  const f = fixture(); await f.service.initialize();
  await expect(f.service.download(spec, { ...options, allowUnknownEstimate: false })).rejects.toMatchObject({ code: 'estimate_required' });
  jest.mocked(f.backend.storage).mockResolvedValue({ usedBytes: 0, freeBytes: OFFLINE_MAP_FREE_SPACE_RESERVE + 105 });
  await expect(f.service.download(spec, { ...options, estimate: { transferBytes: 50, storageBytes: 100, errorMargin: 0.1 } })).rejects.toMatchObject({ code: 'storage' });
  expect(f.backend.start).not.toHaveBeenCalled();
});

it('pauses on a low-space progress check and never auto-resumes', async () => {
  const f = fixture(); await f.service.initialize(); await f.service.download(spec, options);
  jest.mocked(f.backend.storage).mockResolvedValue({ usedBytes: 1000, freeBytes: OFFLINE_MAP_FREE_SPACE_RESERVE - 1 });
  f.advance(); f.emit('progress'); await tick();
  expect(f.service.getSnapshot().regions[0]).toMatchObject({ status: 'paused', pauseReason: 'storage' });
  expect(f.backend.pause).toHaveBeenCalledTimes(1);
});

it('cancelled estimates ignore late results and dispose cancels active transfer', async () => {
  const f = fixture(); await f.service.initialize();
  const estimate = deferred<{ transferBytes: number; storageBytes: number; errorMargin: number }>();
  jest.mocked(f.backend.estimate).mockReturnValueOnce(estimate.promise);
  const controller = new AbortController(); const pending = f.service.estimate(spec, controller.signal);
  await tick(); controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  estimate.resolve({ transferBytes: 1, storageBytes: 1, errorMargin: 0 });
  expect(f.backend.cancelEstimate).toHaveBeenCalledTimes(1);
  await f.service.download(spec, options); f.service.dispose();
  expect(f.backend.pause).toHaveBeenCalledTimes(1);
});

it('recording cancels an in-progress estimate without waiting for native cancellation', async () => {
  const f = fixture(); await f.service.initialize();
  const estimate = deferred<{ transferBytes: number; storageBytes: number; errorMargin: number }>();
  jest.mocked(f.backend.estimate).mockReturnValueOnce(estimate.promise);
  const pending = f.service.estimate(spec); await tick();
  f.service.setEnvironment({ ...environment, recorderBusy: true });
  await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  expect(f.backend.cancelEstimate).toHaveBeenCalledTimes(1);
  estimate.resolve({ transferBytes: 1, storageBytes: 1, errorMargin: 0 });
});

it('disposing while preparation is pending cannot subscribe or read persistence afterward', async () => {
  const f = fixture(); const prepared = deferred();
  jest.mocked(f.backend.prepare).mockReturnValueOnce(prepared.promise);
  const opening = f.service.initialize(); await tick(); f.service.dispose(); prepared.resolve();
  await expect(opening).rejects.toMatchObject({ code: 'disposed' });
  expect(f.backend.subscribe).not.toHaveBeenCalled();
  expect(f.registry.read).not.toHaveBeenCalled();
  expect(f.registry.write).not.toHaveBeenCalled();
});

it('disposing during reconciliation detaches its listener and prevents persisted results or cleanup', async () => {
  const f = fixture(); const listing = deferred<NativeOfflineRegion[]>();
  jest.mocked(f.backend.list).mockReturnValueOnce(listing.promise);
  const opening = f.service.initialize(); await tick();
  const unsubscribe = jest.mocked(f.backend.subscribe).mock.results[0].value;
  f.service.dispose(); listing.resolve([{ ...progress, id: 'native', logicalRegionId: 'saved', spec, ready: true }]);
  await expect(opening).rejects.toMatchObject({ code: 'disposed' });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.registry.write).not.toHaveBeenCalled();
  expect(f.backend.remove).not.toHaveBeenCalled();
  expect(f.service.getSnapshot().regions).toEqual([]);
});

it('disposing during terminal verification cannot promote readiness or delete a previous generation', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  await f.service.update(id, options);
  const listing = deferred<NativeOfflineRegion[]>();
  jest.mocked(f.backend.list).mockReturnValueOnce(listing.promise);
  f.emit('complete'); await tick(); const writes = jest.mocked(f.registry.write).mock.calls.length;
  f.service.dispose(); listing.resolve(f.native().map((row) => ({ ...row, ready: true }))); await tick();
  expect(f.registry.write).toHaveBeenCalledTimes(writes);
  expect(f.backend.remove).not.toHaveBeenCalled();
  expect(f.service.getSnapshot().regions[0].status).toBe('updating');
});

it('disposing while completion metadata is saving prevents obsolete native cleanup afterward', async () => {
  const f = fixture(); await f.service.initialize(); const id = await f.service.download(spec, options); await f.complete();
  await f.service.update(id, options);
  const saved = deferred(); jest.mocked(f.registry.write).mockReturnValueOnce(saved.promise);
  await f.complete(); f.service.dispose(); saved.resolve(); await tick();
  expect(f.backend.remove).not.toHaveBeenCalled();
});

it('native pause failure and subscriber failure cannot throw through recorder environment changes', async () => {
  const f = fixture(); await f.service.initialize(); await f.service.download(spec, options);
  jest.mocked(f.backend.pause).mockRejectedValueOnce(new Error('native failure'));
  let throwFromObserver = false;
  f.service.subscribe(() => { if (throwFromObserver) throw new Error('observer failed'); });
  throwFromObserver = true;
  expect(() => f.service.setEnvironment({ ...environment, recorderBusy: true })).not.toThrow();
  await tick(); expect(f.service.getSnapshot().regions[0].status).toBe('paused');
});

it('a synchronous native pause failure stays isolated and blocks another transfer until cancellation succeeds', async () => {
  const f = fixture(); await f.service.initialize(); await f.service.download(spec, options);
  jest.mocked(f.backend.pause).mockImplementation(() => { throw new Error('pause unavailable'); });
  expect(() => f.service.setEnvironment({ ...environment, recorderBusy: true })).not.toThrow();
  await tick(); f.service.setEnvironment(environment);
  await expect(f.service.download({ ...spec, bounds: [10, 10, 11, 11] }, options)).rejects.toThrow('pause unavailable');
  expect(f.backend.start).toHaveBeenCalledTimes(1);
  jest.mocked(f.backend.pause).mockResolvedValue(undefined);
  await f.service.download({ ...spec, bounds: [10, 10, 11, 11] }, options);
  expect(f.backend.start).toHaveBeenCalledTimes(2);
});

it('coverage and network policy handle dateline, style, detail, and unknown transport', () => {
  expect(coversRegion({ ...spec, bounds: [170, -10, -170, 10] }, { ...spec, bounds: [175, -5, -175, 5] })).toBe(true);
  expect(coversRegion(spec, { ...spec, maxZoom: 15 })).toBe(false);
  expect(coversRegion(spec, { ...spec, styleURL: 'other' })).toBe(false);
  expect(downloadPauseReason({ ...environment, network: 'unknown' }, true)).toBe('network');
  expect(downloadPauseReason({ ...environment, recorderReady: false }, true)).toBe('recording');
});

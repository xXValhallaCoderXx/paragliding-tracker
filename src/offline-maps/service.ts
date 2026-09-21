import { offlineCoverage } from './coverage';
import {
  OFFLINE_MAP_FREE_SPACE_RESERVE,
  type NativeDownloadEvent,
  type NativeOfflineRegion,
  type OfflineDownloadOptions,
  type OfflineEnvironment,
  type OfflineEstimate,
  type OfflineFailure,
  type OfflineMapBackend,
  type OfflineMapRegistry,
  type OfflineMapSnapshot,
  type OfflinePauseReason,
  type OfflineRegion,
  type OfflineRegionSpec,
} from './types';

interface Transfer {
  regionId: string;
  nativeId: string;
  operationId: string;
  valid: boolean;
  started: boolean;
}

const EMPTY_ENVIRONMENT: OfflineEnvironment = {
  foreground: false, recorderReady: false, recorderBusy: false, network: 'unknown',
};

function failure(error: unknown, code = 'offline_maps_error'): OfflineFailure {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return { code: String(error.code), message: String(error.message) };
  }
  return { code, message: error instanceof Error ? error.message : String(error) };
}

function problem(code: string, message: string): Error & OfflineFailure {
  return Object.assign(new Error(message), { code });
}

export function downloadPauseReason(
  environment: OfflineEnvironment,
  allowMobileData: boolean,
): OfflinePauseReason | null {
  if (!environment.foreground) return 'background';
  if (!environment.recorderReady || environment.recorderBusy) return 'recording';
  if (environment.network !== 'wifi' && !(allowMobileData && environment.network === 'other')) {
    return 'network';
  }
  return null;
}

/** Geographic containment also supports regions straddling the antimeridian. */
export function coversRegion(outer: OfflineRegionSpec, inner: OfflineRegionSpec): boolean {
  if (outer.styleURL !== inner.styleURL || outer.minZoom > inner.minZoom || outer.maxZoom < inner.maxZoom) return false;
  const [ow, os, oe, on] = outer.bounds;
  const [iw, is, ie, inn] = inner.bounds;
  if (os > is || on < inn) return false;
  const intervals = (w: number, e: number): [number, number][] => w <= e ? [[w, e]] : [[w, 180], [-180, e]];
  return intervals(iw, ie).every(([w, e]) => intervals(ow, oe).some(([left, right]) => left <= w && right >= e));
}

function sameCoverage(a: OfflineRegionSpec, b: OfflineRegionSpec): boolean {
  return coversRegion(a, b) && coversRegion(b, a);
}

function nativePauseReason(error?: OfflineFailure): OfflinePauseReason {
  switch (error?.code.toUpperCase()) {
    case 'BACKGROUND': return 'background';
    case 'NETWORK': return 'network';
    case 'STORAGE': return 'storage';
    case 'USER_PAUSED': return 'user';
    case 'RECORDING': return 'recording';
    default: return 'interrupted';
  }
}

/** Owns download intent; the native backend owns bytes and completion receipts. */
export class OfflineMapService {
  private snapshot: OfflineMapSnapshot = { initialized: false, loading: false, regions: [], storage: null, error: null };
  private environment: OfflineEnvironment = EMPTY_ENVIRONMENT;
  private listeners = new Set<(snapshot: OfflineMapSnapshot) => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private transfer: Transfer | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private sequence = 0;
  private lastStorageCheck = -Infinity;
  private pendingPauses = new Map<string, string>();
  private estimates = new Map<string, () => void>();
  private readonly backend: OfflineMapBackend;
  private readonly registry: OfflineMapRegistry;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(options: { backend: OfflineMapBackend; registry: OfflineMapRegistry; now?: () => number; id?: () => string }) {
    this.backend = options.backend;
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => `${this.now()}-${++this.sequence}`);
  }

  getSnapshot = (): OfflineMapSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: OfflineMapSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<OfflineMapSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      // A view or ancillary observer must never throw through a recorder callback.
      try { listener(this.snapshot); } catch { /* Isolate observers. */ }
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      this.assertLive();
      return work();
    });
    this.tail = result.catch(() => undefined);
    return result.catch((error) => {
      this.publish({ error: failure(error) });
      throw error;
    });
  }

  private assertLive(): void {
    if (this.disposed) throw problem('disposed', 'Offline maps have been closed.');
  }

  private region(id: string): OfflineRegion {
    const region = this.snapshot.regions.find((candidate) => candidate.id === id);
    if (!region) throw problem('region_missing', 'This downloaded area no longer exists.');
    return region;
  }

  private replace(region: OfflineRegion): void {
    const exists = this.snapshot.regions.some((candidate) => candidate.id === region.id);
    this.publish({ regions: exists
      ? this.snapshot.regions.map((candidate) => candidate.id === region.id ? region : candidate)
      : [...this.snapshot.regions, region] });
  }

  private async persist(): Promise<void> {
    this.assertLive();
    await this.registry.write(this.snapshot.regions);
  }

  initialize = (): Promise<void> => this.refresh();

  refresh = (): Promise<void> => this.enqueue(async () => {
    // Refresh must not turn an in-process download into interrupted work.
    if (this.transfer?.valid) {
      this.publish({ storage: await this.backend.storage() });
      return;
    }
    this.publish({ loading: true, error: null });
    try {
      await this.backend.prepare();
      this.assertLive();
      if (!this.unsubscribe) this.unsubscribe = this.backend.subscribe((event) => this.onNativeEvent(event));
      const [stored, native, storage] = await Promise.all([
        this.registry.read(), this.backend.list(), this.backend.storage(),
      ]);
      this.assertLive();
      const regions = stored.map((region) => this.reconcile(region, native));
      const referenced = new Set(regions.flatMap((region) => [region.activeNativeId, region.pendingNativeId, ...region.obsoleteNativeIds]));
      for (const item of native) {
        if (referenced.has(item.id)) continue;
        const owner = regions.find((region) => region.id === item.logicalRegionId);
        if (owner) {
          if (!owner.available && item.ready && owner.status !== 'deleting') {
            owner.activeNativeId = item.id;
            owner.available = true;
            owner.completedAt = null;
            if (!owner.pendingNativeId) {
              owner.status = 'ready';
              owner.pauseReason = null;
              owner.error = null;
            }
          } else owner.obsoleteNativeIds.push(item.id);
          continue;
        }
        regions.push({
          id: item.logicalRegionId, spec: item.spec, status: item.ready ? 'ready' : 'paused', available: item.ready,
          activeNativeId: item.ready ? item.id : null, pendingNativeId: item.ready ? null : item.id,
          obsoleteNativeIds: [], operationId: null, completedAt: null,
          progress: item, error: null, pauseReason: item.ready ? null : 'interrupted', allowMobileData: false,
        });
      }
      this.publish({ regions, storage });
      await this.persist();
      this.assertLive();
      for (const region of [...regions]) {
        this.assertLive();
        if (region.status === 'deleting') await this.removeInternal(region.id);
        else await this.cleanupObsolete(region.id);
      }
      this.publish({ initialized: true });
    } catch (error) {
      // Without native verification a persisted ready flag is no proof of coverage.
      this.publish({ regions: this.snapshot.regions.map((region) => ({ ...region, available: false })), error: failure(error) });
      throw error;
    } finally {
      this.publish({ loading: false });
    }
  });

  private reconcile(region: OfflineRegion, native: NativeOfflineRegion[]): OfflineRegion {
    const active = native.find((item) => item.id === region.activeNativeId && item.logicalRegionId === region.id);
    const pending = native.find((item) => item.id === region.pendingNativeId && item.logicalRegionId === region.id);
    if (region.status === 'deleting') return { ...region, available: active?.ready === true, operationId: null };
    if (pending?.ready) return {
      ...region, activeNativeId: pending.id, pendingNativeId: null, operationId: null, available: true,
      obsoleteNativeIds: [...new Set([...region.obsoleteNativeIds, ...(active && active.id !== pending.id ? [active.id] : [])])],
      status: 'ready', completedAt: null, progress: pending, error: null, pauseReason: null,
    };
    const interrupted = region.pendingNativeId !== null || ['downloading', 'updating', 'paused', 'error'].includes(region.status);
    return {
      // Failed verification withdraws availability, not ownership of repairable data.
      // Dropping the id would make refresh treat the saved region as obsolete.
      ...region, activeNativeId: active?.id ?? null, pendingNativeId: pending?.id ?? null,
      operationId: null, available: active?.ready === true,
      status: interrupted || !active?.ready ? 'paused' : 'ready',
      pauseReason: interrupted || !active?.ready ? region.pauseReason ?? 'interrupted' : null,
      progress: pending ?? active ?? null,
    };
  }

  setEnvironment = (environment: OfflineEnvironment): void => {
    this.environment = { ...environment };
    if (!environment.foreground || !environment.recorderReady || environment.recorderBusy || environment.network === 'offline') {
      for (const cancel of this.estimates.values()) cancel();
    }
    const transfer = this.transfer;
    if (!transfer?.valid) return;
    const region = this.snapshot.regions.find((item) => item.id === transfer.regionId);
    const reason = downloadPauseReason(environment, region?.allowMobileData ?? false);
    if (reason) this.revoke(transfer, reason);
  };

  /** Revoke first, then request cancellation. Never await this from recorder state. */
  private revoke(transfer: Transfer, reason: OfflinePauseReason): void {
    transfer.valid = false;
    if (this.transfer === transfer) this.transfer = null;
    const region = this.snapshot.regions.find((item) => item.id === transfer.regionId);
    if (region) this.replace({ ...region, status: 'paused', pauseReason: reason, operationId: null });
    const pause = transfer.started ? this.requestPause(transfer) : Promise.resolve();
    // Catch immediately even when another command is still awaiting native acceptance.
    const settled = pause.catch((error) => { this.publish({ error: failure(error) }); });
    void this.enqueue(async () => { await settled; await this.persist(); }).catch(() => undefined);
  }

  private async requestPause(transfer: Pick<Transfer, 'nativeId' | 'operationId'>): Promise<void> {
    this.pendingPauses.set(transfer.nativeId, transfer.operationId);
    await this.backend.pause(transfer.nativeId, transfer.operationId);
    if (this.pendingPauses.get(transfer.nativeId) === transfer.operationId) this.pendingPauses.delete(transfer.nativeId);
  }

  private async finishPauses(): Promise<void> {
    for (const [nativeId, operationId] of this.pendingPauses) {
      this.assertLive();
      await this.requestPause({ nativeId, operationId });
    }
  }

  estimate = async (spec: OfflineRegionSpec, signal?: AbortSignal): Promise<OfflineEstimate> => {
    if (signal?.aborted) throw problem('aborted', 'Estimate cancelled.');
    if (this.disposed || !this.environment.foreground || !this.environment.recorderReady || this.environment.recorderBusy) {
      throw problem('unavailable', 'Check download size while the app is open and the recorder is idle.');
    }
    const requestId = this.id();
    let cancelled = false;
    let rejectCancelled!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const abort = () => {
      if (cancelled) return;
      cancelled = true;
      rejectCancelled(problem('aborted', 'Estimate cancelled.'));
      void (async () => this.backend.cancelEstimate(requestId))().catch(() => undefined);
    };
    this.estimates.set(requestId, abort);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await Promise.race([cancellation, (async () => {
        await this.backend.prepare();
        if (cancelled) throw problem('aborted', 'Estimate cancelled.');
        return this.backend.estimate(requestId, spec);
      })()]);
    } finally {
      this.estimates.delete(requestId);
      signal?.removeEventListener('abort', abort);
    }
  };

  download = (spec: OfflineRegionSpec, options: OfflineDownloadOptions): Promise<string> => this.enqueue(async () => {
    this.assertInitialized();
    const available = this.snapshot.regions.filter((region) => region.status !== 'deleting' && region.available &&
      region.spec.styleURL === spec.styleURL && region.spec.minZoom <= spec.minZoom && region.spec.maxZoom >= spec.maxZoom);
    if (offlineCoverage(spec.bounds, available, spec.styleURL, spec.maxZoom) === 'covered') {
      // The returned id is a navigation anchor; several saved areas may jointly cover it.
      return available.find((region) => offlineCoverage(spec.bounds, [region], spec.styleURL, spec.maxZoom) !== 'unavailable')!.id;
    }
    const duplicate = this.snapshot.regions.find((region) => region.status !== 'deleting' &&
      ((region.available && coversRegion(region.spec, spec)) || sameCoverage(region.spec, spec)));
    if (duplicate) return duplicate.id;
    this.assertNoTransfer();
    const id = this.id();
    const region: OfflineRegion = {
      id, spec, status: 'paused', available: false, activeNativeId: null, pendingNativeId: null,
      obsoleteNativeIds: [], operationId: null, completedAt: null, progress: null,
      error: null, pauseReason: 'user', allowMobileData: options.allowMobileData,
    };
    await this.start(region, options, false);
    return id;
  });

  resume = (id: string, options: OfflineDownloadOptions): Promise<void> => this.enqueue(async () => {
    this.assertInitialized();
    const region = this.region(id);
    if (region.status === 'ready') return;
    if (region.status === 'deleting') throw problem('deleting', 'Finish deleting this area before downloading it again.');
    await this.start(region, options, region.activeNativeId !== null);
  });

  update = (id: string, options: OfflineDownloadOptions): Promise<void> => this.enqueue(async () => {
    this.assertInitialized();
    const region = this.region(id);
    if (!region.available) throw problem('not_ready', 'Resume this download before updating it.');
    await this.start(region, options, true);
  });

  private assertInitialized(): void {
    if (!this.snapshot.initialized) throw problem('not_initialized', 'Refresh offline maps before downloading.');
  }

  private assertNoTransfer(): void {
    if (this.transfer?.valid) throw problem('download_busy', 'Pause or finish the current download first.');
  }

  private async start(region: OfflineRegion, options: OfflineDownloadOptions, refresh: boolean): Promise<void> {
    this.assertNoTransfer();
    // A native pause failure cannot permit a second transfer alongside the first.
    await this.finishPauses();
    this.assertLive();
    const reason = downloadPauseReason(this.environment, options.allowMobileData);
    if (reason) throw problem(reason, reason === 'network' ? 'Connect to Wi-Fi or allow mobile data for this download.' : 'Downloads need the app open and the recorder idle.');
    if (!options.estimate && !options.allowUnknownEstimate) throw problem('estimate_required', 'Check the download size or choose to download without an estimate.');
    const storage = await this.backend.storage();
    this.assertLive();
    this.publish({ storage });
    const estimate = options.estimate;
    if (estimate && (![estimate.storageBytes, estimate.transferBytes, estimate.errorMargin].every(Number.isFinite) ||
      estimate.storageBytes < 0 || estimate.transferBytes < 0 || estimate.errorMargin < 0)) {
      throw problem('estimate_invalid', 'The download size estimate is invalid. Check it again.');
    }
    const required = estimate ? estimate.storageBytes * (1 + estimate.errorMargin) : 0;
    if (!Number.isFinite(storage.freeBytes) || !Number.isFinite(required) || storage.freeBytes < OFFLINE_MAP_FREE_SPACE_RESERVE + required) {
      throw problem('storage', 'Free more storage before downloading. Keep at least 512 MiB available for recording.');
    }
    if (downloadPauseReason(this.environment, options.allowMobileData)) throw problem('interrupted', 'Download paused before it started. Tap Resume when ready.');
    const transfer: Transfer = {
      regionId: region.id, nativeId: region.pendingNativeId ?? this.id(), operationId: this.id(), valid: true, started: false,
    };
    this.transfer = transfer;
    this.lastStorageCheck = this.now();
    this.publish({ error: null });
    this.replace({ ...region, pendingNativeId: transfer.nativeId, operationId: transfer.operationId,
      status: region.available ? 'updating' : 'downloading', pauseReason: null, error: null, allowMobileData: options.allowMobileData });
    try {
      await this.persist();
      if (!transfer.valid || this.disposed) return;
      transfer.started = true;
      await this.backend.start({
        nativeId: transfer.nativeId, operationId: transfer.operationId, logicalRegionId: region.id,
        spec: region.spec, refresh, allowMobileData: options.allowMobileData,
      });
      if (!transfer.valid) {
        // A pause may race native startup; repeat it after acceptance, using the same operation id.
        await this.requestPause(transfer);
      }
    } catch (error) {
      if (transfer.valid) {
        transfer.valid = false;
        if (this.transfer === transfer) this.transfer = null;
        this.replace({ ...this.region(region.id), status: 'error', operationId: null, error: failure(error), pauseReason: null });
        if (transfer.started) await this.requestPause(transfer).catch(() => undefined);
        await this.persist().catch(() => undefined);
      }
      throw error;
    }
  }

  pause = (id: string): Promise<void> => {
    const transfer = this.transfer;
    if (transfer?.regionId === id && transfer.valid) this.revoke(transfer, 'user');
    return this.enqueue(async () => {
      const region = this.region(id);
      if (region.status === 'ready' || region.status === 'deleting') return;
      this.replace({ ...region, status: 'paused', operationId: null, pauseReason: 'user' });
      await this.persist();
    });
  };

  cancel = (id: string): Promise<void> => {
    const transfer = this.transfer;
    if (transfer?.regionId === id && transfer.valid) this.revoke(transfer, 'user');
    return this.enqueue(async () => {
      const region = this.region(id);
      if (!region.activeNativeId) return this.removeInternal(id);
      this.replace({ ...region, pendingNativeId: null, operationId: null,
        status: region.available ? 'ready' : 'paused', pauseReason: region.available ? null : 'interrupted', error: null,
        obsoleteNativeIds: [...new Set([...region.obsoleteNativeIds, ...(region.pendingNativeId ? [region.pendingNativeId] : [])])] });
      await this.persist();
      await this.cleanupObsolete(id);
    });
  };

  remove = (id: string): Promise<void> => {
    const transfer = this.transfer;
    if (transfer?.regionId === id && transfer.valid) this.revoke(transfer, 'user');
    return this.enqueue(() => this.removeInternal(id));
  };

  private async removeInternal(id: string): Promise<void> {
    let region = this.region(id);
    this.replace({ ...region, status: 'deleting', operationId: null, error: null });
    await this.persist();
    if (!this.canCleanUp()) return;
    try {
      const ids = new Set([region.activeNativeId, region.pendingNativeId, ...region.obsoleteNativeIds]);
      for (const nativeId of ids) if (nativeId) {
        if (!this.canCleanUp()) return;
        await this.backend.remove(nativeId);
        if (this.disposed) return;
        this.pendingPauses.delete(nativeId);
      }
      this.publish({ regions: this.snapshot.regions.filter((item) => item.id !== id) });
      await this.persist();
      if (this.disposed) return;
      this.publish({ storage: await this.backend.storage() });
    } catch (error) {
      region = this.snapshot.regions.find((item) => item.id === id) ?? region;
      this.replace({ ...region, status: 'deleting', error: failure(error) });
      await this.persist().catch(() => undefined);
      throw error;
    }
  }

  private canCleanUp(): boolean {
    return !this.disposed && this.environment.foreground && this.environment.recorderReady && !this.environment.recorderBusy;
  }

  private async cleanupObsolete(id: string): Promise<void> {
    for (const nativeId of [...this.region(id).obsoleteNativeIds]) {
      if (!this.canCleanUp()) return;
      if (nativeId === this.region(id).activeNativeId || nativeId === this.region(id).pendingNativeId) continue;
      try {
        await this.backend.remove(nativeId);
        if (this.disposed) return;
        this.pendingPauses.delete(nativeId);
        const region = this.region(id);
        this.replace({ ...region, obsoleteNativeIds: region.obsoleteNativeIds.filter((item) => item !== nativeId) });
        await this.persist();
      } catch (error) {
        this.publish({ error: failure(error, 'cleanup_failed') });
        return;
      }
    }
  }

  private onNativeEvent(event: NativeDownloadEvent): void {
    const transfer = this.transfer;
    if (!transfer?.valid || event.nativeId !== transfer.nativeId || event.operationId !== transfer.operationId) return;
    void this.enqueue(async () => {
      if (!transfer.valid || this.transfer !== transfer) return;
      const region = this.region(transfer.regionId);
      this.replace({ ...region, progress: {
        completedResources: event.completedResources, requiredResources: event.requiredResources, completedBytes: event.completedBytes,
      } });
      if (event.kind === 'complete') {
        const native = (await this.backend.list()).find((item) => item.id === transfer.nativeId && item.logicalRegionId === transfer.regionId && item.ready);
        if (!transfer.valid) return;
        if (!native) throw problem('completion_unverified', 'The map download could not be verified. Resume to try again.');
        transfer.valid = false;
        this.transfer = null;
        const current = this.region(region.id);
        this.replace({ ...current, status: 'ready', available: true, activeNativeId: transfer.nativeId,
          pendingNativeId: null, operationId: null, completedAt: this.now(), progress: native, error: null, pauseReason: null,
          obsoleteNativeIds: [...new Set([...current.obsoleteNativeIds, ...(current.activeNativeId && current.activeNativeId !== transfer.nativeId ? [current.activeNativeId] : [])])] });
        await this.persist();
        if (this.disposed) return;
        await this.cleanupObsolete(region.id);
        if (this.disposed) return;
        this.publish({ storage: await this.backend.storage() });
      } else if (event.kind === 'error' || event.kind === 'paused') {
        transfer.valid = false;
        this.transfer = null;
        this.replace({ ...this.region(region.id), operationId: null, status: event.kind === 'error' ? 'error' : 'paused',
          error: event.error ?? null, pauseReason: nativePauseReason(event.error) });
        await this.persist();
      } else if (this.now() - this.lastStorageCheck >= 2_000) {
        this.lastStorageCheck = this.now();
        const storage = await this.backend.storage();
        this.publish({ storage });
        if (transfer.valid && (!Number.isFinite(storage.freeBytes) || storage.freeBytes < OFFLINE_MAP_FREE_SPACE_RESERVE)) this.revoke(transfer, 'storage');
      }
    }).catch((error) => {
      if (transfer.valid) {
        this.revoke(transfer, 'interrupted');
        const region = this.snapshot.regions.find((item) => item.id === transfer.regionId);
        if (region) this.replace({ ...region, status: 'error', error: failure(error) });
      }
    });
  }

  dispose = (): void => {
    if (this.disposed) return;
    for (const cancel of this.estimates.values()) cancel();
    this.estimates.clear();
    const transfer = this.transfer;
    if (transfer?.valid) {
      transfer.valid = false;
      if (transfer.started) void this.requestPause(transfer).catch(() => undefined);
    }
    this.transfer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
    this.disposed = true;
  };
}

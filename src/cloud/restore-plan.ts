/** Transfer policy, separate from metadata sync so cellular sign-in still restores summaries. */
export type RestorePauseReason = 'user' | 'wifi' | 'offline' | 'background' | 'recording' | 'recovering' | 'storage' | 'signed_out';
export interface RestoreSnapshot {
  phase: 'idle' | 'restoring' | 'paused' | 'error';
  total: number;
  completed: number;
  currentFlightTitle: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  pauseReason: RestorePauseReason | null;
  lastError: string | null;
  allowMobileData: boolean;
}
export const EMPTY_RESTORE: RestoreSnapshot = {
  phase: 'idle', total: 0, completed: 0, currentFlightTitle: null,
  downloadedBytes: null, totalBytes: null, pauseReason: null, lastError: null, allowMobileData: false,
};
export interface RestoreEnvironment {
  foreground: boolean;
  recorderReady: boolean;
  recorderBusy: boolean;
  network: 'wifi' | 'other' | 'offline' | 'unknown';
}
export const INITIAL_RESTORE_ENVIRONMENT: RestoreEnvironment = {
  foreground: false, recorderReady: false, recorderBusy: false, network: 'unknown',
};
export function restorePauseReason(environment: RestoreEnvironment, signedIn: boolean, paused: boolean, mobile: boolean): RestorePauseReason | null {
  if (!signedIn) return 'signed_out';
  if (paused) return 'user';
  if (!environment.foreground) return 'background';
  if (environment.recorderBusy) return 'recording';
  if (!environment.recorderReady) return 'recovering';
  if (environment.network === 'offline' || environment.network === 'unknown') return 'offline';
  if (environment.network !== 'wifi' && !mobile) return 'wifi';
  return null;
}

export interface CatalogueCursor { updatedAt: string; id: string }
/** Server-generated timestamps and UUIDs only: reject unsafe PostgREST filter interpolation. */
export function catalogueContinuation(cursor: CatalogueCursor): string {
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.updatedAt) ||
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(cursor.id)) {
    throw new Error('Invalid saved archive cursor.');
  }
  return `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`;
}

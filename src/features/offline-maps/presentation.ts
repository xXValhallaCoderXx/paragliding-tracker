import type { OfflineEstimate, OfflineRegion } from '@/offline-maps/types';

export function formatMapBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function estimateRange(estimate: OfflineEstimate): string {
  const margin = Math.max(0, Math.min(1, estimate.errorMargin));
  return `${formatMapBytes(estimate.transferBytes * (1 - margin))}–${formatMapBytes(estimate.transferBytes * (1 + margin))}`;
}

export function offlineRegionStatus(region: OfflineRegion): string {
  if (region.status === 'ready') return region.available ? 'Ready for offline use' : 'Offline availability could not be verified';
  if (region.status === 'downloading') return 'Downloading';
  if (region.status === 'updating') return region.available ? 'Updating · saved version still available' : 'Downloading update';
  if (region.status === 'deleting') return region.error ? 'Deletion failed' : 'Deletion pending';
  if (region.status === 'error') return region.available ? 'Update failed · saved version still available' : 'Download incomplete';
  const reasons = { user: 'Paused', background: 'Paused while the app was away', network: 'Paused after the connection changed',
    recording: 'Paused for recording', storage: 'Paused because storage is low', interrupted: 'Interrupted download' };
  return `${reasons[region.pauseReason ?? 'user']}${region.available ? ' · saved version still available' : ''}`;
}

export function offlineOperationError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'This map action could not finish. Try again.';
}

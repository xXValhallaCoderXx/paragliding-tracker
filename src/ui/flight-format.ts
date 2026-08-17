import type { TrackQuality } from '@/recorder/types';

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function formatDistance(metres: number | null): string {
  if (metres === null || !Number.isFinite(metres)) return '—';
  if (metres < 1_000) return `${Math.round(metres)} m`;
  return `${(metres / 1_000).toFixed(metres >= 10_000 ? 1 : 2)} km`;
}

export function formatAltitude(metres: number | null): string {
  return metres === null || !Number.isFinite(metres) ? '—' : `${Math.round(metres)} m`;
}

export function formatGroundSpeed(metresPerSecond: number | null): string {
  return metresPerSecond === null || !Number.isFinite(metresPerSecond)
    ? '—'
    : `${Math.round(metresPerSecond * 3.6)} km/h`;
}

export function formatAccuracy(metres: number | null): string {
  return metres === null || !Number.isFinite(metres) ? '—' : `±${Math.round(metres)} m`;
}

export function formatGap(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '—';
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function formatFlightDate(
  startedAt: number,
  timezoneOffsetMinutes: number | null,
  includeTime = true,
): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  };
  if (timezoneOffsetMinutes === null) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(startedAt));
  }
  const recordedLocalTime = new Date(startedAt - timezoneOffsetMinutes * 60_000);
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
    recordedLocalTime,
  );
}

export function qualityLabel(quality: TrackQuality): string {
  switch (quality) {
    case 'healthy':
      return 'Good track';
    case 'gaps':
      return 'Track has gaps';
    case 'partial':
      return 'Partial flight';
    case 'no_track':
      return 'No usable track';
  }
}

export function flightDisplayName(title: string | null, site: string | null): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) return trimmedTitle;
  const trimmedSite = site?.trim();
  if (trimmedSite) return trimmedSite;
  return 'Untitled flight';
}

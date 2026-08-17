import type { TrackQuality } from '@/recorder/types';
import { formatGap } from '@/lib/format/flight-format';

/** Presentation helpers for the flight-detail route. */

export function gapSummary(quality: TrackQuality, maxGapMs: number | null): string {
  switch (quality) {
    case 'healthy':
      return 'no gaps';
    case 'gaps':
      return `gaps up to ${formatGap(maxGapMs)}`;
    case 'partial':
      return 'partial';
    case 'no_track':
      return 'no track';
  }
}

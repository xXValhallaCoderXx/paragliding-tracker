import type { OfflineBounds, OfflineRegion } from './types';

export type OfflineCoverage = 'covered' | 'partial' | 'unavailable';
const longitudeParts = ([west, south, east, north]: OfflineBounds): OfflineBounds[] =>
  west <= east ? [[west, south, east, north]] : [[west, south, 180, north], [-180, south, east, north]];

/** Test the union, so adjacent saved areas can jointly cover a viewport. */
export function offlineCoverage(bounds: OfflineBounds, regions: readonly OfflineRegion[], styleURL: string, zoom: number): OfflineCoverage {
  const rectangles = regions.filter((r) => r.available && r.spec.styleURL === styleURL &&
    r.spec.minZoom <= zoom && r.spec.maxZoom >= zoom).flatMap((r) => longitudeParts(r.spec.bounds));
  let intersects = false;
  const covered = longitudeParts(bounds).map(([west, south, east, north]) => {
    const clipped = rectangles.map(([w, s, e, n]): OfflineBounds =>
      [Math.max(w, west), Math.max(s, south), Math.min(e, east), Math.min(n, north)])
      .filter(([w, s, e, n]) => w < e && s < n);
    if (clipped.length) intersects = true;
    if (!clipped.length) return false;
    const xs = [...new Set([west, east, ...clipped.flatMap(([w, , e]) => [w, e])])].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) {
      const x = (xs[i - 1] + xs[i]) / 2;
      const intervals = clipped.filter(([w, , e]) => w <= x && e >= x).map(([, s, , n]) => [s, n]).sort((a, b) => a[0] - b[0]);
      let reached = south;
      for (const [s, n] of intervals) {
        if (s > reached) break;
        reached = Math.max(reached, n);
      }
      if (reached < north) return false;
    }
    return true;
  }).every(Boolean);
  return covered ? 'covered' : intersects ? 'partial' : 'unavailable';
}

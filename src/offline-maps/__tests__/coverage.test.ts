import { offlineCoverage } from '../coverage';
import type { OfflineBounds, OfflineRegion } from '../types';

const region = (bounds: OfflineBounds, available = true) => ({ available, spec: { bounds, styleURL: 'outdoors', minZoom: 0, maxZoom: 14 } }) as OfflineRegion;

it('recognizes jointly covered areas without filling gaps between rectangles', () => {
  const areas = [region([100, 1, 101, 3]), region([101, 1, 102, 3])];
  expect(offlineCoverage([100, 1, 102, 3], areas, 'outdoors', 14)).toBe('covered');
  expect(offlineCoverage([100, 1, 102.1, 3], areas, 'outdoors', 14)).toBe('partial');
  expect(offlineCoverage([100, 1, 102, 3], [region([100, 1, 100.9, 3]), areas[1]], 'outdoors', 14)).toBe('partial');
  expect(offlineCoverage([100, 1, 102, 3], [region([100, 1, 102, 1.9]), region([100, 2, 102, 3])], 'outdoors', 14)).toBe('partial');
});

it('handles dateline viewports and excludes incomplete, different-style and insufficient-detail downloads', () => {
  const bounds: OfflineBounds = [179, -1, -179, 1];
  expect(offlineCoverage(bounds, [region([178, -2, -178, 2])], 'outdoors', 14)).toBe('covered');
  expect(offlineCoverage(bounds, [region([178, -2, 180, 2])], 'outdoors', 14)).toBe('partial');
  expect(offlineCoverage(bounds, [region([-180, -2, -178, 2])], 'outdoors', 14)).toBe('partial');
  expect(offlineCoverage(bounds, [region([178, -2, -178, 2], false)], 'outdoors', 14)).toBe('unavailable');
  expect(offlineCoverage(bounds, [region([178, -2, -178, 2])], 'another-style', 14)).toBe('unavailable');
  expect(offlineCoverage(bounds, [region([178, -2, -178, 2])], 'outdoors', 15)).toBe('unavailable');
});

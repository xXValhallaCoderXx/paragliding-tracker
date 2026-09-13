import { cameraForTrack } from '../camera';

it('fits an unwrapped dateline crossing around the dateline, not Greenwich', () => {
  const camera = cameraForTrack({ ne: [181, 11], sw: [179, 10] }, 360, 280);
  expect(Math.abs(camera.centerCoordinate[0])).toBe(180);
  expect(camera.centerCoordinate[1]).toBeCloseTo(10.5004, 3);
  expect(camera.zoomLevel).toBeGreaterThan(6);
  expect(camera.zoomLevel).toBeLessThan(7);
});

it('fits both dimensions with padding and caps the zoom for coincident fixes', () => {
  const bounds = { ne: [104, 2], sw: [103, 1] } as const;
  const camera = cameraForTrack({ ne: [...bounds.ne], sw: [...bounds.sw] }, 360, 280);
  const verticalPixels = 512 * 2 ** camera.zoomLevel * (
    Math.log(Math.tan(Math.PI / 4 + 2 * Math.PI / 360)) -
    Math.log(Math.tan(Math.PI / 4 + 1 * Math.PI / 360))
  ) / (2 * Math.PI);
  expect(verticalPixels).toBeCloseTo(280 - 72);
  expect(512 * 2 ** camera.zoomLevel / 360).toBeLessThan(360 - 72);
  expect(cameraForTrack({ ne: [103, 1], sw: [103, 1] }, 360, 280)).toEqual({
    centerCoordinate: [103, expect.closeTo(1)], zoomLevel: 18,
  });
});

it('keeps polar extents finite within the Mercator latitude limit', () => {
  const camera = cameraForTrack({ ne: [12, 90], sw: [10, 89] }, 360, 280);
  expect(camera.centerCoordinate[1]).toBeCloseTo(85.0511288);
  expect(Number.isFinite(camera.zoomLevel)).toBe(true);
});

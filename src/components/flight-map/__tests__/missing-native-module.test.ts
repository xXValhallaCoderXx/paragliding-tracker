import React from 'react';

import { act, create } from '../../../../tests/support/renderer';
import { FlightMap, isFlightMapAvailable } from '../index.native';

jest.mock('../config', () => ({
  MAPBOX_PUBLIC_ACCESS_TOKEN: 'pk.test-public-token',
  MAPBOX_STYLE_URI: 'mapbox://styles/mapbox/outdoors-v12',
}));
jest.mock('@rnmapbox/maps', () => { throw new Error('Must not evaluate Mapbox without its APK bridge'); });

it('leaves an older APK usable without evaluating its missing map package', async () => {
  expect(isFlightMapAvailable).toBe(false);
  const onError = jest.fn();
  const onReady = jest.fn();
  let rendered: { unmount: () => void };
  await act(async () => {
    rendered = create(React.createElement(FlightMap, {
      track: { id: 'walk', segments: [], isolatedPoints: [[103.8, 1.3]],
        bounds: { ne: [103.81, 1.31], sw: [103.8, 1.3] } },
      pilotPosition: null, accessibilityLabel: 'Saved flight route', onReady, onError,
    }));
    expect(onError).not.toHaveBeenCalled();
  });
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Grid replay'));
  expect(onReady).not.toHaveBeenCalled();
  await act(async () => rendered.unmount());
});

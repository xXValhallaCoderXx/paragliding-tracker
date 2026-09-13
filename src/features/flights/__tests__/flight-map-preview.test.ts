import React from 'react';
import { Text } from 'react-native';
import { Image } from 'expo-image';

import { FlightMapPreview, STATIC_MAP_TIMEOUT_MS } from '../components/flight-map-preview';
import { TrackPlate } from '../components/track-plate';
import { create, act } from '../../../../tests/support/renderer';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/components/flight-map/config', () => ({ MAPBOX_PUBLIC_ACCESS_TOKEN: 'pk.test' }));
jest.mock('../components/track-plate', () => ({ TrackPlate: () => null }));

let rendered: ReturnType<typeof create>;
const track = [[1.3, 103.8, 1.301, 103.801], [1.302, 103.802]];
const image = () => rendered.root.findByType(Image);
const grids = () => rendered.root.findAllByType(TrackPlate);
async function mount(enabled = true) {
  await act(async () => { rendered = create(React.createElement(FlightMapPreview, { segments: track, variant: 'hero', state: 'ready', enabled })); });
}
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  jest.useRealTimers();
});

it('keeps Grid visible until the static image loads, then shows distinct Start and Stop labels', async () => {
  await mount();
  expect(grids()).toHaveLength(1);
  const props = image().props;
  expect(props.source.uri).toContain('/outdoors-v12/static/');
  expect(props.source.uri).not.toContain('geojson');
  await act(async () => props.onLoad());
  expect(grids()).toHaveLength(0);
  expect(rendered.root.findAllByType(Text).map((node: { props: { children: React.ReactNode } }) => node.props.children)).toEqual(['Start', 'Stop']);
});

it.each(['error', 'timeout'] as const)('uses Grid after image %s and ignores late load completion', async (failure) => {
  await mount();
  const props = image().props;
  await act(async () => {
    if (failure === 'error') props.onError({ error: 'Image unavailable' });
    else jest.advanceTimersByTime(STATIC_MAP_TIMEOUT_MS);
  });
  expect(grids()).toHaveLength(1);
  expect(rendered.root.findAllByType(Image)).toHaveLength(0);
  await act(async () => props.onLoad());
  expect(grids()).toHaveLength(1);
});

it('does not request a map image for an offscreen card', async () => {
  await mount(false);
  expect(grids()).toHaveLength(1);
  expect(grids()[0].props).toMatchObject({ takeoffLabel: 'Start', landingLabel: 'Stop' });
  expect(rendered.root.findAllByType(Image)).toHaveLength(0);
});

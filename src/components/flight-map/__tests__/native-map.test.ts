import React from 'react';
import { NativeModules } from 'react-native';
import { MapView, ShapeSource } from '@rnmapbox/maps';

import type { FlightMapTrack } from '@/lib/track/map-geometry';
import { act, create } from '../../../../tests/support/renderer';
import type { FlightMapProps } from '../types';

const mockSetCamera = jest.fn();
let mockConfigured = false;
jest.mock('../config', () => ({
  MAPBOX_PUBLIC_ACCESS_TOKEN: 'pk.test-public-token',
  MAPBOX_STYLE_URI: 'mapbox://styles/mapbox/outdoors-v12',
}));
jest.mock('@rnmapbox/maps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
  const react: typeof React = require('react');
  const layer = () => null;
  return {
    setAccessToken: async () => { await Promise.resolve(); mockConfigured = true; },
    MapView: (props: { children: React.ReactNode }) => {
      if (!mockConfigured) throw new Error('Map mounted before token initialization completed');
      return props.children;
    },
    Camera: react.forwardRef(function MockCamera(_props, ref) {
      react.useImperativeHandle(ref, () => ({ setCamera: mockSetCamera }), []);
      return null;
    }),
    ShapeSource: (props: { children: React.ReactNode }) => props.children,
    LineLayer: layer,
    CircleLayer: layer,
    SymbolLayer: layer,
  };
});

NativeModules.RNMBXModule = {};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Set up the APK bridge before loading the component.
const { FlightMap } = require('../index.native') as typeof import('../index.native');

const track: FlightMapTrack = {
  id: 'walk', segments: [[[103.8, 1.3], [103.81, 1.31]]], isolatedPoints: [[103.82, 1.32]],
  bounds: { ne: [103.82, 1.32], sw: [103.8, 1.3] }, first: [103.8, 1.3], last: [103.82, 1.32],
};
type TestNode = { props: Record<string, any> };
let rendered: { root: {
  findByType: (type: unknown) => TestNode;
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByType: (type: unknown) => TestNode[];
}; update: (node: React.ReactNode) => void; unmount: () => void };
let props: FlightMapProps;
const map = () => rendered.root.findByType(MapView).props;
const frame = () => rendered.root.findByProps({ testID: 'flight-map-frame' }).props;
const sources = () => Object.fromEntries(rendered.root.findAllByType(ShapeSource).map((node) => [node.props.id, node.props.shape]));
async function event(callback: () => void) { await act(async () => callback()); }
async function update(changes: Partial<FlightMapProps>) {
  props = { ...props, ...changes };
  await event(() => rendered.update(React.createElement(FlightMap, props)));
}
async function layout() { await event(() => frame().onLayout({ nativeEvent: { layout: { width: 360, height: 280 } } })); }

beforeEach(async () => {
  mockSetCamera.mockClear();
  props = { track, pilotPosition: [103.8, 1.3], accessibilityLabel: 'Saved flight route',
    onReady: jest.fn(), onError: jest.fn(), onInteractionChange: jest.fn() };
  await act(async () => { rendered = create(React.createElement(FlightMap, props)); });
});
afterEach(async () => { await event(() => rendered.unmount()); });

it('fits after layout and style load, then preserves camera and static sources as the pilot moves', async () => {
  await layout();
  expect(mockSetCamera).not.toHaveBeenCalled();
  await event(() => map().onDidFinishLoadingStyle());
  expect(mockSetCamera).toHaveBeenCalledTimes(1);
  const originalSources = sources();
  await update({ pilotPosition: [103.805, 1.305] });
  const movedSources = sources();
  for (const id of ['flight-route', 'flight-isolated', 'flight-first', 'flight-last']) {
    expect(movedSources[id]).toBe(originalSources[id]);
  }
  expect(movedSources['flight-pilot'].coordinates).toEqual([103.805, 1.305]);
  expect(mockSetCamera).toHaveBeenCalledTimes(1);
  const extendedTrack: FlightMapTrack = { ...track,
    segments: [...track.segments, [[103.82, 1.32], [103.85, 1.35]]],
    bounds: { ...track.bounds, ne: [103.85, 1.35] } };
  await update({ track: extendedTrack });
  expect(sources()['flight-route'].coordinates).toEqual(extendedTrack.segments);
  expect(mockSetCamera).toHaveBeenCalledTimes(1);
  await update({ fitRequest: 1 });
  expect(mockSetCamera).toHaveBeenCalledTimes(2);
  expect(mockSetCamera.mock.calls[1][0].centerCoordinate[0]).toBeCloseTo(103.825);
  await update({ track: { ...track, id: 'another-flight' } });
  expect(mockSetCamera).toHaveBeenCalledTimes(3);
  await update({ track: { ...track, first: undefined, last: undefined }, pilotPosition: null });
  expect(Object.keys(sources())).toEqual(['flight-route', 'flight-isolated']);
});

it('waits for the supported tile-ready idle event after fitting and reports through the current callback once', async () => {
  await event(() => map().onMapIdle());
  await event(() => map().onDidFinishLoadingStyle());
  await event(() => map().onMapIdle());
  expect(props.onReady).not.toHaveBeenCalled();
  expect(mockSetCamera).not.toHaveBeenCalled();
  await layout();
  // Loading the style and setting the camera do not prove the basemap tiles rendered.
  expect(props.onReady).not.toHaveBeenCalled();
  const previousReady = props.onReady;
  await update({ onReady: jest.fn() });
  await event(() => map().onMapIdle());
  await event(() => map().onMapIdle());
  expect(previousReady).not.toHaveBeenCalled();
  expect(props.onReady).toHaveBeenCalledTimes(1);
  expect(props.onError).not.toHaveBeenCalled();
  await event(() => map().onMapLoadingError());
  expect(props.onError).toHaveBeenCalledWith(expect.stringContaining('Grid replay'));
});

it('holds the parent scroll lock across multiple touches and releases on cancellation or unmount', async () => {
  await event(() => frame().onTouchStart());
  await event(() => frame().onTouchStart());
  await event(() => frame().onTouchEnd({ nativeEvent: { touches: [{}] } }));
  expect(props.onInteractionChange).toHaveBeenCalledTimes(1);
  expect(props.onInteractionChange).toHaveBeenLastCalledWith(true);
  await event(() => frame().onTouchEnd({ nativeEvent: { touches: [] } }));
  expect(props.onInteractionChange).toHaveBeenLastCalledWith(false);
  await event(() => frame().onTouchStart());
  await event(() => frame().onTouchCancel());
  expect(props.onInteractionChange).toHaveBeenLastCalledWith(false);
  await event(() => frame().onTouchStart());
  await event(() => rendered.unmount());
  expect(props.onInteractionChange).toHaveBeenLastCalledWith(false);
});

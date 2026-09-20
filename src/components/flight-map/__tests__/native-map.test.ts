import React from 'react';
import { NativeModules, StyleSheet, View } from 'react-native';
import { MapView, ShapeSource } from '@rnmapbox/maps';
import { styled } from 'nativewind';

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
const CssView = styled(View);
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

it('keeps live sizing free of the preview ratio after the actual native CSS style processing', async () => {
  await update({ fillContainer: true });
  let processed: ReturnType<typeof create>;
  await act(async () => { processed = create(React.createElement(CssView, { style: frame().style })); });
  try {
    const liveStyle = StyleSheet.flatten(processed.root.findByType(View).props.style);
    expect(liveStyle.aspectRatio).toBeUndefined();
    expect(liveStyle.flex).toBe(1);
    await update({ fillContainer: false });
    await act(async () => { processed.update(React.createElement(CssView, { style: frame().style })); });
    const previewStyle = StyleSheet.flatten(processed.root.findByType(View).props.style);
    expect(previewStyle.aspectRatio).toBe(360 / 280);
    expect(previewStyle.flex).toBeUndefined();
  } finally {
    await act(async () => processed.unmount());
  }
});

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
  expect(props.onError).toHaveBeenCalledWith(expect.stringContaining('Grid'));
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

it('follows exact recorded live positions, suspends only on camera gestures and recenters at the chosen zoom', async () => {
  const changed = jest.fn();
  await update({ liveCamera: { mode: 'follow', center: null, zoom: 14 }, onLiveCameraChange: changed });
  await layout();
  await event(() => map().onDidFinishLoadingStyle());
  expect(mockSetCamera).toHaveBeenLastCalledWith(expect.objectContaining({ centerCoordinate: [103.8, 1.3], zoomLevel: 14, heading: 0, pitch: 0 }));
  await update({ pilotPosition: [103.805, 1.305] });
  expect(mockSetCamera).toHaveBeenCalledTimes(2);
  expect(mockSetCamera).toHaveBeenLastCalledWith(expect.objectContaining({ centerCoordinate: [103.805, 1.305], zoomLevel: 14 }));
  await event(() => frame().onTouchStart());
  await event(() => frame().onTouchEnd({ nativeEvent: { touches: [] } }));
  const state = { properties: { center: [103.9, 1.4], zoom: 16, heading: 0, pitch: 0 }, gestures: { isGestureActive: false } };
  await event(() => map().onCameraChanged(state));
  expect(changed).not.toHaveBeenCalled();
  await event(() => map().onCameraChanged({ ...state, gestures: { isGestureActive: true } }));
  expect(changed).toHaveBeenLastCalledWith({ mode: 'manual', center: [103.9, 1.4], zoom: 16 });
  await update({ liveCamera: changed.mock.calls.at(-1)![0] });
  await event(() => map().onMapIdle(state));
  await update({ pilotPosition: [103.81, 1.31] });
  expect(mockSetCamera).toHaveBeenCalledTimes(2);
  await update({ liveCamera: { mode: 'follow', center: [103.81, 1.31], zoom: 16 } });
  expect(mockSetCamera).toHaveBeenCalledTimes(3);
  expect(mockSetCamera).toHaveBeenLastCalledWith(expect.objectContaining({ centerCoordinate: [103.81, 1.31], zoomLevel: 16 }));
  await update({ track: { ...track, bounds: { ne: [104, 2], sw: [100, 0] } } });
  expect(mockSetCamera).toHaveBeenCalledTimes(3);
});

it('restores the live manual camera on mount instead of fitting the growing trail', async () => {
  await update({ liveCamera: { mode: 'manual', center: [104, 2], zoom: 11 } });
  await layout();
  await event(() => map().onDidFinishLoadingStyle());
  expect(mockSetCamera).toHaveBeenCalledTimes(1);
  expect(mockSetCamera).toHaveBeenCalledWith(expect.objectContaining({ centerCoordinate: [104, 2], zoomLevel: 11 }));
  await update({ pilotPosition: [103.81, 1.31] });
  expect(mockSetCamera).toHaveBeenCalledTimes(1);
});

it('does not move a live camera for newly read delayed positions while capture is stale', async () => {
  await update({ liveCamera: { mode: 'follow', center: null, zoom: 14 } });
  await layout();
  await event(() => map().onDidFinishLoadingStyle());
  await update({ pilotPosition: [103.82, 1.32], pilotStale: true });
  expect(mockSetCamera).toHaveBeenCalledTimes(1);
  await update({ pilotStale: false });
  expect(mockSetCamera).toHaveBeenCalledTimes(2);
  expect(mockSetCamera).toHaveBeenLastCalledWith(expect.objectContaining({ centerCoordinate: [103.82, 1.32] }));
});

it.each([{ center: [103.9, 1.4] }, { center: [103.8, 1.3] }])(
  'lets explicit Recenter supersede gesture inertia at $center before its idle event arrives', async ({ center }) => {
  const changed = jest.fn();
  await update({ liveCamera: { mode: 'follow', center: null, zoom: 14 }, onLiveCameraChange: changed });
  await layout();
  await event(() => map().onDidFinishLoadingStyle());
  const gesture = { properties: { center, zoom: 16, heading: 0, pitch: 0 }, gestures: { isGestureActive: true } };
  await event(() => map().onCameraChanged(gesture));
  await update({ liveCamera: changed.mock.calls.at(-1)![0] });
  // The native map is still decelerating; Recenter is a newer explicit user intent.
  await update({ liveCamera: { mode: 'follow', center: [103.8, 1.3], zoom: 16 } });
  expect(mockSetCamera).toHaveBeenCalledTimes(2);
  expect(mockSetCamera).toHaveBeenLastCalledWith(expect.objectContaining({ centerCoordinate: [103.8, 1.3], zoomLevel: 16 }));
  changed.mockClear();
  await event(() => map().onMapIdle({ ...gesture, gestures: { isGestureActive: false } }));
  await event(() => map().onCameraChanged({ ...gesture, gestures: { isGestureActive: false } }));
  expect(changed).not.toHaveBeenCalled();
  await update({ pilotPosition: [103.81, 1.31] });
  expect(mockSetCamera).toHaveBeenCalledTimes(3);
  expect(mockSetCamera).toHaveBeenLastCalledWith(expect.objectContaining({ centerCoordinate: [103.81, 1.31], zoomLevel: 16 }));
});

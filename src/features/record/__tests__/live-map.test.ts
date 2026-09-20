import React from 'react';
import { Text } from 'react-native';
import { Circle } from 'react-native-svg';

import { FlightMap } from '@/components/flight-map';
import type { LiveMapData } from '@/lib/live/types';
import { LiveGrid, LiveMap, LIVE_MAP_LOAD_TIMEOUT_MS, type LiveMapProps } from '../components/live-map';
import { act, create } from '../../../../tests/support/renderer';

let mockAvailable = true;
jest.mock('@/components/flight-map', () => ({
  FlightMap: () => null,
  get isFlightMapAvailable() { return mockAvailable; },
}));

const position = { sessionId: 'active', sequence: 2, sourceTimestamp: 2000, receiptTimestamp: 2200,
  latitude: 46.001, longitude: 8.001, horizontalAccuracy: 5, mocked: false };
const data: LiveMapData = { sessionId: 'active', observedAt: 3000, rows: [{ ...position, sequence: 1, sourceTimestamp: 1000, longitude: 8 }, position],
  position, cursor: { sessionId: 'active', sequence: 2 }, readError: null };
type Node = { props: Record<string, any> };
let rendered: { root: { findByType: (type: unknown) => Node; findAllByType: (type: unknown) => Node[];
  findAllByProps: (props: Record<string, unknown>) => Node[] }; update: (node: React.ReactNode) => void; unmount: () => void };
let props: LiveMapProps;
const map = () => rendered.root.findByType(FlightMap).props;
const hasMap = () => rendered.root.findAllByType(FlightMap).length > 0;
const control = (label: string) => rendered.root.findAllByProps({ accessibilityRole: 'button', accessibilityLabel: label })
  .find((node) => node.props.onPress);
const text = () => rendered.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' ');
async function event(callback: () => void) { await act(async () => callback()); }
async function update(changes: Partial<LiveMapProps>) {
  props = { ...props, ...changes };
  await event(() => rendered.update(React.createElement(LiveMap, props)));
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockAvailable = true;
  props = { data, now: 3000, captureHealth: 'healthy', camera: { mode: 'follow', center: null, zoom: 14 }, onCameraChange: jest.fn() };
  await act(async () => { rendered = create(React.createElement(LiveMap, props)); });
});
afterEach(async () => { await event(() => rendered.unmount()); jest.useRealTimers(); });

it('renders exact captured position, keeps stale evidence stationary and distinguishes read errors from recording', async () => {
  expect(map().pilotPosition).toEqual([8.001, 46.001]);
  expect(map().pilotStale).toBe(false);
  expect(map().track.first).toBeUndefined();
  expect(map().track.last).toBeUndefined();
  await update({ now: 20_000 });
  expect(map().pilotPosition).toEqual([8.001, 46.001]);
  expect(map().pilotStale).toBe(true);
  expect(text()).toContain('Last known position');
  expect(text()).toContain('fix 18s old');
  await update({ now: 3000, data: { ...data, readError: 'SQLite busy' } });
  expect(map().pilotStale).toBe(true);
  expect(text()).toContain('Map data unavailable');
  expect(map().pilotPosition).toEqual([8.001, 46.001]);
});

it('preserves native route and marker source identity across age-only and camera-intent updates', async () => {
  const track = map().track;
  const point = map().pilotPosition;
  await update({ now: 3500 });
  expect(map().track).toBe(track);
  expect(map().pilotPosition).toBe(point);
  await update({ camera: { mode: 'manual', center: [9, 47], zoom: 12 } });
  expect(map().track).toBe(track);
  expect(map().pilotPosition).toBe(point);
  await update({ data: { ...data, observedAt: 4000 } });
  expect(map().track).not.toBe(track);
  expect(map().pilotPosition).toEqual(point);
});

it('falls back after fifteen seconds and accepts only the current explicit retry callbacks', async () => {
  const oldMap = map();
  await event(() => jest.advanceTimersByTime(LIVE_MAP_LOAD_TIMEOUT_MS));
  expect(hasMap()).toBe(false);
  expect(rendered.root.findAllByType(LiveGrid)).toHaveLength(1);
  expect(control('Retry map')).toBeDefined();
  await event(() => control('Retry map')!.props.onPress());
  expect(hasMap()).toBe(true);
  const current = map();
  await event(() => oldMap.onError('obsolete'));
  await event(() => oldMap.onLiveCameraChange({ mode: 'manual', center: [0, 0], zoom: 4 }));
  expect(hasMap()).toBe(true);
  expect(props.onCameraChange).not.toHaveBeenCalled();
  await event(() => current.onReady());
  await event(() => jest.advanceTimersByTime(LIVE_MAP_LOAD_TIMEOUT_MS));
  expect(hasMap()).toBe(true);
  await event(() => current.onError('tile failure after load'));
  expect(hasMap()).toBe(false);
});

it('does not mount or time out a map without captured position or native configuration', async () => {
  await update({ data: { ...data, rows: [], position: null } });
  expect(hasMap()).toBe(false);
  expect(text()).toContain('Waiting for a recorded position');
  await event(() => jest.advanceTimersByTime(LIVE_MAP_LOAD_TIMEOUT_MS));
  expect(control('Retry map')).toBeUndefined();
  mockAvailable = false;
  await update({ data });
  expect(hasMap()).toBe(false);
  expect(text()).toContain('Map unavailable');
  expect(control('Retry map')).toBeUndefined();
});

it('recenters only a fresh geographic map and preserves manual zoom through failure/retry', async () => {
  await update({ camera: { mode: 'manual', center: [9, 47], zoom: 16 } });
  await event(() => control('Recenter map')!.props.onPress());
  expect(props.onCameraChange).toHaveBeenCalledWith({ mode: 'follow', center: [8.001, 46.001], zoom: 16 });
  await update({ now: 20_000 });
  expect(control('Recenter map')!.props.disabled).toBe(true);
  await event(() => control('Recenter map')!.props.onPress());
  expect(props.onCameraChange).toHaveBeenCalledTimes(1);
  await event(() => map().onError('map unavailable'));
  expect(control('Recenter map')).toBeUndefined();
  await event(() => control('Retry map')!.props.onPress());
  expect(map().liveCamera).toEqual(props.camera);
});

it('fits Grid to the bounded route with one latest-position marker and no route endpoint markers', async () => {
  await update({ camera: { mode: 'manual', center: [9, 47], zoom: 16 } });
  await event(() => map().onError('map unavailable'));
  const circles = rendered.root.findAllByType(Circle).filter((node) => node.props.r === 7 && node.props.strokeWidth === 3);
  expect(circles).toHaveLength(1);
  expect(circles[0]!.props.cx).toBeGreaterThan(180);
  expect(circles[0]!.props.cx).toBeLessThan(360);
  expect(circles[0]!.props.cy).toBeCloseTo(140);
  expect(text()).toContain('Recent trail · Grid overview');
  expect(text()).not.toContain('Following recorded position');
});

it('resets a failed attempt for a different session and ignores callbacks after unmount', async () => {
  const oldMap = map();
  await event(() => oldMap.onError('failed'));
  await update({ data: { ...data, sessionId: 'new', rows: data.rows.map((row) => ({ ...row, sessionId: 'new' })),
    position: { ...position, sessionId: 'new' }, cursor: { sessionId: 'new', sequence: 2 } } });
  expect(hasMap()).toBe(true);
  await event(() => oldMap.onError('late'));
  expect(hasMap()).toBe(true);
});

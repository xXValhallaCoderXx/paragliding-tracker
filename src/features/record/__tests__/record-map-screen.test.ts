/** @jest-environment node
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import React from 'react';
import { AppState } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import RecordFlightScreen from '@/app/record';
import { FlightMap } from '@/components/flight-map';
import { Button } from '@/components/ui';
import { flightRepository } from '@/recorder/flight-repository';
import { recorderService } from '@/recorder/recorder-service';
import type { RecorderSnapshot } from '@/recorder/types';
import type { LiveMapPage } from '@/lib/live/types';
import { dataApi } from '@/store/endpoints';
import { RecorderLifecycleProvider } from '../recorder-lifecycle';
import { clearRecordingViewIntent } from '../recording-view-intent';
import { HoldToStop } from '../components/hold-to-stop';
import { create, act } from '../../../../tests/support/renderer';

let mockFocused = true;
const mockReplace = jest.fn();
const mockRouter = { canGoBack: () => true, back: jest.fn(), replace: mockReplace, push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useIsFocused: () => mockFocused,
}));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: {
  subscribe: jest.fn(), recover: jest.fn(), stop: jest.fn(), arm: jest.fn(),
} }));
jest.mock('@/recorder/flight-repository', () => ({
  flightRepository: { getLiveMapPage: jest.fn() }, appSettingsRepository: {}, pilotProfileRepository: {},
}));
jest.mock('@/sites/site-service', () => ({ fetchNearbySites: jest.fn(), searchSitesByName: jest.fn() }));
jest.mock('@/lib/system-settings', () => ({ openSystemScreen: jest.fn() }));
jest.mock('../components/preflight', () => ({ PreflightView: () => null }));
jest.mock('../components/interrupted', () => ({ InterruptedView: () => null }));
jest.mock('@/components/flight-map', () => ({ FlightMap: jest.fn(() => null), isFlightMapAvailable: true }));
jest.mock('@/components/ui', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
  Button: jest.fn(() => null), TopBar: () => null, Notice: jest.fn(() => null),
  BusyRow: () => null, LoadingScreen: () => null, Disclaimer: () => null,
  Hairline: () => null, StatusPill: () => null,
}));

let snapshot: RecorderSnapshot;
let emit: (next: RecorderSnapshot) => void;
let appListeners: Set<(state: 'active' | 'background' | 'inactive') => void>;
let root: ReturnType<typeof create>;
let store: ReturnType<typeof makeStore>;
function makeStore() {
  return configureStore({ reducer: { [dataApi.reducerPath]: dataApi.reducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(dataApi.middleware) });
}
function tree() {
  // Provider's createElement props require children, even when passed as the third argument.
  // eslint-disable-next-line react/no-children-prop
  return React.createElement(Provider, { store, children:
    // eslint-disable-next-line react/no-children-prop
    React.createElement(RecorderLifecycleProvider, { children: React.createElement(RecordFlightScreen) }) });
}
function page(sessionId = snapshot.sessionId!): LiveMapPage {
  const point = { sessionId, sequence: 1, sourceTimestamp: Date.now(), receiptTimestamp: Date.now(),
    latitude: 1.3, longitude: 103.8, horizontalAccuracy: 5, mocked: false };
  return { sessionId, mode: 'bootstrap', rows: [point], position: point,
    cursor: { sessionId, sequence: 1 }, highWatermark: 1, hasMore: false };
}
async function select(label: 'Map' | 'Instruments') {
  await act(async () => {
    root.root.findAllByProps({ accessibilityRole: 'tab', accessibilityLabel: label })[0]!.props.onPress();
  });
}
async function advance(ms = 50) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
async function appState(state: 'active' | 'background') {
  await act(async () => { for (const listener of [...appListeners]) listener(state); });
  await advance();
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(1_000_000); jest.clearAllMocks();
  mockFocused = true; clearRecordingViewIntent(); appListeners = new Set();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    appListeners.add(callback); return { remove: () => appListeners.delete(callback) };
  });
  snapshot = {
    capturedAt: Date.now(), state: 'recording', sessionId: 's1', flightId: 'f1',
    startedAt: Date.now() - 20_000, endedAt: null, lastFixAt: Date.now(), lastFixReceivedAt: Date.now(),
    lastLocationCallbackAt: Date.now(), captureHealth: 'healthy', durationMs: 20_000,
    fixCount: 20, pressureCount: 0, gpsAltitude: 500, speed: 10, horizontalAccuracy: 5,
    pressure: null, batteryLevel: 0.8, lowPowerMode: false, batteryOptimizationEnabled: false,
    taskRegistered: true, lastError: null,
    capabilities: { platform: 'android', supported: true, taskManagerAvailable: true,
      locationServicesEnabled: true, gpsAvailable: true, preciseLocation: true, pressureAvailable: false,
      batteryAvailable: true, sharingAvailable: true, foregroundPermission: 'granted', backgroundPermission: 'granted' },
  };
  jest.mocked(recorderService.subscribe).mockImplementation((listener) => { emit = listener; listener(snapshot); return jest.fn(); });
  jest.mocked(recorderService.recover).mockResolvedValue(snapshot);
  jest.mocked(flightRepository.getLiveMapPage).mockImplementation(async ({ sessionId }) => page(sessionId));
  store = makeStore();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); store.dispatch(dataApi.util.resetApiState()); });
  await jest.runOnlyPendingTimersAsync(); jest.useRealTimers(); jest.restoreAllMocks();
  clearRecordingViewIntent();
});

it('defaults to Instruments, releases reads on switches/blur, and restores only same-session view and camera intent', async () => {
  await act(async () => { root = create(tree()); });
  expect(flightRepository.getLiveMapPage).not.toHaveBeenCalled();
  await select('Map'); await advance();
  expect(root.root.findAllByType(FlightMap)).toHaveLength(1);
  // The native renderer is the only mocked map boundary; query and lifecycle are real.
  await act(async () => {
    root.root.findByType(FlightMap).props.onLiveCameraChange({ mode: 'manual', center: [104, 2], zoom: 12 });
  });
  await select('Instruments'); await advance();
  const reads = jest.mocked(flightRepository.getLiveMapPage).mock.calls.length;
  await advance(3_000);
  expect(flightRepository.getLiveMapPage).toHaveBeenCalledTimes(reads);
  expect(dataApi.endpoints.getLiveMap.select('s1')(store.getState()).status).toBe('uninitialized');
  await select('Map'); await advance();
  mockFocused = false;
  await act(async () => { root.update(tree()); }); await advance();
  expect(root.root.findAllByType(FlightMap)).toHaveLength(0);
  mockFocused = true;
  await act(async () => { root.update(tree()); }); await advance();
  expect(root.root.findAllByType(FlightMap)).toHaveLength(1);
  expect(root.root.findByType(FlightMap).props.liveCamera).toEqual({ mode: 'manual', center: [104, 2], zoom: 12 });
  await act(async () => { root.unmount(); }); await advance();
  await act(async () => { root = create(tree()); }); await advance();
  expect(root.root.findByType(FlightMap).props.liveCamera).toEqual({ mode: 'manual', center: [104, 2], zoom: 12 });
  snapshot = { ...snapshot, sessionId: 's2', flightId: 'f2' };
  await act(async () => { emit(snapshot); }); await advance();
  expect(root.root.findAllByType(FlightMap)).toHaveLength(0);
  expect(dataApi.endpoints.getLiveMap.select('s1')(store.getState()).status).toBe('uninitialized');
  expect(recorderService.subscribe).toHaveBeenCalledTimes(2);
  expect(recorderService.arm).not.toHaveBeenCalled();
});

it('waits for actual foreground recorder recovery before reopening the map query', async () => {
  await act(async () => { root = create(tree()); });
  await select('Map'); await advance();
  await appState('background');
  const reads = jest.mocked(flightRepository.getLiveMapPage).mock.calls.length;
  let finish!: (snapshot: RecorderSnapshot) => void;
  jest.mocked(recorderService.recover).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await appState('active'); await advance(2_000);
  expect(root.root.findAllByType(FlightMap)).toHaveLength(0);
  expect(flightRepository.getLiveMapPage).toHaveBeenCalledTimes(reads);
  await act(async () => { finish(snapshot); }); await advance();
  expect(root.root.findAllByType(FlightMap)).toHaveLength(1);
  expect(flightRepository.getLiveMapPage).toHaveBeenCalledTimes(reads + 1);
});

it('keeps fixed Stop usable through map failure, releases map work while stopping and retries saving without restarting', async () => {
  await act(async () => { root = create(tree()); });
  await select('Map'); await advance();
  await act(async () => { root.root.findByType(FlightMap).props.onError('tiles failed'); });
  expect(root.root.findAllByType(FlightMap)).toHaveLength(0);
  const footer = root.root.findByProps({ testID: 'recording-footer' });
  expect(footer.findByType(HoldToStop).props.disabled).toBe(false);
  let rejectStop!: (error: Error) => void;
  jest.mocked(recorderService.stop).mockImplementationOnce(async () => {
    emit({ ...snapshot, state: 'stopping' });
    await new Promise<void>((_resolve, reject) => { rejectStop = reject; });
  });
  await act(async () => {
    const confirm = footer.findByType(HoldToStop).props.onConfirm;
    confirm(); confirm();
  });
  expect(recorderService.stop).toHaveBeenCalledTimes(1);
  await advance();
  expect(dataApi.endpoints.getLiveMap.select('s1')(store.getState()).status).toBe('uninitialized');
  await act(async () => { rejectStop(new Error('disk busy')); });
  const retry = root.root.findAllByType(Button).find((node: { props: { label: string } }) =>
    node.props.label === 'Retry saving stopped flight');
  expect(retry).toBeDefined();
  jest.mocked(recorderService.stop).mockImplementationOnce(async () => { emit({ ...snapshot, state: 'completed' }); });
  await act(async () => { retry.props.onPress(); });
  expect(recorderService.stop).toHaveBeenCalledTimes(2);
  expect(recorderService.arm).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/flights/[id]', params: { id: 'f1', saved: 'stopped' } });
});

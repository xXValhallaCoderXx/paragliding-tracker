import React from 'react';
import { BackHandler } from 'react-native';
import { useGetFlightReplayQuery } from '@/store/endpoints';
import ReplayScreen from '@/app/flights/[id]/replay';
import { ReplayPlayer } from '../replay/replay-player';

import { create, act } from '../../../../tests/support/renderer';
const mockDismissTo = jest.fn();
const mockRouter = { dismissTo: mockDismissTo };
const mockQueryRelease = jest.fn();
let mockFocused = true;
let mockReady = true;
let mockRecovering = false;
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'flight-123' }),
  useIsFocused: () => mockFocused,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factories are hoisted
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('@/features/record/recorder-lifecycle', () => ({ useRecorderLifecycle: () => ({ ready: mockReady, recovering: mockRecovering }) }));
jest.mock('@/store/endpoints', () => ({ useGetFlightReplayQuery: jest.fn() }));
jest.mock('../replay/replay-player', () => ({ ReplayPlayer: jest.fn(() => null) }));
jest.mock('@/components/ui', () => ({
  BusyRow: () => null, Button: () => null, Notice: () => null, TopBar: () => null,
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; mockReady = true; mockRecovering = false;
  jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(useGetFlightReplayQuery).mockImplementation(function useMockReplayQuery() {
    React.useEffect(() => () => mockQueryRelease(), []);
    return { currentData: { kind: 'available', flightId: 'flight-123', partial: false, bounds: { startedAt: 0, endedAt: 1000 }, points: [] }, refetch: jest.fn() } as unknown as ReturnType<typeof useGetFlightReplayQuery>;
  });
});
afterEach(() => jest.restoreAllMocks());
it('Android Back always returns to the selected detail even after a direct open', async () => {
  let root: { unmount: () => void };
  await act(async () => { root = create(React.createElement(ReplayScreen)); });
  const callback = jest.mocked(BackHandler.addEventListener).mock.calls[0]![1];
  expect(callback({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: '/flights/[id]', params: { id: 'flight-123' } });
  await act(async () => root!.unmount());
});
it('unmounts the query and player on blur, releasing hook-held samples as well as the cache subscription', async () => {
  let root: { unmount: () => void; update: (node: React.ReactElement) => void };
  await act(async () => { root = create(React.createElement(ReplayScreen)); });
  expect(useGetFlightReplayQuery).toHaveBeenLastCalledWith('flight-123');
  expect(ReplayPlayer).toHaveBeenCalledTimes(1);
  mockFocused = false;
  await act(async () => root!.update(React.createElement(ReplayScreen)));
  expect(useGetFlightReplayQuery).toHaveBeenCalledTimes(1);
  expect(mockQueryRelease).toHaveBeenCalledTimes(1);
  expect(ReplayPlayer).toHaveBeenCalledTimes(1);
  mockFocused = true;
  await act(async () => root!.update(React.createElement(ReplayScreen)));
  expect(useGetFlightReplayQuery).toHaveBeenCalledTimes(2);
  expect(ReplayPlayer).toHaveBeenCalledTimes(2);
  await act(async () => root!.unmount());
  expect(mockQueryRelease).toHaveBeenCalledTimes(2);
});
it('does not mount the query before recorder initialization or during recovery', async () => {
  let root: { unmount: () => void; update: (node: React.ReactElement) => void };
  mockReady = false;
  await act(async () => { root = create(React.createElement(ReplayScreen)); });
  expect(useGetFlightReplayQuery).not.toHaveBeenCalled();
  mockReady = true; mockRecovering = true;
  await act(async () => root!.update(React.createElement(ReplayScreen)));
  expect(useGetFlightReplayQuery).not.toHaveBeenCalled();
  mockRecovering = false;
  await act(async () => root!.update(React.createElement(ReplayScreen)));
  expect(useGetFlightReplayQuery).toHaveBeenCalledTimes(1);
  mockRecovering = true;
  await act(async () => root!.update(React.createElement(ReplayScreen)));
  expect(mockQueryRelease).toHaveBeenCalledTimes(1);
  await act(async () => root!.unmount());
});

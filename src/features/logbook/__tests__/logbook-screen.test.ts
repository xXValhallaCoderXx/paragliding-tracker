import React from 'react';
import { SectionList } from 'react-native';

import LogbookScreen from '@/app/(tabs)';
import { BusyRow } from '@/components/ui';
import { EmptyLogbook } from '../components/empty-logbook';
import { OpenFlightCard } from '../components/open-flight-card';
import { RecordFab } from '../components/record-fab';
import { SeasonCard } from '../components/season-card';
import { useGetFlightsQuery } from '@/store/endpoints';
import type { FlightSummary } from '@/recorder/types';
import { flight } from '../../../../tests/support/fixtures';
import { act, create } from '../../../../tests/support/renderer';

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
const mockRefetch = jest.fn();
const mockRefetchTracks = jest.fn();
const mockSync = { requestSync: jest.fn() };
let mockFocused = true;
let mockRecovering = false;
let mockFlights: FlightSummary[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => mockFocused,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('@/features/record/recorder-lifecycle', () => ({
  useRecorderLifecycle: () => ({ ready: true, recovering: mockRecovering, recoveryError: null }),
}));
jest.mock('@/features/account/cloud-sync-provider', () => ({ useCloudSync: () => mockSync }));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: { getCapabilities: async () => null } }));
jest.mock('@/store/endpoints', () => ({
  useGetFlightsQuery: jest.fn(() => ({ data: mockFlights, isLoading: false, isFetching: false, refetch: mockRefetch })),
  useGetFlightTracksQuery: () => ({ refetch: mockRefetchTracks }),
  useGetProfileQuery: () => ({}),
  useGetAppSettingsQuery: () => ({}),
}));
jest.mock('../components/flight-card', () => ({ FlightCard: () => null }));
jest.mock('../components/empty-logbook', () => ({ EmptyLogbook: () => null }));
jest.mock('../components/open-flight-card', () => ({ OpenFlightCard: () => null }));
jest.mock('../components/record-fab', () => ({ RecordFab: () => null }));
jest.mock('../components/season-card', () => ({ SeasonCard: () => null }));
jest.mock('../components/setup-checklist-card', () => ({ SetupChecklistCard: () => null }));
jest.mock('@/components/ui', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
  BusyRow: () => null, Button: () => null,
  Notice: () => null, SectionLabel: () => null,
}));

type TestNode = { props: Record<string, any> };
let rendered: { root: {
  findByType: (type: unknown) => TestNode;
  findAllByType: (type: unknown) => TestNode[];
}; update: (node: React.ReactNode) => void; unmount: () => void };
const list = () => rendered.root.findByType(SectionList).props;
const card = (id: string) => list().renderItem({ item: mockFlights.find((item) => item.id === id) }).props.children.props;
async function update() { await act(async () => rendered.update(React.createElement(LogbookScreen))); }

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockRecovering = false;
  mockFlights = [flight({ id: 'august' }), flight({ id: 'july', startedAt: Date.UTC(2026, 6, 10) })];
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); });

it('enables previews only for visible flight rows, then disables them as rows leave or the tab blurs', async () => {
  await act(async () => { rendered = create(React.createElement(LogbookScreen)); });
  expect(card('august').mapPreviewEnabled).toBe(false);
  expect(card('july').mapPreviewEnabled).toBe(false);
  const viewable = (id: string, index: number | null = 0) => ({ item: mockFlights.find((item) => item.id === id), index, isViewable: true });
  await act(async () => list().onViewableItemsChanged({ viewableItems: [viewable('august'), viewable('july', null)], changed: [] }));
  expect(card('august').mapPreviewEnabled).toBe(true);
  expect(card('july').mapPreviewEnabled).toBe(false);
  await act(async () => list().onViewableItemsChanged({ viewableItems: [viewable('july')], changed: [] }));
  expect(card('august').mapPreviewEnabled).toBe(false);
  expect(card('july').mapPreviewEnabled).toBe(true);
  mockFocused = false;
  await update();
  expect(card('july').mapPreviewEnabled).toBe(false);
  mockFocused = true;
  await update();
  expect(card('july').mapPreviewEnabled).toBe(true);
  card('july').onPress();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/flights/[id]', params: { id: 'july' } });
});

it('keeps pinned content, month headings, empty content and refresh controls behind the existing recovery guard', async () => {
  mockFlights = [flight({ id: 'open', status: 'recording', sessionStatus: 'recording', endedAt: null, metrics: null }), ...mockFlights];
  await act(async () => { rendered = create(React.createElement(LogbookScreen)); });
  expect(rendered.root.findByType(OpenFlightCard).props.flight.id).toBe('open');
  expect(rendered.root.findAllByType(SeasonCard)).toHaveLength(1);
  expect(rendered.root.findAllByType(EmptyLogbook)).toHaveLength(0);
  const sections = list().sections;
  expect(sections.map((section: { data: FlightSummary[] }) => section.data.map((item) => item.id))).toEqual([['august'], ['july']]);
  expect(list().renderSectionHeader({ section: sections[0] }).props.children.props.children).toBe('Earlier · August 2026');
  expect(list().renderSectionHeader({ section: sections[1] }).props.children.props.children).toBe('July 2026');
  mockRecovering = true;
  await update();
  expect(useGetFlightsQuery).toHaveBeenLastCalledWith(undefined, { skip: true });
  expect(rendered.root.findByType(BusyRow).props.label).toBe('Checking recorder health…');
  expect(rendered.root.findByType(OpenFlightCard).props.disabled).toBe(true);
  expect(rendered.root.findByType(RecordFab).props.disabled).toBe(true);
  mockRefetch.mockClear();
  list().refreshControl.props.onRefresh();
  expect(mockRefetch).not.toHaveBeenCalled();
  expect(mockSync.requestSync).toHaveBeenLastCalledWith('manual');
  mockRecovering = false;
  mockFlights = [];
  await update();
  expect(rendered.root.findAllByType(EmptyLogbook)).toHaveLength(1);
  expect(rendered.root.findAllByType(RecordFab)).toHaveLength(0);
  mockRefetch.mockClear();
  list().refreshControl.props.onRefresh();
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

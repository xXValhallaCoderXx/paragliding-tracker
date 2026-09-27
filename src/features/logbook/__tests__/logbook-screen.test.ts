/** @jest-environment node
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import React from 'react';
import { SectionList } from 'react-native';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

import LogbookScreen from '@/app/(tabs)';
import { BusyRow, Button } from '@/components/ui';
import { EmptyLogbook } from '../components/empty-logbook';
import { OpenFlightCard } from '../components/open-flight-card';
import { RecordFab } from '../components/record-fab';
import { JournalSummaryCard } from '../components/journal-summary-card';
import { JournalFilterSheet } from '../components/journal-filter-sheet';
import { journalViewReducer, journalAuthChanged, journalOwnerChanged } from '@/store/journal-view';
import { defaultJournalCriteria } from '../journal-query';
import { useGetFlightsQuery } from '@/store/endpoints';
import type { EquipmentInventory } from '@/equipment/types';
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
let mockEquipment: EquipmentInventory | undefined;
let mockFlightsError: { message: string } | undefined;

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
  useGetFlightsQuery: jest.fn(() => ({ data: mockFlights, error: mockFlightsError, isLoading: false, isFetching: false, refetch: mockRefetch })),
  useGetFlightTracksQuery: () => ({ refetch: mockRefetchTracks }),
  useGetEquipmentInventoryQuery: () => ({ data: mockEquipment }),
  useGetProfileQuery: () => ({}),
  useGetAppSettingsQuery: () => ({}),
}));
jest.mock('../components/flight-card', () => ({ FlightCard: () => null }));
jest.mock('../components/empty-logbook', () => ({ EmptyLogbook: () => null }));
jest.mock('../components/open-flight-card', () => ({ OpenFlightCard: () => null }));
jest.mock('../components/record-fab', () => ({ RecordFab: () => null }));
jest.mock('../components/journal-summary-card', () => ({ JournalSummaryCard: () => null }));
jest.mock('../components/journal-filter-sheet', () => ({ JournalFilterSheet: () => null }));
jest.mock('../components/setup-checklist-card', () => ({ SetupChecklistCard: () => null }));
jest.mock('@/components/ui', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
  BusyRow: () => null, Button: () => null,
  Notice: () => null, SectionLabel: () => null,
}));

type TestNode = { props: Record<string, any> };
let rendered: { root: {
  findByType: (type: unknown) => TestNode;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
  findAllByType: (type: unknown) => TestNode[];
}; update: (node: React.ReactNode) => void; unmount: () => void };
const makeStore = () => configureStore({ reducer: { journalView: journalViewReducer } });
let mockStore = makeStore();
// eslint-disable-next-line react/no-children-prop -- Provider's required children prop must be supplied in these non-JSX tests.
const screen = () => React.createElement(Provider, { store: mockStore, children: React.createElement(LogbookScreen) });
const list = () => rendered.root.findByType(SectionList).props;
const card = (id: string) => list().renderItem({ item: mockFlights.find((item) => item.id === id) }).props.children.props;
async function update() { await act(async () => rendered.update(screen())); }

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
  mockFocused = true;
  mockRecovering = false;
  mockEquipment = undefined;
  mockFlightsError = undefined;
  mockFlights = [flight({ id: 'august' }), flight({ id: 'july', startedAt: Date.UTC(2026, 6, 10) })];
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); });

it('enables previews only for visible flight rows, then disables them as rows leave or the tab blurs', async () => {
  await act(async () => { rendered = create(screen()); });
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
  await act(async () => { rendered = create(screen()); });
  expect(rendered.root.findByType(OpenFlightCard).props.flight.id).toBe('open');
  expect(rendered.root.findAllByType(JournalSummaryCard)).toHaveLength(1);
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
  mockEquipment = undefined;
  mockFlights = [];
  await update();
  expect(rendered.root.findAllByType(EmptyLogbook)).toHaveLength(1);
  expect(rendered.root.findAllByType(RecordFab)).toHaveLength(0);
  mockRefetch.mockClear();
  list().refreshControl.props.onRefresh();
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

it('shows the current aircraft on an empty Home and removes it when archived', async () => {
  mockFlights = [];
  mockEquipment = { owner: 'guest', identities: [], aircraft: [{ kind: 'aircraft', id: 'wing', value: {
    id: 'wing', sport: 'hang_gliding', model: 'Synthetic aircraft', size: '155', registrationId: null, archived: false,
  }, generation: 1, serverRevision: 0, pending: true, conflict: null }], selection: {
    kind: 'selection', id: 'current', value: { aircraftId: 'wing' }, generation: 1, serverRevision: 0, pending: true, conflict: null,
  } };
  await act(async () => { rendered = create(screen()); });
  expect(rendered.root.findByType(EmptyLogbook).props.gliderType).toBe('Synthetic aircraft 155');
  mockEquipment.aircraft[0]!.value.archived = true;
  await update();
  expect(rendered.root.findByType(EmptyLogbook).props.gliderType).toBeNull();
});

const button = (label: string) => rendered.root.findAllByType(Button).find((item) => item.props.label === label)!.props;

it('applies and clears filters using cached summaries while keeping the open recording pinned', async () => {
  mockFlights = [flight({ id: 'open', sessionStatus: 'interrupted', status: 'partial', metrics: null }),
    flight({ id: 'hill', site: 'Hill' }), flight({ id: 'valley', site: 'Valley' })];
  await act(async () => { rendered = create(screen()); });
  mockRefetch.mockClear(); mockRefetchTracks.mockClear(); mockSync.requestSync.mockClear();
  await act(async () => button('Filters').onPress());
  await act(async () => rendered.root.findByType(JournalFilterSheet).props.onApply({ ...defaultJournalCriteria(), sites: ['site:hill'] }));
  expect(list().sections.flatMap((section: { data: FlightSummary[] }) => section.data.map((item) => item.id))).toEqual(['hill']);
  expect(rendered.root.findByType(JournalSummaryCard).props.summary.flightCount).toBe(1);
  expect(rendered.root.findByType(OpenFlightCard).props.flight.id).toBe('open');
  expect(mockRefetch).not.toHaveBeenCalled(); expect(mockRefetchTracks).not.toHaveBeenCalled(); expect(mockSync.requestSync).not.toHaveBeenCalled();
  const clear = rendered.root.findAll((item) => item.props.accessibilityLabel === 'Remove Hill filter')[0]!;
  await act(async () => clear.props.onPress());
  expect(rendered.root.findByType(JournalSummaryCard).props.summary.flightCount).toBe(2);
});

it('distinguishes no matches from a first flight and retains applied state through remount', async () => {
  await act(async () => { rendered = create(screen()); });
  await act(async () => button('Filters').onPress());
  await act(async () => rendered.root.findByType(JournalFilterSheet).props.onApply({ ...defaultJournalCriteria(), year: 1999 }));
  expect(list().sections).toHaveLength(0);
  expect(rendered.root.findAllByType(EmptyLogbook)).toHaveLength(0);
  expect(rendered.root.findAllByType(JournalSummaryCard)).toHaveLength(0);
  expect(button('Edit filters')).toBeDefined();
  await act(async () => rendered.unmount());
  await act(async () => { rendered = create(screen()); });
  expect(mockStore.getState().journalView.criteria.year).toBe(1999);
  await act(async () => button('Clear filters').onPress());
  expect(list().sections).toHaveLength(2);
});

it('dismisses old drafts on owner and auth changes and ignores their late Apply', async () => {
  await act(async () => { rendered = create(screen()); });
  await act(async () => button('Filters').onPress());
  const oldApply = rendered.root.findByType(JournalFilterSheet).props.onApply;
  await act(async () => mockStore.dispatch(journalOwnerChanged()));
  expect(rendered.root.findAllByType(JournalFilterSheet)).toHaveLength(0);
  await act(async () => oldApply({ ...defaultJournalCriteria(), year: 1999 }));
  expect(mockStore.getState().journalView.criteria.year).toBeNull();
  await act(async () => button('Filters').onPress());
  await act(async () => oldApply({ ...defaultJournalCriteria(), year: 1999 }));
  expect(rendered.root.findAllByType(JournalFilterSheet)).toHaveLength(1);
  await act(async () => mockStore.dispatch(journalAuthChanged('qa-new')));
  expect(rendered.root.findAllByType(JournalFilterSheet)).toHaveLength(0);
});

it('does not report zero matching flights when the initial journal read failed', async () => {
  await act(async () => { rendered = create(screen()); });
  await act(async () => button('Filters').onPress());
  await act(async () => rendered.root.findByType(JournalFilterSheet).props.onApply({ ...defaultJournalCriteria(), year: 1999 }));
  mockFlights = [];
  mockFlightsError = { message: 'Storage read failed' };
  await update();
  expect(rendered.root.findAllByType(JournalSummaryCard)).toHaveLength(0);
  expect(rendered.root.findAllByType(EmptyLogbook)).toHaveLength(0);
  expect(button('Try again')).toBeDefined();
  expect(rendered.root.findAllByType(Button).some((item) => item.props.label === 'Edit filters')).toBe(false);
});

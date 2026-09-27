/** @jest-environment node
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

import LogbookScreen from '@/app/(tabs)';
import type { AuthSnapshot } from '@/cloud/types';
import { Button } from '@/components/ui';
import { CloudSyncProvider } from '@/features/account/cloud-sync-provider';
import { notifyJournal, setJournalOwner } from '@/journal/context';
import { JournalFilterSheet } from '../components/journal-filter-sheet';
import { defaultJournalCriteria } from '../journal-query';
import { applyJournalCriteria, journalViewReducer } from '@/store/journal-view';
import { flight } from '../../../../tests/support/fixtures';
import { act, create } from '../../../../tests/support/renderer';

let mockAuth: AuthSnapshot;
const mockRefetch = jest.fn();
const mockRefetchTracks = jest.fn();
const mockRouter = { push: jest.fn() };
const mockFlights = [flight({ site: 'Synthetic Site', siteSource: 'manual' })];
// Local identity boundaries must also work in an unconfigured or offline-only build.
jest.mock('@/cloud/config', () => ({ cloudConfigured: false }));
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('@/features/record/recorder-lifecycle', () => ({
  useRecorderLifecycle: () => ({ ready: true, recovering: false, recoveryError: null, recoveryVersion: 1 }),
}));
jest.mock('@/cloud/sync-engine', () => ({ cloudSyncEngine: {
  getSnapshot: () => ({ phase: 'blocked', blockedBy: 'unconfigured', lastSyncAt: null,
    pendingFlights: 0, pendingDeletions: 0, cloudOnlyFlights: 0, linkedUserId: null, lastError: null }),
  authChanged: async () => undefined,
} }));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: { getCapabilities: async () => null } }));
jest.mock('@/store', () => ({ store: { dispatch: (action: unknown) => mockStore.dispatch(action as never) } }));
jest.mock('@/store/api', () => ({ api: { util: {
  resetApiState: () => ({ type: 'test/api-reset' }),
  invalidateTags: () => ({ type: 'test/api-invalidate' }),
} } }));
jest.mock('@/store/endpoints', () => ({
  useGetFlightsQuery: () => ({ data: mockFlights, isLoading: false, isFetching: false, refetch: mockRefetch }),
  useGetFlightTracksQuery: () => ({ refetch: mockRefetchTracks }),
  useGetEquipmentInventoryQuery: () => ({}),
  useGetProfileQuery: () => ({}),
  useGetAppSettingsQuery: () => ({}),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter, useIsFocused: () => true,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('../components/flight-card', () => ({ FlightCard: () => null }));
jest.mock('../components/empty-logbook', () => ({ EmptyLogbook: () => null }));
jest.mock('../components/open-flight-card', () => ({ OpenFlightCard: () => null }));
jest.mock('../components/record-fab', () => ({ RecordFab: () => null }));
jest.mock('../components/journal-summary-card', () => ({ JournalSummaryCard: () => null }));
jest.mock('../components/journal-filter-sheet', () => ({ JournalFilterSheet: () => null }));
jest.mock('../components/setup-checklist-card', () => ({ SetupChecklistCard: () => null }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'BusyRow', 'Button', 'Notice', 'Screen', 'SectionLabel',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

const makeStore = () => configureStore({ reducer: {
  journalView: journalViewReducer,
  apiResetCount: (state: number = 0, action: { type: string }): number => action.type === 'test/api-reset' ? state + 1 : state,
} });
let mockStore: ReturnType<typeof makeStore>;
let rendered: ReturnType<typeof create>;
type TestNode = { props: Record<string, any> };
// eslint-disable-next-line react/no-children-prop -- Provider's createElement overload requires children in props.
const element = () => React.createElement(Provider, { store: mockStore,
  children: React.createElement(CloudSyncProvider, null, React.createElement(LogbookScreen)) });
async function mount() { await act(async () => { rendered = create(element()); }); }
async function update() { await act(async () => rendered.update(element())); }
const button = (label: string) => rendered.root.findAllByType(Button).find((node: TestNode) => node.props.label === label)!;
async function openSheet() {
  await act(async () => button('Filters (1)').props.onPress());
  return rendered.root.findByType(JournalFilterSheet).props.onApply;
}
async function selectSite() {
  await act(async () => mockStore.dispatch(applyJournalCriteria({
    criteria: { ...defaultJournalCriteria(), sites: ['site:synthetic site'] },
    revision: mockStore.getState().journalView.revision,
  })));
}

beforeEach(() => {
  mockStore = makeStore();
  mockAuth = { status: 'signed_in', userId: 'pilot-a', email: 'pilot-a@example.test', lastError: null };
  setJournalOwner('pilot-a');
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  setJournalOwner(null);
});

it.each(['sign-out', 'different account'] as const)('bridges %s to a closed sheet and default criteria, rejecting its old Apply callback', async (change) => {
  await mount();
  await selectSite();
  const previousRevision = mockStore.getState().journalView.revision;
  const staleApply = await openSheet();
  mockAuth = change === 'sign-out'
    ? { ...mockAuth, status: 'signed_out', userId: null, email: null }
    : { ...mockAuth, userId: 'pilot-b', email: 'pilot-b@example.test' };
  await update();
  expect(mockStore.getState().journalView.revision).toBe(previousRevision + 1);
  expect(mockStore.getState().journalView.criteria).toEqual(defaultJournalCriteria());
  expect(rendered.root.findAllByType(JournalFilterSheet)).toHaveLength(0);
  expect(mockStore.getState().apiResetCount).toBe(0);
  await act(async () => staleApply({ ...defaultJournalCriteria(), sites: ['site:old account draft'], sort: 'oldest' }));
  expect(mockStore.getState().journalView.criteria).toEqual(defaultJournalCriteria());
});

it('bridges journal owner changes synchronously, resets query caches and prevents a previous owner’s draft from returning', async () => {
  await mount();
  await selectSite();
  const oldRevision = mockStore.getState().journalView.revision;
  const staleApply = await openSheet();
  await act(async () => setJournalOwner('pilot-b'));
  expect(mockStore.getState().journalView.revision).toBe(oldRevision + 1);
  expect(mockStore.getState().apiResetCount).toBe(1);
  expect(rendered.root.findAllByType(JournalFilterSheet)).toHaveLength(0);
  await act(async () => staleApply({ ...defaultJournalCriteria(), year: 2020 }));
  expect(mockStore.getState().journalView.criteria).toEqual(defaultJournalCriteria());
});

it('keeps an active draft through ordinary metadata updates and same-account auth refreshes', async () => {
  await mount();
  await selectSite();
  const revision = mockStore.getState().journalView.revision;
  const apply = await openSheet();
  await act(async () => notifyJournal({ kind: 'metadata', flightId: mockFlights[0]!.id }));
  mockAuth = { ...mockAuth, email: 'updated-address@example.test' };
  await update();
  expect(mockStore.getState().journalView.revision).toBe(revision);
  expect(rendered.root.findAllByType(JournalFilterSheet)).toHaveLength(1);
  expect(mockStore.getState().apiResetCount).toBe(0);
  await act(async () => apply({ ...defaultJournalCriteria(), sort: 'oldest' }));
  expect(mockStore.getState().journalView.criteria.sort).toBe('oldest');
});

import React from 'react';
import { Alert, BackHandler, Keyboard } from 'react-native';
import FlightDetailScreen from '@/app/flights/[id]';
import { Button, Notice, TopBar } from '@/components/ui';
import { EvidenceBlock } from '../components/evidence';
import { MetadataSheet } from '../components/metadata-sheet';
import { MetadataForm } from '../components/metadata-form';
import { OwnFlightHero } from '../components/own-flight-hero';
import { FlightActionsSheet } from '../components/flight-actions-sheet';
import { FlightSharingSection } from '@/features/feed/flight-sharing-section';
import type { FlightDetail } from '@/recorder/types';
import { flightMutationGuard, storedFlightMetadata } from '@/lib/flight-mutations';
import { setFlightAuthIdentity } from '@/lib/flight-scope';
import { useGetFlightQuery } from '@/store/endpoints';
import { create, act } from '../../../../tests/support/renderer';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, setParams: jest.fn() };
const mockRequestSync = jest.fn();
const mockRetryRestore = jest.fn();
const mockShareArchivedIgc = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
let mockSaved: string | undefined;
let mockHardwareBack: () => boolean;
jest.mock('@/journal/artifacts', () => ({ shareArchivedIgc: (...args: unknown[]) => mockShareArchivedIgc(...args) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'flight-123', saved: mockSaved }), useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => ({ status: 'signed_out' }) }));
jest.mock('@/features/account/cloud-sync-provider', () => ({ useCloudSync: () => ({ requestSync: mockRequestSync, retryRestore: mockRetryRestore }) }));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: {} }));
jest.mock('@/store/endpoints', () => ({
  useGetFlightQuery: jest.fn(), useGetFlightTrackQuery: () => ({ data: [] }), useGetFlightsQuery: () => ({ data: [] }),
  useUpdateFlightMutation: () => [(request: unknown) => ({ unwrap: () => mockUpdate(request) })],
  useDeleteFlightMutation: () => [(request: unknown) => ({ unwrap: () => mockDelete(request) })],
}));
jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), Notice: jest.fn(() => null), TopBar: jest.fn(({ right }) => right ?? null), BusyRow: () => null, LoadingScreen: () => null, SectionLabel: () => null,
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/features/postcard/postcard-composer', () => ({ PostcardComposer: () => null }));
jest.mock('@/features/feed/flight-sharing-section', () => ({ FlightSharingSection: jest.fn((props) => props.extraActions({ label: 'Share with friends', reason: null, onPress: () => props.beforeOpen(jest.fn()) })) }));
jest.mock('../components/evidence', () => ({ EvidenceBlock: jest.fn(() => null) }));
jest.mock('../components/own-flight-hero', () => ({ OwnFlightHero: jest.fn(() => null) }));
jest.mock('../components/own-flight-stats', () => ({ OwnFlightStats: () => null }));
jest.mock('../components/captured-aircraft', () => ({ CapturedAircraft: () => null }));
jest.mock('../components/metadata-sheet', () => ({ MetadataSheet: jest.fn(() => null) }));
jest.mock('../components/metadata-form', () => ({ MetadataForm: jest.fn(() => null) }));
jest.mock('../components/flight-actions-sheet', () => ({ FlightActionsSheet: jest.fn(() => null) }));
jest.mock('../components/flight-map-preview', () => ({ FlightMapPreview: () => null }));

const flight = {
  id: 'flight-123', recordingSessionId: 'session-123', status: 'completed', sessionStatus: 'completed',
  title: 'Ridge flight', site: null, notes: null, siteSource: null, createdAt: 0, updatedAt: 100,
  startedAt: 0, endedAt: 3_600_000, timezoneOffsetMinutes: 0,
  metrics: { durationMs: 3_600_000, trackDistanceMetres: 12_000, fixCount: 3600, quality: 'healthy' },
} as FlightDetail;
let rendered: ReturnType<typeof create>;
const refetch = jest.fn();
type Node = { props: Record<string, any> };
const buttons = () => rendered.root.findAllByType(Button).map((node: Node) => node.props);
const button = (label: string) => buttons().find((props: Record<string, any>) => props.label === label)!;
const form = () => rendered.root.findByType(MetadataForm).props;
const menu = () => rendered.root.findByType(FlightActionsSheet).props;
async function mount(overrides: Partial<FlightDetail> = {}) {
  jest.mocked(useGetFlightQuery).mockReturnValue({ data: { ...flight, ...overrides }, refetch } as unknown as ReturnType<typeof useGetFlightQuery>);
  await act(async () => { rendered = create(React.createElement(FlightDetailScreen)); });
}
async function openActions() { await act(async () => button('Flight actions').onPress()); }
async function editSummary() { await act(async () => form().onChange({ ...form().values, title: 'Evening ridge' })); }
beforeEach(() => {
  jest.clearAllMocks(); mockSaved = undefined; setFlightAuthIdentity(null);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, handler) => { mockHardwareBack = handler as () => boolean; return { remove: jest.fn() }; });
  mockUpdate.mockImplementation(async request => ({ ...flight, ...request.patch, updatedAt: 101 })); mockDelete.mockResolvedValue(null);
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); jest.restoreAllMocks(); });

it('distinguishes retryable reads from deleted flights', async () => {
  jest.mocked(useGetFlightQuery).mockReturnValue({ data: null, error: { message: 'database busy' }, refetch } as unknown as ReturnType<typeof useGetFlightQuery>);
  await act(async () => { rendered = create(React.createElement(FlightDetailScreen)); });
  expect(rendered.root.findByType(Notice).props).toMatchObject({ title: 'Could not open flight', children: 'database busy' });
  button('Try again').onPress(); expect(refetch).toHaveBeenCalledTimes(1);
});
it.each<Partial<FlightDetail>>([
  { status: 'recording', sessionStatus: 'recording', endedAt: null }, { status: 'recording', sessionStatus: 'interrupted', endedAt: null }, { status: 'processing' }, { metrics: null },
])('disables actions with reasons and never claims a saved summary for unfinished detail: %o', async overrides => {
  mockSaved = 'stopped'; await mount(overrides); await openActions();
  expect(rendered.root.findByType(OwnFlightHero).props.saved).toBe(false);
  expect(menu().actions.every((action: { reason: string }) => Boolean(action.reason))).toBe(true);
  expect(rendered.root.findByType(EvidenceBlock).props.exportDisabled).toBe(true);
});
it.each(['completed', 'partial'] as const)('opens replay for a %s flight', async status => {
  await mount({ status }); expect(button('Replay flight').disabled).toBe(false); button('Replay flight').onPress();
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/flights/[id]/replay', params: { id: flight.id } });
});
it('carries original metadata/target to save and treats commit as success even if sync scheduling fails', async () => {
  await mount(); await act(async () => button('Edit flight').onPress());
  const request = { ...flightMutationGuard(flight), original: storedFlightMetadata(flight), patch: { title: 'Evening ridge' } };
  mockUpdate.mockRejectedValueOnce({ message: 'disk full' });
  await act(async () => { await expect(rendered.root.findByType(MetadataSheet).props.onSave(request)).rejects.toEqual({ message: 'disk full' }); });
  expect(mockRequestSync).not.toHaveBeenCalled();
  mockRequestSync.mockImplementationOnce(() => { throw new Error('scheduler unavailable'); });
  await act(async () => rendered.root.findByType(MetadataSheet).props.onSave(request));
  expect(mockUpdate).toHaveBeenLastCalledWith(request); expect(mockRequestSync).toHaveBeenCalledWith('post-save');
});
it('keeps a verified archived original shareable after replacement download failure', async () => {
  await mount({ source: 'archive', ownerUserId: 'pilot', sessionStatus: null, session: null, archive: { trackState: 'error', error: 'Download interrupted', downloadedAt: 1000 } });
  await openActions(); const action = menu().actions.find((a: { label: string }) => a.label === 'Share original archived IGC');
  expect(action.reason).toBeNull(); await act(async () => action.onPress());
  expect(mockShareArchivedIgc).toHaveBeenCalledWith(flight.id, expect.any(Object));
  expect(rendered.root.findAllByType(Notice).some((node: Node) => node.props.title === 'Archive update waiting')).toBe(true);
});
it('allows editing a restored summary with missing metrics and disables unavailable exports', async () => {
  await mount({ source: 'archive', ownerUserId: 'pilot', sessionStatus: null, session: null, metrics: null, archive: { trackState: 'missing', error: null, downloadedAt: null } });
  expect(button('Edit flight').disabled).toBe(false); await openActions();
  expect(menu().actions.find((a: { label: string }) => a.label === 'Delete flight').reason).toBeNull();
  expect(menu().actions.find((a: { label: string }) => a.label.includes('IGC')).reason).toContain('not been downloaded');
});
it('consumes saved parameters, saves quick edits on Done, and leaves ordinary reopening as detail', async () => {
  mockSaved = 'stopped'; await mount(); expect(rendered.root.findByType(OwnFlightHero).props.saved).toBe(true);
  expect(mockRouter.setParams).toHaveBeenCalledWith({ saved: undefined });
  await editSummary(); await act(async () => button('Done').onPress());
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: { title: 'Evening ridge' } }));
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  await act(async () => rendered.unmount()); mockSaved = undefined; await mount();
  expect(rendered.root.findByType(OwnFlightHero).props.saved).toBe(false);
});
it.each(['Close', 'Back'])('%s protects dirty quick edits; discard does not delete', async via => {
  mockSaved = 'partial'; await mount({ status: 'partial' }); await editSummary();
  await act(async () => { if (via === 'Back') mockHardwareBack(); else rendered.root.findByType(TopBar).props.onBack(); });
  expect(mockRouter.replace).not.toHaveBeenCalled();
  jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === 'Discard')!.onPress!();
  expect(mockRouter.replace).toHaveBeenCalledWith('/'); expect(mockDelete).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
});
it('retains quick drafts on save failure and requires separate sharing continuation after successful save', async () => {
  mockSaved = 'stopped'; await mount(); await editSummary();
  const proceed = jest.fn(); rendered.root.findByType(FlightSharingSection).props.beforeOpen(proceed);
  expect(proceed).not.toHaveBeenCalled(); mockUpdate.mockRejectedValueOnce(new Error('disk full'));
  await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === 'Save details and continue')!.onPress!());
  expect(form().values.title).toBe('Evening ridge'); expect(proceed).not.toHaveBeenCalled();
  rendered.root.findByType(FlightSharingSection).props.beforeOpen(proceed);
  await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === 'Save details and continue')!.onPress!());
  expect(proceed).toHaveBeenCalledTimes(1);
});
it('invalidates sheets and old delete confirmations when identity changes away and back', async () => {
  await mount(); await openActions(); await act(async () => menu().actions.find((a: { label: string }) => a.label === 'Delete flight').onPress());
  const confirm = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === 'Delete permanently')!.onPress!;
  await act(async () => { setFlightAuthIdentity('another'); setFlightAuthIdentity(null); });
  await act(async () => confirm()); expect(mockDelete).not.toHaveBeenCalled();
  expect(rendered.root.findAllByType(FlightActionsSheet)).toHaveLength(0);
});
it('guards duplicate deletion and preserves draft on a transaction failure', async () => {
  await mount(); await act(async () => button('Edit flight').onPress());
  await act(async () => rendered.root.findByType(MetadataSheet).props.onDelete());
  const confirm = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === 'Delete permanently')!.onPress!;
  let reject!: (error: Error) => void; mockDelete.mockReturnValue(new Promise((_r, fail) => { reject = fail; }));
  await act(async () => { confirm(); confirm(); }); expect(mockDelete).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('disk full')));
  expect(rendered.root.findByType(MetadataSheet).props.actionError).toBe('disk full'); expect(mockRouter.replace).not.toHaveBeenCalled();
});

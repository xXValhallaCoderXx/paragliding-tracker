import React from 'react';
import FlightDetailScreen from '@/app/flights/[id]';
import { Button, Notice } from '@/components/ui';
import { EvidenceBlock } from '../components/evidence';
import { MetadataSheet } from '../components/metadata-sheet';
import type { FlightDetail, FlightMetadataPatch } from '@/recorder/types';
import { useGetFlightQuery, useUpdateFlightMutation } from '@/store/endpoints';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve the renderer bundled with jest-expo
const { create, act } = require(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
const mockPush = jest.fn();
const mockRequestSync = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'flight-123' }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => ({ status: 'signed_out' }) }));
jest.mock('@/features/account/cloud-sync-provider', () => ({ useCloudSync: () => ({ requestSync: mockRequestSync }) }));
jest.mock('@/recorder/recorder-service', () => ({ recorderService: {} }));
jest.mock('@/store/endpoints', () => ({
  useGetFlightQuery: jest.fn(),
  useGetFlightTrackQuery: () => ({ data: [] }),
  useGetFlightsQuery: () => ({ data: [] }),
  useUpdateFlightMutation: jest.fn(),
  useDeleteFlightMutation: () => [jest.fn()],
}));
jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), Notice: jest.fn(() => null),
  TopBar: () => null, BusyRow: () => null, LoadingScreen: () => null, SectionLabel: () => null,
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('../components/evidence', () => ({ EvidenceBlock: jest.fn(() => null) }));
jest.mock('../components/hero', () => ({ FlightHero: () => null }));
jest.mock('../components/metadata-sheet', () => ({ MetadataSheet: jest.fn(() => null) }));
jest.mock('../components/stat-grid', () => ({ StatGrid: () => null }));
jest.mock('../components/track-plate', () => ({ TrackPlate: () => null }));

const flight = {
  id: 'flight-123', recordingSessionId: 'session-123', status: 'completed', sessionStatus: 'completed',
  title: 'Ridge flight', site: null, notes: null, siteSource: null,
  startedAt: 0, endedAt: 3_600_000, timezoneOffsetMinutes: 0,
  metrics: { durationMs: 3_600_000, trackDistanceMetres: 12_000, fixCount: 3600, quality: 'healthy' },
} as FlightDetail;
let rendered: { unmount: () => void };
const refetch = jest.fn();
const unwrap = jest.fn();
const updateFlight = jest.fn();
const buttons = () => jest.mocked(Button).mock.calls.map(([props]) => props);
async function render(overrides: Partial<FlightDetail> = {}) {
  jest.mocked(useGetFlightQuery).mockReturnValue({ data: { ...flight, ...overrides }, refetch } as unknown as ReturnType<typeof useGetFlightQuery>);
  await act(async () => { rendered = create(React.createElement(FlightDetailScreen)); });
}
beforeEach(() => {
  jest.clearAllMocks();
  unwrap.mockResolvedValue(flight);
  updateFlight.mockReturnValue({ unwrap });
  jest.mocked(useUpdateFlightMutation).mockReturnValue([updateFlight, {}] as unknown as ReturnType<typeof useUpdateFlightMutation>);
});
afterEach(async () => { await act(async () => rendered.unmount()); });

it('shows a retriable read failure instead of claiming the flight was deleted', async () => {
  jest.mocked(useGetFlightQuery).mockReturnValue({ data: null, error: { message: 'database busy' }, refetch } as unknown as ReturnType<typeof useGetFlightQuery>);
  await act(async () => { rendered = create(React.createElement(FlightDetailScreen)); });
  expect(jest.mocked(Notice).mock.calls.at(-1)![0]).toMatchObject({ title: 'Could not open flight', children: 'database busy' });
  buttons().find((button) => button.label === 'Try again')!.onPress();
  expect(refetch).toHaveBeenCalledTimes(1);
});

it.each<Partial<FlightDetail>>([
  { status: 'recording', sessionStatus: 'recording', endedAt: null },
  { status: 'recording', sessionStatus: 'interrupted', endedAt: null },
  { status: 'processing' },
  { metrics: null },
])('keeps replay, export and deletion unavailable for unfinished details: %o', async (overrides) => {
  await render(overrides);
  expect(buttons().some((button) => button.label === 'Replay flight')).toBe(false);
  expect(buttons().find((button) => button.accessibilityHint?.includes('unsigned IGC file'))!.disabled).toBe(true);
  expect(buttons().find((button) => /delete/i.test(button.label))!.disabled).toBe(true);
  expect(jest.mocked(EvidenceBlock).mock.calls.at(-1)![0].exportDisabled).toBe(true);
});

it.each(['completed', 'partial'] as const)('opens replay for a %s flight', async (status) => {
  await render({ status });
  const replay = buttons().find((button) => button.label === 'Replay flight')!;
  expect(replay.variant).toBe('primary');
  expect(replay.disabled).toBe(false);
  replay.onPress();
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/flights/[id]/replay', params: { id: 'flight-123' } });
});

it('routes metadata edits through the existing mutation and requests backup only after success', async () => {
  await render();
  await act(async () => buttons().find((button) => button.label === 'Edit flight')!.onPress());
  const patch: FlightMetadataPatch = { title: 'Evening ridge' };
  const save = jest.mocked(MetadataSheet).mock.calls.at(-1)![0].onSave;
  unwrap.mockRejectedValueOnce({ message: 'disk full' });
  await expect(save(patch)).rejects.toEqual({ message: 'disk full' });
  expect(mockRequestSync).not.toHaveBeenCalled();
  await act(async () => save(patch));
  expect(updateFlight).toHaveBeenLastCalledWith({ flightId: 'flight-123', patch });
  expect(mockRequestSync).toHaveBeenCalledWith('post-save');
});

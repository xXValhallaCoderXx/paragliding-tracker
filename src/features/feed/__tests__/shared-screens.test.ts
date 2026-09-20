import React from 'react';
import { Button, Notice } from '@/components/ui';
import { FlightHero } from '@/features/flights/components/hero';
import { FlightMapPreview } from '@/features/flights/components/flight-map-preview';
import { ReplayPlayer } from '@/features/flights/replay/replay-player';
import SharedDetailScreen from '../shared-detail-screen';
import SharedReplayScreen from '../shared-replay-screen';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext, friendsContext, replayArtifact, sharedFlight } from './fixtures';

let mockFeed = feedContext();
let mockFriends = friendsContext();
let mockFocused = true;
let mockLifecycle = { ready: true, recovering: false };
const mockPush = jest.fn();
const mockDismiss = jest.fn();
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('@/features/record/recorder-lifecycle', () => ({ useRecorderLifecycle: () => mockLifecycle }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'activity-1' }), useIsFocused: () => mockFocused,
  useRouter: () => ({ push: mockPush, dismissTo: mockDismiss, canGoBack: () => true, back: jest.fn() }),
  Stack: { Screen: () => null },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/components/ui', () => Object.fromEntries(['Avatar', 'BusyRow', 'Button', 'Notice', 'Screen', 'TopBar']
  .map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
jest.mock('@/features/flights/components/hero', () => ({ FlightHero: () => null }));
jest.mock('@/features/flights/components/stat-grid', () => ({ StatGrid: () => null }));
jest.mock('@/features/flights/components/flight-map-preview', () => ({ FlightMapPreview: () => null }));
jest.mock('@/features/flights/replay/replay-player', () => ({ ReplayPlayer: () => null }));

let rendered: ReturnType<typeof create>;
type Node = { props: Record<string, any> };
const control = (label: string) => (rendered.root.findAllByType(Button) as Node[]).find(node => node.props.label === label)!;
const run = async (operation: () => unknown) => { await act(async () => { await operation(); }); };
const mount = (element: React.ReactElement) => run(() => { rendered = create(element); });
const update = (element: React.ReactElement) => run(() => rendered.update(element));
beforeEach(() => { jest.clearAllMocks(); mockFeed = feedContext(); mockFriends = friendsContext(); mockFocused = true; mockLifecycle = { ready: true, recovering: false }; });
afterEach(async () => { if (rendered) await run(() => rendered.unmount()); });

it('opens a safe shared detail, disables map caching, and exposes no owner-only action', async () => {
  await mount(React.createElement(SharedDetailScreen));
  expect(mockFeed.getDetail).toHaveBeenCalledWith('activity-1');
  expect(rendered.root.findByType(FlightHero).props).toMatchObject({ saved: null, insight: null, flight: { source: 'shared' } });
  expect(rendered.root.findByType(FlightMapPreview).props.cachePolicy).toBe('none');
  expect((rendered.root.findAllByType(Button) as Node[]).map(node => node.props.label)).toEqual(['View pilot profile', 'Replay shared flight']);
  await run(() => control('Replay shared flight').props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/shared-flights/[id]/replay', params: { id: 'activity-1' } });
});

it('keeps a no-track summary visible without attempting replay', async () => {
  jest.mocked(mockFeed.getDetail).mockResolvedValue(sharedFlight({ replayAvailable: false, routePreview: [],
    metrics: { ...sharedFlight().metrics, fixCount: 0, quality: 'no_track' } }));
  await mount(React.createElement(SharedDetailScreen));
  expect(rendered.root.findAllByType(FlightHero)).toHaveLength(1);
  expect(control('Replay shared flight')).toBeUndefined();
  expect(mockFeed.getReplay).not.toHaveBeenCalled();
  expect((rendered.root.findAllByType(Notice) as Node[]).some(node => node.props.title === 'No usable GPS track')).toBe(true);
});

it('removes an already displayed detail immediately on offline, blur, and sign-out', async () => {
  await mount(React.createElement(SharedDetailScreen));
  mockFeed.available = false;
  await update(React.createElement(SharedDetailScreen));
  expect(rendered.root.findAllByType(FlightHero)).toHaveLength(0);
  mockFeed.available = true; mockFocused = false;
  await update(React.createElement(SharedDetailScreen));
  expect(rendered.root.findAllByType(FlightHero)).toHaveLength(0);
  mockFocused = true; mockFriends.status = 'signed_out';
  await update(React.createElement(SharedDetailScreen));
  expect(rendered.root.findAllByType(FlightHero)).toHaveLength(0);
  expect(control('Open Account')).toBeDefined();
});

it('ignores late detail responses after the permission revision changes', async () => {
  let resolveOld!: (flight: ReturnType<typeof sharedFlight>) => void;
  jest.mocked(mockFeed.getDetail).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockRejectedValueOnce(new Error('This shared flight is unavailable.'));
  await mount(React.createElement(SharedDetailScreen));
  mockFeed.revision += 1;
  await update(React.createElement(SharedDetailScreen));
  await run(() => resolveOld(sharedFlight()));
  expect(rendered.root.findAllByType(FlightHero)).toHaveLength(0);
  expect(rendered.root.findByType(Notice).props.children).toBe('This shared flight is unavailable.');
});

it('reads a fresh detail manifest before replay and preserves IGC timing and absent speed', async () => {
  const artifact = replayArtifact({ provenance: 'igc', points: replayArtifact().points.map(point => ({ ...point, speed: null })) });
  jest.mocked(mockFeed.getReplay).mockResolvedValue(artifact);
  await mount(React.createElement(SharedReplayScreen));
  expect(mockFeed.getReplay).toHaveBeenCalledWith('activity-1', sharedFlight().artifact);
  const replay = rendered.root.findByType(ReplayPlayer).props.replay;
  expect(replay.bounds).toEqual(artifact.bounds);
  expect(replay.points).toEqual(artifact.points);
  expect(replay.source).toBeUndefined();
});

it('never fetches replay bytes when the authorized detail has no usable replay', async () => {
  jest.mocked(mockFeed.getDetail).mockResolvedValue(sharedFlight({ replayAvailable: false }));
  await mount(React.createElement(SharedReplayScreen));
  expect(mockFeed.getReplay).not.toHaveBeenCalled();
  expect(rendered.root.findAllByType(ReplayPlayer)).toHaveLength(0);
  expect(control('Back to shared flight')).toBeDefined();
});

it('releases replay and refuses a late download when recording starts', async () => {
  let resolveReplay!: (artifact: ReturnType<typeof replayArtifact>) => void;
  jest.mocked(mockFeed.getReplay).mockImplementation(() => new Promise(resolve => { resolveReplay = resolve; }));
  await mount(React.createElement(SharedReplayScreen));
  mockFeed.recorderBusy = true;
  await update(React.createElement(SharedReplayScreen));
  await run(() => resolveReplay(replayArtifact()));
  expect(rendered.root.findAllByType(ReplayPlayer)).toHaveLength(0);
  expect(rendered.root.findByType(Notice).props.title).toBe('Recording comes first');
});

it('gates replay during recorder recovery and disables the detail action while recording', async () => {
  mockLifecycle.recovering = true;
  await mount(React.createElement(SharedReplayScreen));
  expect(mockFeed.getDetail).not.toHaveBeenCalled();
  mockFeed.recorderBusy = true;
  await update(React.createElement(SharedDetailScreen));
  expect(control('Replay shared flight').props.disabled).toBe(true);
});

it('clears replay after account switch and does not reveal a late response to the new owner', async () => {
  let resolveReplay!: (artifact: ReturnType<typeof replayArtifact>) => void;
  jest.mocked(mockFeed.getReplay).mockImplementation(() => new Promise(resolve => { resolveReplay = resolve; }));
  await mount(React.createElement(SharedReplayScreen));
  mockFriends.identityKey = 'owner-b';
  await update(React.createElement(SharedReplayScreen));
  await run(() => resolveReplay(replayArtifact()));
  expect(rendered.root.findAllByType(ReplayPlayer)).toHaveLength(0);
});

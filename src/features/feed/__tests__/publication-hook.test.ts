import React from 'react';
import type { AuthSnapshot } from '@/cloud/types';
import type { FlightPublicationView } from '@/social/feed-types';
import { useFlightPublication } from '../use-flight-publication';
import { create, act } from '../../../../tests/support/renderer';
import { feedContext } from './fixtures';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let mockAuth: AuthSnapshot;
let mockFeed = feedContext();
let mockFocused = true;
let mockFlightId = 'flight-1';
const mockListeners = new Set<() => void>();
const mockGetView = jest.fn();
const mockShare = jest.fn();
const mockHide = jest.fn();
const mockRetry = jest.fn();
const mockDirectRemote = jest.fn();
jest.mock('@/cloud/auth-service', () => ({ cloudAuthService: { getSnapshot: () => mockAuth } }));
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('../feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('@/social/feed-api', () => ({ feedService: { getPublication: (...args: unknown[]) => mockDirectRemote(...args) } }));
jest.mock('@/cloud/publication-service', () => ({ publicationService: {
  getView: (...args: unknown[]) => mockGetView(...args), share: (...args: unknown[]) => mockShare(...args),
  hide: (...args: unknown[]) => mockHide(...args), retry: (...args: unknown[]) => mockRetry(...args),
  subscribe: (listener: () => void) => { mockListeners.add(listener); return () => { mockListeners.delete(listener); }; },
} }));
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));

const localView = (patch: Record<string, unknown> = {}) => ({ state: 'private', activityId: null, error: null, hasLocalOverride: false, pendingHide: false, ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let latest: FlightPublicationView;
let snapshots: FlightPublicationView[];
function Harness() {
  const result = useFlightPublication(mockFlightId);
  React.useLayoutEffect(() => { latest = result; snapshots.push(result); });
  return null;
}
let rendered: ReturnType<typeof create> | undefined;
async function render() { await act(async () => { if (rendered) rendered.update(React.createElement(Harness)); else rendered = create(React.createElement(Harness)); }); }
async function run(operation: () => unknown) { await act(async () => { await operation(); }); }
beforeEach(() => {
  jest.clearAllMocks(); rendered = undefined; snapshots = []; mockListeners.clear(); mockFocused = true; mockFlightId = 'flight-1';
  mockAuth = { status: 'signed_in', userId: A, email: 'a@example.test', lastError: null };
  mockFeed = feedContext({ identityKey: A });
  mockGetView.mockReset().mockResolvedValue(localView());
  mockShare.mockReset().mockResolvedValue(undefined); mockHide.mockReset().mockResolvedValue(undefined); mockRetry.mockReset().mockResolvedValue(undefined);
  mockDirectRemote.mockReset().mockResolvedValue({ flightId: 'flight-1', activityId: null, state: 'private', revision: 0 });
});
afterEach(async () => { if (rendered) await run(() => rendered!.unmount()); });

it('keeps its first status busy until local and authorized remote reads finish', async () => {
  const local = deferred<ReturnType<typeof localView>>();
  const remote = deferred<{ flightId: string; activityId: string; state: 'shared'; revision: number }>();
  mockGetView.mockReturnValueOnce(local.promise);
  jest.mocked(mockFeed.getPublication).mockReturnValueOnce(remote.promise);
  await render();
  expect(latest.busy).toBe(true);
  expect(mockFeed.getPublication).not.toHaveBeenCalled();
  await run(() => local.resolve(localView()));
  expect(latest.busy).toBe(true);
  await run(() => remote.resolve({ flightId: 'flight-1', activityId: 'post-1', state: 'shared', revision: 1 }));
  expect(latest).toMatchObject({ busy: false, state: 'shared', activityId: 'post-1' });
  expect(snapshots.filter(value => !value.busy).every(value => value.state === 'shared')).toBe(true);
  expect(mockDirectRemote).not.toHaveBeenCalled();
});

it.each(['offline', 'failed_remote'] as const)('keeps an unknown status distinct from a publication error or a confirmed private flight: %s', async kind => {
  if (kind === 'offline') mockFeed.available = false;
  else jest.mocked(mockFeed.getPublication).mockRejectedValue(new Error('Service unavailable'));
  await render();
  expect(latest).toMatchObject({ state: 'unknown', busy: false });
  expect(latest.error).toBeTruthy();
  expect(snapshots.some(value => !value.busy && value.state === 'private')).toBe(false);
});

it('ignores an old subscription notification after auth changes without an unhandled rejection', async () => {
  await render();
  const listener = [...mockListeners][0]!;
  mockGetView.mockClear(); jest.mocked(mockFeed.getPublication).mockClear();
  mockAuth = { ...mockAuth, status: 'signed_out', userId: null };
  // Fire before React can replace the old callback; Jest fails on an unhandled rejection.
  await run(() => listener());
  expect(mockGetView).not.toHaveBeenCalled();
  expect(mockFeed.getPublication).not.toHaveBeenCalled();
  await render();
  expect(latest.available).toBe(false);
});

it.each(['blur', 'offline', 'background'] as const)('does not restart network reads when a mutation finishes after %s', async reason => {
  await render();
  const completion = deferred<void>();
  mockShare.mockReturnValueOnce(completion.promise);
  let sharing!: Promise<void>;
  await run(() => { sharing = latest.share(); });
  const settled = sharing.then(() => undefined, () => undefined);
  if (reason === 'blur') mockFocused = false;
  else mockFeed = { ...mockFeed, available: false, revision: mockFeed.revision + 1 };
  await render();
  const remoteCalls = jest.mocked(mockFeed.getPublication).mock.calls.length;
  const refreshCalls = jest.mocked(mockFeed.refresh).mock.calls.length;
  await run(async () => { completion.resolve(); await settled; });
  expect(mockFeed.getPublication).toHaveBeenCalledTimes(remoteCalls);
  expect(mockFeed.refresh).toHaveBeenCalledTimes(refreshCalls);
  expect(mockDirectRemote).not.toHaveBeenCalled();
});

it('persists an offline hide and keeps pending confirmation visible without network access', async () => {
  mockFeed.available = false;
  mockGetView.mockResolvedValue(localView({ state: 'shared', activityId: 'post-1' }));
  mockHide.mockImplementation(async () => {
    mockGetView.mockResolvedValue(localView({ state: 'pending', activityId: 'post-1', hasLocalOverride: true, pendingHide: true }));
    for (const listener of mockListeners) listener();
  });
  await render();
  await run(() => latest.hide());
  expect(mockHide).toHaveBeenCalledWith(A, 'flight-1');
  expect(latest).toMatchObject({ state: 'pending', pendingHide: true, online: false, available: true, busy: false });
  expect(mockFeed.getPublication).not.toHaveBeenCalled();
  expect(mockFeed.refresh).not.toHaveBeenCalled();
  await run(() => rendered!.unmount()); rendered = undefined;
  await render();
  expect(latest.pendingHide).toBe(true);
});

it('preserves a durable hide over a stale remote shared status when reconnecting', async () => {
  mockGetView.mockResolvedValue(localView({ state: 'pending', hasLocalOverride: true, pendingHide: true, activityId: 'post-1' }));
  jest.mocked(mockFeed.getPublication).mockResolvedValue({ flightId: 'flight-1', activityId: 'post-1', state: 'shared', revision: 3 });
  await render();
  expect(latest).toMatchObject({ state: 'pending', pendingHide: true });
});

it('ignores a late old-flight read and releases subscriptions on unmount', async () => {
  const old = deferred<ReturnType<typeof localView>>();
  mockGetView.mockReturnValueOnce(old.promise);
  await render();
  mockFlightId = 'flight-2';
  jest.mocked(mockFeed.getPublication).mockResolvedValue({ flightId: 'flight-2', activityId: null, state: 'private', revision: 0 });
  await render();
  await run(() => old.resolve(localView({ state: 'shared', activityId: 'old-post' })));
  expect(latest.activityId).toBeNull();
  expect(latest.busy).toBe(false);
  await run(() => rendered!.unmount()); rendered = undefined;
  expect(mockListeners.size).toBe(0);
});

it('rejects an old account confirmation before writing a durable intent', async () => {
  await render();
  const old = latest;
  mockAuth = { ...mockAuth, userId: B };
  mockFeed = feedContext({ identityKey: B });
  await render();
  await expect(old.hide()).rejects.toMatchObject({ code: 'stale' });
  expect(mockHide).not.toHaveBeenCalled();
});

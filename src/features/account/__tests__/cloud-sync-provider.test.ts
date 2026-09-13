import React from 'react';
import { AppState } from 'react-native';

import type { AuthSnapshot, SyncSnapshot } from '@/cloud/types';
import { act, create } from '../../../../tests/support/renderer';
import { CloudSyncProvider, useCloudSync } from '../cloud-sync-provider';

jest.mock('@/cloud/config', () => ({ cloudConfigured: true }));
let mockAuth: AuthSnapshot;
let mockRecorder: { ready: boolean; recovering: boolean; recoveryError: null };
jest.mock('../auth-provider', () => ({ useCloudAuth: () => mockAuth }));
jest.mock('@/features/record/recorder-lifecycle', () => ({ useRecorderLifecycle: () => mockRecorder }));

let mockSnapshot: SyncSnapshot;
const mockListeners = new Set<(snapshot: SyncSnapshot) => void>();
const mockRequestSync = jest.fn();
jest.mock('@/cloud/sync-engine', () => ({
  cloudSyncEngine: {
    getSnapshot: () => mockSnapshot,
    subscribe: (listener: (snapshot: SyncSnapshot) => void) => {
      mockListeners.add(listener);
      listener(mockSnapshot);
      return () => mockListeners.delete(listener);
    },
    requestSync: (...args: unknown[]) => mockRequestSync(...args),
  },
}));

let observed: ReturnType<typeof useCloudSync>;
function Observer() {
  const value = useCloudSync();
  React.useEffect(() => { observed = value; }, [value]);
  return null;
}
const tree = () => React.createElement(CloudSyncProvider, null, React.createElement(Observer));
let rendered: { update: (element: React.ReactElement) => void; unmount: () => void } | null;
async function render() {
  await act(async () => {
    if (rendered) rendered.update(tree());
    else rendered = create(tree());
  });
}
function publish(patch: Partial<SyncSnapshot>) {
  mockSnapshot = { ...mockSnapshot, ...patch };
  for (const listener of mockListeners) listener(mockSnapshot);
  return mockSnapshot;
}
function pendingCycle() {
  let resolve!: (snapshot: SyncSnapshot) => void;
  const promise = new Promise<SyncSnapshot>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  rendered = null;
  mockListeners.clear();
  mockAuth = { status: 'signed_in', userId: 'pilot', email: 'pilot@example.test', lastError: null };
  mockRecorder = { ready: false, recovering: false, recoveryError: null };
  mockSnapshot = {
    phase: 'blocked', blockedBy: 'recovering', lastSyncAt: null,
    pendingFlights: 1, pendingDeletions: 0, cloudOnlyFlights: 0,
    linkedUserId: 'pilot', lastError: null,
  };
  mockRequestSync.mockReset().mockImplementation(async () => publish({
    phase: 'idle', blockedBy: null, pendingFlights: 0, lastSyncAt: 1000,
  }));
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(async () => {
  if (rendered) await act(async () => rendered?.unmount());
  jest.restoreAllMocks();
});

it('starts backup when cold-launch recovery finishes and keeps the request callback stable', async () => {
  await render();
  const request = observed.requestSync;
  expect(mockRequestSync).not.toHaveBeenCalled();
  mockRecorder = { ...mockRecorder, recovering: true };
  await render();
  expect(mockRequestSync).not.toHaveBeenCalled();

  mockRecorder = { ...mockRecorder, ready: true, recovering: false };
  await render();

  expect(mockRequestSync).toHaveBeenCalledTimes(1);
  expect(mockRequestSync).toHaveBeenCalledWith('post-sign-in', { recorderRecovering: false });
  expect(observed).toMatchObject({ phase: 'idle', pendingFlights: 0, lastSyncAt: 1000 });
  expect(observed.requestSync).toBe(request);
  await render();
  expect(mockRequestSync).toHaveBeenCalledTimes(1);
});

it('retries after a completed recovery request joins an older blocked cycle', async () => {
  const blocked = pendingCycle();
  mockRequestSync.mockReturnValueOnce(blocked.promise).mockReturnValueOnce(blocked.promise);
  mockRecorder = { ready: true, recovering: true, recoveryError: null };
  await render();
  await act(async () => observed.requestSync('foreground'));
  expect(mockRequestSync).toHaveBeenLastCalledWith('foreground', { recorderRecovering: true });

  mockRecorder = { ...mockRecorder, recovering: false };
  await render();
  expect(mockRequestSync).toHaveBeenCalledTimes(2);
  expect(observed.phase).toBe('blocked');

  await act(async () => blocked.resolve(mockSnapshot));

  expect(mockRequestSync).toHaveBeenCalledTimes(3);
  expect(mockRequestSync).toHaveBeenLastCalledWith('post-sign-in', { recorderRecovering: false });
  expect(observed).toMatchObject({ phase: 'idle', blockedBy: null, pendingFlights: 0 });
});

it.each(['sign-out', 'recovery', 'unmount'] as const)(
  'cancels the follow-up when %s occurs before the older cycle settles',
  async (change) => {
    const blocked = pendingCycle();
    mockRequestSync.mockReturnValueOnce(blocked.promise);
    mockRecorder = { ready: true, recovering: false, recoveryError: null };
    await render();
    expect(mockRequestSync).toHaveBeenCalledTimes(1);

    if (change === 'sign-out') {
      mockAuth = { ...mockAuth, status: 'signed_out', userId: null, email: null };
      await render();
    } else if (change === 'recovery') {
      mockRecorder = { ...mockRecorder, recovering: true };
      await render();
    } else {
      await act(async () => rendered?.unmount());
      rendered = null;
    }
    await act(async () => blocked.resolve(mockSnapshot));
    expect(mockRequestSync).toHaveBeenCalledTimes(1);
  },
);

it('does not start a backup for a signed-out pilot when recovery finishes', async () => {
  mockAuth = { ...mockAuth, status: 'signed_out', userId: null, email: null };
  mockRecorder.recovering = true;
  await render();
  mockRecorder = { ...mockRecorder, ready: true, recovering: false };
  await render();
  expect(mockRequestSync).not.toHaveBeenCalled();
});

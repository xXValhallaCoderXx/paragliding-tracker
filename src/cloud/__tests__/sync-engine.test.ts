import { flight, metrics, profile } from '../../../tests/support/fixtures';
import type { FlightSyncCandidate } from '@/recorder/types';
import type { CloudSyncEngine } from '../types';

jest.mock('../config', () => ({ ...jest.requireActual('../config'), cloudConfigured: true }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: async () => 'synthetic-igc-digest',
}));
jest.mock('@/recorder/igc', () => ({ buildUnsignedIgc: () => ({ content: 'synthetic IGC' }) }));

let mockRepository: Record<string, jest.Mock>;
jest.mock('@/recorder/database.native', () => mockRepository);

const mockSignOut = jest.fn();
jest.mock('../auth-service', () => ({
  cloudAuthService: {
    getSnapshot: () => ({ status: 'signed_in', userId: 'pilot' }),
    signOut: () => mockSignOut(),
  },
}));

interface Request {
  table: string;
  operation: string;
  body?: Record<string, unknown>;
  filters: Record<string, unknown>;
}
const mockRequest = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
jest.mock('../supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const request: Request = { table, operation: 'select', filters: {} };
      const query = {
        upsert: (body: Record<string, unknown>) => { request.operation = 'upsert'; request.body = body; return query; },
        update: (body: Record<string, unknown>) => { request.operation = 'update'; request.body = body; return query; },
        delete: () => { request.operation = 'delete'; return query; },
        select: () => query,
        eq: (column: string, value: unknown) => { request.filters[column] = value; return query; },
        order: () => query,
        limit: () => query,
        gt: () => query,
        single: () => query,
        maybeSingle: () => query,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(mockRequest(request)).then(resolve, reject),
      };
      return query;
    },
    storage: { from: () => ({ upload: mockUpload, remove: mockRemove }) },
  }),
}));

const NOW = 100_000;
let engine: CloudSyncEngine;
const candidate = (id: string, withTrack = false): FlightSyncCandidate => ({
  ...flight({ id, recordingSessionId: `${id}-session` }),
  metrics: withTrack ? metrics({ flightId: id }) : null,
  pushedUpdatedAt: null,
  igcSha256: null,
  igcObjectPath: null,
  attemptCount: 0,
  nextAttemptAt: 0,
});

function successfulRequest(request: Request) {
  return {
    data: request.operation === 'upsert' ? { updated_at: '2026-09-13T00:00:00Z' }
      : request.table === 'flights' && request.operation === 'select' ? [] : null,
    error: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  mockRequest.mockReset().mockImplementation(successfulRequest);
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRemove.mockReset().mockResolvedValue({ error: null });
  mockSignOut.mockReset().mockResolvedValue(undefined);
  const link = { userId: 'pilot', lastSyncAt: null, lastSyncError: null, flightsCursor: null };
  mockRepository = {
    getCloudLink: jest.fn().mockResolvedValue(link),
    getUnfinishedSession: jest.fn().mockResolvedValue(null),
    getPilotProfile: jest.fn().mockResolvedValue(profile({ updatedAt: 1000, pushedUpdatedAt: 1000 })),
    listDirtyFlights: jest.fn().mockResolvedValue([]),
    listPendingFlightDeletions: jest.fn().mockResolvedValue([]),
    countPendingSync: jest.fn().mockResolvedValue({ flights: 0, deletions: 0 }),
    setCloudCursors: jest.fn(async (patch) => { Object.assign(link, patch); }),
    markPilotProfilePushed: jest.fn().mockResolvedValue(undefined),
    markFlightPushed: jest.fn().mockResolvedValue(undefined),
    markFlightIgcPushed: jest.fn().mockResolvedValue(undefined),
    recordFlightSyncFailure: jest.fn().mockResolvedValue(undefined),
    recordFlightDeletionFailure: jest.fn().mockResolvedValue(undefined),
    clearFlightDeletion: jest.fn().mockResolvedValue(undefined),
    getSessionExportData: jest.fn().mockResolvedValue({ session: {}, locations: [] }),
  };
  jest.isolateModules(() => {
    engine = jest.requireActual('../sync-engine.native').cloudSyncEngine;
  });
});

afterEach(() => jest.restoreAllMocks());

it('restores the last backup time before throttling a cold-launch sync', async () => {
  mockRepository.getCloudLink.mockResolvedValue({
    userId: 'pilot', lastSyncAt: NOW - 1000, lastSyncError: null, flightsCursor: null,
  });

  await expect(engine.requestSync('foreground')).resolves.toMatchObject({
    phase: 'blocked', blockedBy: 'throttled', lastSyncAt: NOW - 1000,
  });
  expect(mockRequest).not.toHaveBeenCalled();
});

it('surfaces a plain server error and retries immediately when the pilot taps Sync now', async () => {
  mockRepository.getPilotProfile.mockResolvedValue(profile({ updatedAt: 1000, pushedUpdatedAt: null }));
  mockRequest.mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: 'Profile column is unavailable' } });
  await expect(engine.requestSync('post-sign-in')).resolves.toMatchObject({
    phase: 'error', lastError: 'Profile column is unavailable', lastSyncAt: null,
  });
  await expect(engine.requestSync('foreground')).resolves.toMatchObject({
    phase: 'blocked', blockedBy: 'backoff',
  });
  expect(mockRequest).toHaveBeenCalledTimes(1);

  await expect(engine.requestSync('manual')).resolves.toMatchObject({
    phase: 'idle', blockedBy: null, lastError: null, lastSyncAt: NOW,
  });
  expect(mockRepository.markPilotProfilePushed).toHaveBeenCalledWith(1000);
  expect(mockRepository.listDirtyFlights).toHaveBeenLastCalledWith(25, NOW, { ignoreBackoff: true });
  expect(mockRepository.listPendingFlightDeletions).toHaveBeenLastCalledWith(25, NOW, { ignoreBackoff: true });
});

it('continues independent rows while reporting failed deletions and flight uploads', async () => {
  mockRepository.listPendingFlightDeletions.mockResolvedValue([
    { flightId: 'bad-deletion', attemptCount: 0 },
    { flightId: 'good-deletion', attemptCount: 0 },
  ]);
  mockRepository.listDirtyFlights.mockResolvedValue([candidate('bad-flight'), candidate('good-flight')]);
  mockRemove.mockResolvedValueOnce({ error: { message: 'Deletion upload failed' } });
  mockRequest.mockImplementation((request: Request) => request.body?.id === 'bad-flight'
    ? { data: null, error: { message: 'Flight upload failed' } } : successfulRequest(request));

  await expect(engine.requestSync('manual')).resolves.toMatchObject({
    phase: 'error', lastError: 'Deletion upload failed', lastSyncAt: null,
  });

  expect(mockRepository.recordFlightDeletionFailure).toHaveBeenCalledWith('bad-deletion', 'Deletion upload failed', NOW + 30_000);
  expect(mockRepository.clearFlightDeletion).toHaveBeenCalledWith('good-deletion');
  expect(mockRepository.recordFlightSyncFailure).toHaveBeenCalledWith('bad-flight', 'Flight upload failed', NOW + 30_000);
  expect(mockRepository.markFlightPushed).toHaveBeenCalledTimes(1);
  expect(mockRepository.markFlightPushed).toHaveBeenCalledWith(expect.objectContaining({ flightId: 'good-flight' }));
  expect(mockRepository.setCloudCursors).not.toHaveBeenCalledWith(expect.objectContaining({ lastSyncAt: expect.anything() }));
});

it('acknowledges a flight only after its IGC upload succeeds on retry', async () => {
  mockRepository.listDirtyFlights.mockResolvedValue([candidate('tracked-flight', true)]);
  mockRepository.countPendingSync.mockResolvedValue({ flights: 1, deletions: 0 });
  mockUpload.mockResolvedValueOnce({ error: { message: 'IGC upload failed' } });

  await expect(engine.requestSync('manual')).resolves.toMatchObject({
    phase: 'error', lastError: 'IGC upload failed', pendingFlights: 1,
  });
  expect(mockRepository.markFlightPushed).not.toHaveBeenCalled();
  expect(mockRepository.markFlightIgcPushed).not.toHaveBeenCalled();

  mockRepository.markFlightPushed.mockImplementation(async () => {
    mockRepository.countPendingSync.mockResolvedValue({ flights: 0, deletions: 0 });
  });
  await expect(engine.requestSync('manual')).resolves.toMatchObject({
    phase: 'idle', lastError: null, pendingFlights: 0,
  });
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(mockRepository.markFlightIgcPushed).toHaveBeenCalledWith({
    flightId: 'tracked-flight', sha256: 'synthetic-igc-digest', objectPath: 'pilot/tracked-flight.igc', pushedAt: NOW,
  });
  expect(mockRepository.markFlightIgcPushed.mock.invocationCallOrder[0])
    .toBeLessThan(mockRepository.markFlightPushed.mock.invocationCallOrder[0]);
});

it('finishes reporting a rejected-credential sync even when logout also fails', async () => {
  mockRepository.getPilotProfile.mockResolvedValue(profile({ updatedAt: 1000, pushedUpdatedAt: null }));
  mockRequest.mockResolvedValueOnce({ data: null, error: { status: 401, message: 'Session rejected' } });
  mockSignOut.mockRejectedValue(new Error('Offline during logout'));

  await expect(engine.requestSync('manual')).resolves.toMatchObject({
    phase: 'error', lastError: 'Session rejected', lastSyncAt: null,
  });
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await expect(engine.requestSync('foreground')).resolves.toMatchObject({ phase: 'blocked', blockedBy: 'backoff' });
});

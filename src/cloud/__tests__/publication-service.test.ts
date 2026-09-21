import type { PublicationService } from '../publication-types';
import type { AuthSnapshot } from '../types';

let mockAuth: AuthSnapshot;
let mockJournal: string | null;
let mockJournalEpoch = 0;
let mockAuthListener: () => void;
const mockWorker = { invalidate: jest.fn(), requestSync: jest.fn(), eligible: jest.fn(), setEnvironment: jest.fn() };
const mockRepository = { getPreferences: jest.fn(), setPreferences: jest.fn(), get: jest.fn(), queueManual: jest.fn(), queueHide: jest.fn(), retry: jest.fn() };
const mockFeed = { getPublication: jest.fn() };
const mockCapture = jest.fn();
const mockBackupReady = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-operation' }));
jest.mock('@/journal/context', () => ({ journalOwner: () => mockJournal, journalEpoch: () => mockJournalEpoch, subscribeJournal: jest.fn() }));
jest.mock('@/recorder/sharing-preference-cache', () => ({ setCaptureSharingContext: (...args: unknown[]) => mockCapture(...args) }));
jest.mock('@/social/feed-api', () => ({ feedService: mockFeed }));
jest.mock('../auth-service', () => ({ cloudAuthService: { getSnapshot: () => mockAuth,
  subscribe: (listener: () => void) => { mockAuthListener = listener; listener(); return () => undefined; } } }));
jest.mock('../sync-engine', () => ({ cloudSyncEngine: { getSnapshot: () => ({ lastSyncAt: null }), subscribe: jest.fn(), requestSync: async () => ({}) } }));
jest.mock('../publication-repository.native', () => ({ publicationRepository: mockRepository }));
jest.mock('../publication-source.native', () => ({ publicationSourceExists: async () => true,
  publicationBackupReady: (...args: unknown[]) => mockBackupReady(...args), buildPublicationArtifact: jest.fn() }));
jest.mock('../publication-worker', () => ({ PublicationWorker: jest.fn(() => mockWorker) }));
let service: PublicationService;
beforeEach(() => {
  jest.resetAllMocks(); mockJournalEpoch = 0; mockJournal = 'A';
  mockAuth = { status: 'signed_in', userId: 'A', email: null, lastError: null };
  mockRepository.getPreferences.mockResolvedValue(null);
  mockRepository.get.mockResolvedValue(null);
  mockRepository.setPreferences.mockResolvedValue(undefined);
  mockRepository.queueManual.mockResolvedValue(undefined); mockRepository.queueHide.mockResolvedValue(undefined);
  mockWorker.requestSync.mockResolvedValue(undefined); mockWorker.eligible.mockReturnValue(true);
  mockBackupReady.mockResolvedValue(true);
  mockFeed.getPublication.mockResolvedValue({ flightId: 'flight', revision: 7, state: 'private', activityId: null });
  jest.isolateModules(() => { service = jest.requireActual('../publication-service.native').publicationService; });
});

it('caches signed-in B preferences while journal A is retained without authorizing capture or publications', async () => {
  mockAuth.userId = 'B';
  await service.setPreferences('B', { enabled: true, generation: 'consent-b' });
  expect(mockRepository.setPreferences).toHaveBeenCalledWith('B', { enabled: true, generation: 'consent-b' }, expect.any(Function));
  const capture = mockCapture.mock.calls.at(-1)!;
  expect(capture[0]).toBe('B'); expect(capture[2]()).toBe(false);
  await expect(service.hide('B', 'flight')).rejects.toMatchObject({ code: 'stale' });
  expect(mockRepository.queueHide).not.toHaveBeenCalled();
});

it('resolves durable preferences and queued hide without waiting for a slow background upload', async () => {
  mockWorker.requestSync.mockReturnValue(new Promise(() => undefined));
  await service.setPreferences('A', { enabled: true, generation: 'consent-a' });
  await service.hide('A', 'flight');
  expect(mockRepository.queueHide).toHaveBeenCalledWith('A', 'flight', 'new-operation', expect.any(Function));
});

it('ignores a late cached preference read after sign-out and rejects its pending caller', async () => {
  let resolve!: (value: unknown) => void;
  mockRepository.getPreferences.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  const reading = service.authChanged();
  mockAuth = { ...mockAuth, status: 'signed_out', userId: null };
  mockAuthListener();
  resolve({ enabled: true, generation: 'old' });
  await expect(reading).rejects.toMatchObject({ code: 'stale' });
  expect(mockCapture.mock.calls.at(-1)![0]).toBeNull();
});

it('freezes the explicit server revision once and does not create an intent after an auth switch', async () => {
  await service.authChanged();
  let resolve!: (value: unknown) => void;
  mockFeed.getPublication.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  const sharing = service.share('A', 'flight');
  while (!resolve) await Promise.resolve();
  mockAuth = { ...mockAuth, userId: 'B' }; mockAuthListener();
  resolve({ flightId: 'flight', revision: 7, state: 'private', activityId: null });
  await expect(sharing).rejects.toMatchObject({ code: 'stale' });
  expect(mockRepository.queueManual).not.toHaveBeenCalled();
});

it('retains pending operation identity on Retry instead of reading a fresh remote revision', async () => {
  await service.authChanged();
  mockRepository.get.mockResolvedValue({ state: 'pending', action: 'share', operationId: 'persisted', expectedRevision: 3 });
  await service.share('A', 'flight');
  expect(mockRepository.retry).toHaveBeenCalledWith('A', 'flight', expect.any(Function));
  expect(mockFeed.getPublication).not.toHaveBeenCalled(); expect(mockRepository.queueManual).not.toHaveBeenCalled();
});

it('reports a failed pending hide honestly and lets remote state override completed local confirmations', async () => {
  await service.authChanged();
  mockRepository.get.mockResolvedValue({ state: 'pending', action: 'hide', error: 'Offline', activityId: 'activity' });
  expect(await service.getView('A', 'flight')).toEqual({ state: 'error', activityId: 'activity', error: 'Offline', hasLocalOverride: true, pendingHide: true });
  mockRepository.get.mockResolvedValue({ state: 'shared', action: 'share', error: null, activityId: 'activity' });
  expect(await service.getView('A', 'flight')).toMatchObject({ state: 'shared', hasLocalOverride: false, pendingHide: false });
});

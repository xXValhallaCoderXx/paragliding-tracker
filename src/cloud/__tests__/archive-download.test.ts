import { File } from 'expo-file-system';
import { ARCHIVE_FREE_SPACE_RESERVE, MAX_ARCHIVE_IGC_BYTES, type ArchiveDownloadCandidate } from '@/archives/types';
import { downloadArchiveIgc } from '../archive-download.native';

interface DownloadOptions {
  idempotent: boolean;
  signal: AbortSignal;
  headers: Record<string, string>;
  onProgress: (progress: { bytesWritten: number }) => void;
}
const mockDownload = jest.fn();
const mockGetSession = jest.fn();
let mockFreeBytes: number;
let mockTemporary: { size: number; exists: boolean; bytes: jest.Mock; delete: jest.Mock };
jest.mock('expo-file-system', () => ({
  File: Object.assign(jest.fn(() => mockTemporary), { downloadFileAsync: (...args: unknown[]) => mockDownload(...args) }),
  Paths: { cache: 'file:///test-cache', get availableDiskSpace() { return mockFreeBytes; } },
}));
jest.mock('../supabase', () => ({ getSupabase: () => ({ auth: { getSession: () => mockGetSession() } }) }));
jest.mock('../config', () => ({
  CLOUD_CONFIG: { igcBucket: 'flight-igc' }, SUPABASE_URL: 'https://archive-test.invalid', SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
}));

const OWNER = '11111111-1111-4111-8111-111111111111';
const FLIGHT = '22222222-2222-4222-8222-222222222222';
const ORIGINAL = new Uint8Array([65, 88, 67, 76, 13, 10]);
const candidate = (patch: Partial<ArchiveDownloadCandidate> = {}): ArchiveDownloadCandidate => ({
  ownerUserId: OWNER, flightId: FLIGHT, recordingSessionId: 'recording', title: 'Flight', startedAt: 1000, endedAt: 3000,
  objectPath: `${OWNER}/${FLIGHT}.igc`, byteCount: ORIGINAL.byteLength, sha256: 'a'.repeat(64), artifactVersion: 1, attemptCount: 0, ...patch,
});
const download = (patch: Partial<ArchiveDownloadCandidate> = {}, controller = new AbortController(), progress = jest.fn()) =>
  downloadArchiveIgc(candidate(patch), controller.signal, progress);

beforeEach(() => {
  jest.clearAllMocks();
  mockFreeBytes = ARCHIVE_FREE_SPACE_RESERVE + 1024;
  mockTemporary = {
    size: ORIGINAL.byteLength, exists: true, bytes: jest.fn(async () => ORIGINAL),
    delete: jest.fn(() => { mockTemporary.exists = false; }),
  };
  mockGetSession.mockReset().mockResolvedValue({ data: { session: { user: { id: OWNER }, access_token: 'fixture-access-token' } }, error: null });
  mockDownload.mockReset().mockImplementation(async (_url: string, _file: unknown, options: DownloadOptions) => {
    options.onProgress({ bytesWritten: ORIGINAL.byteLength });
    return mockTemporary;
  });
});
afterEach(() => jest.restoreAllMocks());

it('checks the capture reserve and temporary-copy budget before auth or a network request', async () => {
  mockFreeBytes = ARCHIVE_FREE_SPACE_RESERVE + ORIGINAL.byteLength * 3 - 1;
  await expect(download()).rejects.toMatchObject({ code: 'archive_storage' });
  expect(mockGetSession).not.toHaveBeenCalled();
  expect(File).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});

it.each([
  { objectPath: `another-owner/${FLIGHT}.igc` }, { objectPath: `${OWNER}/../${FLIGHT}.igc` },
  { byteCount: 0 }, { byteCount: -1 }, { byteCount: 1.5 }, { byteCount: NaN }, { byteCount: MAX_ARCHIVE_IGC_BYTES + 1 },
])('rejects invalid manifests before touching the native file boundary: %o', async (patch) => {
  await expect(download(patch)).rejects.toThrow('invalid file reference');
  expect(mockGetSession).not.toHaveBeenCalled();
  expect(File).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});

it.each([null, { user: { id: 'other-owner' }, access_token: 'other-fixture-token' }])('does not request an object with an absent or wrong authenticated owner', async (session) => {
  mockGetSession.mockResolvedValue({ data: { session }, error: null });
  await expect(download()).rejects.toThrow('cancelled');
  expect(File).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});

it('propagates an authentication error without creating a partial file', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('Session unavailable') });
  await expect(download()).rejects.toThrow('Session unavailable');
  expect(File).not.toHaveBeenCalled();
});

it('uses private authenticated headers, reports progress, returns original bytes and removes its temporary file', async () => {
  const spies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  const controller = new AbortController();
  const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
  const progress = jest.fn();
  const result = await download({}, controller, progress);
  expect(result).toBe(ORIGINAL);
  expect(Array.from(result)).toEqual([65, 88, 67, 76, 13, 10]);
  expect(File).toHaveBeenCalledWith('file:///test-cache', `restore-${OWNER}-${FLIGHT}.part`);
  expect(mockDownload).toHaveBeenCalledWith(`https://archive-test.invalid/storage/v1/object/authenticated/flight-igc/${OWNER}/${FLIGHT}.igc`, mockTemporary, {
    idempotent: true, signal: expect.any(AbortSignal),
    headers: { Authorization: 'Bearer fixture-access-token', apikey: 'fixture-public-key' }, onProgress: expect.any(Function),
  });
  expect(progress).toHaveBeenCalledWith(ORIGINAL.byteLength);
  expect(mockTemporary.delete).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('rejects a final byte-length mismatch and cleans up without reading a partial archive', async () => {
  mockTemporary.size = ORIGINAL.byteLength - 1;
  await expect(download()).rejects.toThrow('incomplete');
  expect(mockTemporary.bytes).not.toHaveBeenCalled();
  expect(mockTemporary.delete).toHaveBeenCalledTimes(1);
});

it('cancels a native response that exceeds its declared size and removes the partial file', async () => {
  mockDownload.mockImplementationOnce(async (_url: string, _file: unknown, options: DownloadOptions) => {
    options.onProgress({ bytesWritten: ORIGINAL.byteLength + 1 });
    expect(options.signal.aborted).toBe(true);
    throw new Error('Native transfer aborted');
  });
  const progress = jest.fn();
  await expect(download({}, new AbortController(), progress)).rejects.toThrow('does not match its saved size');
  expect(progress).not.toHaveBeenCalled();
  expect(mockTemporary.bytes).not.toHaveBeenCalled();
  expect(mockTemporary.delete).toHaveBeenCalledTimes(1);
});

it('never starts a native download when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(download({}, controller)).rejects.toThrow('cancelled');
  expect(File).not.toHaveBeenCalled();
  expect(mockDownload).not.toHaveBeenCalled();
});

it('cancels the native request and rejects its late successful response', async () => {
  const controller = new AbortController();
  let complete!: () => void;
  let nativeSignal!: AbortSignal;
  mockDownload.mockImplementationOnce((_url: string, _file: unknown, options: DownloadOptions) => {
    nativeSignal = options.signal;
    return new Promise<void>((resolve) => { complete = resolve; });
  });
  const pending = download({}, controller);
  while (!complete) await Promise.resolve();
  controller.abort();
  expect(nativeSignal.aborted).toBe(true);
  complete();
  await expect(pending).rejects.toThrow('cancelled');
  expect(mockTemporary.bytes).not.toHaveBeenCalled();
  expect(mockTemporary.delete).toHaveBeenCalledTimes(1);
});

it('removes the partial file and abort listener after a native download error', async () => {
  const controller = new AbortController();
  const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
  mockDownload.mockRejectedValueOnce(new Error('Connection lost'));
  await expect(download({}, controller)).rejects.toThrow('Connection lost');
  expect(mockTemporary.delete).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('still cleans up when reading the completed temporary file fails', async () => {
  mockTemporary.bytes.mockRejectedValueOnce(new Error('Read failed'));
  await expect(download()).rejects.toThrow('Read failed');
  expect(mockTemporary.delete).toHaveBeenCalledTimes(1);
});

it('does not mask a native error by trying to delete an already absent temporary file', async () => {
  mockTemporary.exists = false;
  mockDownload.mockRejectedValueOnce(new Error('Transfer failed before creating a file'));
  await expect(download()).rejects.toThrow('Transfer failed before creating a file');
  expect(mockTemporary.delete).not.toHaveBeenCalled();
});

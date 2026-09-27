import { createHash } from 'node:crypto';
import { File } from 'expo-file-system';
import { MAX_ARCHIVE_IGC_BYTES, type ArchiveRemoteFlight } from '@/archives/types';
import { publishFirstIgc } from '../igc-upload.native';

const mockUpload = jest.fn();
const mockRequest = jest.fn();
const mockSession = jest.fn();
const mockDownload = jest.fn();
let mockFile: { size: number; exists: boolean; bytes: jest.Mock; delete: jest.Mock };
jest.mock('expo-file-system', () => ({
  File: Object.assign(jest.fn(() => mockFile), { downloadFileAsync: (...args: unknown[]) => mockDownload(...args) }),
  Paths: { cache: 'cache', availableDiskSpace: 1024 * 1024 * 1024 },
}));
jest.mock('expo-crypto', () => {
  const { createHash } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { CryptoDigestAlgorithm: { SHA256: 'sha256' },
    digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
    digest: async (_algorithm: string, value: Uint8Array) => createHash('sha256').update(value).digest(),
  };
});
jest.mock('../supabase', () => ({ getSupabase: () => ({
  auth: { getSession: () => mockSession() }, storage: { from: () => ({ upload: mockUpload }) },
  from: () => {
    const request: { operation: string; body?: unknown; empty: string[]; headers: Record<string, string> } = { operation: 'read', empty: [], headers: {} };
    const query = {
      update: (body: unknown) => { request.operation = 'update'; request.body = body; return query; },
      is: (column: string, value: unknown) => { if (value === null) request.empty.push(column); return query; },
      setHeader: (key: string, value: string) => { request.headers[key] = value; return query; },
      select: () => query, eq: () => query, maybeSingle: () => query, single: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(mockRequest(request)).then(resolve, reject),
    };
    return query;
  },
}) }));

const original = 'AXCLABC123\r\nHFDTE270926\r\nHFPLTPILOTINCHARGE:ORIGINAL\r\nB1000004600000N00700000EA0000001000\r\n';
const changed = original.replace('ORIGINAL', 'EDITED');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const row = { id: 'flight', user_id: 'A', recording_session_id: 'session', title: null,
  started_at: Date.UTC(2026, 8, 27, 10), ended_at: Date.UTC(2026, 8, 27, 10, 0, 1),
  igc_object_path: null, igc_sha256: null, igc_byte_count: null, igc_artifact_version: null } as ArchiveRemoteFlight;
const canonical = (content = original, version = 4) => ({ ...row, igc_object_path: 'A/flight.igc', igc_sha256: hash(content),
  igc_byte_count: Buffer.byteLength(content), igc_artifact_version: version });
const publish = (content = original, guard = () => {}) => publishFirstIgc(row, 'A', { content, artifactVersion: 4 }, guard);
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'A' }, access_token: 'token-A' } }, error: null });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRequest.mockReset().mockImplementation(async request => ({ data: { ...row, ...request.body }, error: null }));
  mockFile = { size: Buffer.byteLength(original), exists: true, bytes: jest.fn(async () => new TextEncoder().encode(original)),
    delete: jest.fn(() => { mockFile.exists = false; }) };
  mockDownload.mockReset().mockResolvedValue(undefined);
});

it('uploads once without replacement and publishes only a completely empty manifest using the verified owner token', async () => {
  expect(await publish()).toMatchObject({ sha256: hash(original), byteCount: Buffer.byteLength(original), artifactVersion: 4 });
  expect(mockUpload).toHaveBeenCalledWith('A/flight.igc', original, expect.objectContaining({ upsert: false, headers: { Authorization: 'Bearer token-A' } }));
  expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ empty: ['igc_object_path', 'igc_sha256', 'igc_byte_count', 'igc_artifact_version'],
    headers: { Authorization: 'Bearer token-A' } }));
  expect(mockDownload).not.toHaveBeenCalled();
});
it('recovers original orphan bytes instead of replacing them with changed pilot headers', async () => {
  mockUpload.mockResolvedValue({ error: { statusCode: '409', message: 'Already exists' } });
  expect(await publish(changed)).toMatchObject({ sha256: hash(original), byteCount: Buffer.byteLength(original), artifactVersion: 1 });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockFile.delete).toHaveBeenCalledTimes(1);
  expect(mockDownload.mock.calls[0]![2].headers.Authorization).toBe('Bearer token-A');
});
it('retains the known artifact version when recovered bytes match the generated candidate', async () => {
  mockUpload.mockResolvedValue({ error: { error: 'Duplicate' } });
  expect(await publish()).toMatchObject({ sha256: hash(original), artifactVersion: 4 });
});
it('recovers an upload whose first receipt failed, even if the next export has changed', async () => {
  mockRequest.mockResolvedValueOnce({ data: null, error: new Error('Receipt offline') });
  await expect(publish()).rejects.toThrow('Receipt offline');
  mockUpload.mockResolvedValueOnce({ error: { status: 409 } });
  expect(await publish(changed)).toMatchObject({ sha256: hash(original), artifactVersion: 1 });
  for (const call of mockUpload.mock.calls) expect(call[2].upsert).toBe(false);
});
it('reads back a concurrent winning manifest and preserves its version when it describes the original bytes', async () => {
  mockRequest.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: canonical(original, 3), error: null });
  expect(await publish()).toMatchObject({ sha256: hash(original), artifactVersion: 3 });
  expect(mockRequest.mock.calls.map(([request]) => request.operation)).toEqual(['update', 'read']);
});
it('does not acknowledge a concurrent receipt that differs from the preserved object', async () => {
  mockRequest.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: canonical(changed), error: null });
  await expect(publish()).rejects.toThrow('original file was not replaced');
});
it('refuses invalid recovered IGC bytes before publishing a receipt', async () => {
  mockUpload.mockResolvedValue({ error: { status: 409 } });
  mockFile.bytes.mockResolvedValue(new TextEncoder().encode('invalid'.padEnd(mockFile.size, ' ')));
  await expect(publish()).rejects.toThrow('supported Flight Log');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(mockFile.delete).toHaveBeenCalledTimes(1);
});
it('aborts an oversized orphan download before reading it into memory', async () => {
  mockUpload.mockResolvedValue({ error: { status: 409 } });
  mockDownload.mockImplementation(async (_url, _file, options) => { options.onProgress({ bytesWritten: MAX_ARCHIVE_IGC_BYTES + 1 }); });
  await expect(publish()).rejects.toThrow('needs recovery');
  expect(mockFile.bytes).not.toHaveBeenCalled();
  expect(mockFile.delete).toHaveBeenCalledTimes(1);
});
it('does not publish a late upload response after its auth or recorder guard becomes stale', async () => {
  let valid = true;
  mockUpload.mockImplementation(async () => { valid = false; return { error: null }; });
  await expect(publish(original, () => { if (!valid) throw new Error('Stale'); })).rejects.toThrow('Stale');
  expect(mockRequest).not.toHaveBeenCalled();
});
it('rejects a different authenticated owner before upload', async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'B' }, access_token: 'token-B' } }, error: null });
  await expect(publish()).rejects.toThrow('account changed');
  expect(mockUpload).not.toHaveBeenCalled();
  expect(File).not.toHaveBeenCalled();
});

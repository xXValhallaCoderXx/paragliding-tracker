import { createHash } from 'node:crypto';
import { readVerifiedSessionIgc } from '../exports-repository.native';

const mockRows: Record<string, unknown>[] = [];
const mockFiles = new Map<string, string>();
jest.mock('../database.native', () => ({ getArchiveDatabase: async () => ({ getAllAsync: async () => mockRows }) }));
jest.mock('expo-file-system', () => ({ File: class {
  path: string;
  constructor(path: string) { this.path = path; }
  get exists() { return mockFiles.has(this.path); }
  text() { return Promise.resolve(mockFiles.get(this.path)); }
} }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: (_algorithm: string, content: string) => Promise.resolve(jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(content).digest('hex')),
}));
beforeEach(() => { mockRows.length = 0; mockFiles.clear(); });

function receipt(path: string, content: string) {
  return { path, sha256: createHash('sha256').update(content).digest('hex'), byte_count: Buffer.byteLength(content),
    eligible_fix_count: 2, artifact_version: 3 };
}
it('returns exact saved legacy bytes after validating their receipt', async () => {
  const content = 'AXCLTEST\r\nHFGTYGLIDERTYPE:ORIGINAL WING\r\n';
  mockRows.push(receipt('saved.igc', content)); mockFiles.set('saved.igc', content);
  const result = await readVerifiedSessionIgc('session');
  expect(result).toMatchObject({ content, artifactVersion: 3,
    artifact: { sessionId: 'session', uri: 'saved.igc', byteCount: Buffer.byteLength(content) } });
});
it('skips a missing or tampered file and can recover an earlier verified export', async () => {
  const original = 'AXCL ORIGINAL\r\n';
  mockRows.push(receipt('missing', original), receipt('tampered', original), receipt('earlier', original));
  mockFiles.set('tampered', 'AXCL TAMPERED\r\n'); mockFiles.set('earlier', original);
  expect((await readVerifiedSessionIgc('session'))?.artifact.uri).toBe('earlier');
});
it('does not trust a filename or same-sized file without a matching hash', async () => {
  mockRows.push(receipt('saved', 'original'));
  mockFiles.set('saved', 'modified');
  expect(await readVerifiedSessionIgc('session')).toBeNull();
});

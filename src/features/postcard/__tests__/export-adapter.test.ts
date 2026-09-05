import { File, Directory } from 'expo-file-system';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { cleanupPostcards, pngDimensions, postcardExportAdapter } from '../export-adapter';
import { POSTCARD_RETENTION_MS } from '../export';

const mockFiles = new Map<string, Uint8Array>();
let mockCopyError = false;
const mockClose = jest.fn();
jest.mock('expo-file-system', () => {
  class MemoryFile {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) { this.uri = name ? `${typeof parent === 'string' ? parent : parent.uri}/${name}` : String(parent); }
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return mockFiles.has(this.uri); }
    delete() { mockFiles.delete(this.uri); }
    copy(destination: MemoryFile) { mockFiles.set(destination.uri, mockFiles.get(this.uri)!); if (mockCopyError) throw new Error('disk full'); }
    open() { return { readBytes: () => mockFiles.get(this.uri), close: mockClose }; }
  }
  class MemoryDirectory {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
    list() { return [...mockFiles.keys()].filter((uri) => uri.startsWith(`${this.uri}/`)).map((uri) => new MemoryFile(uri)); }
  }
  return { File: MemoryFile, Directory: MemoryDirectory, Paths: { cache: 'file:///cache' } };
});
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unique-id' }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(), releaseCapture: jest.fn() }));
function header(width: number, height: number) {
  const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return bytes;
}
beforeEach(() => { jest.clearAllMocks(); mockFiles.clear(); mockCopyError = false; });
it('reads actual PNG dimensions and rejects malformed images', () => {
  expect(pngDimensions(header(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  expect(() => pngDimensions(new Uint8Array(24))).toThrow();
  expect(() => pngDimensions(new Uint8Array(3))).toThrow();
});
it('checks both formats from file headers, closes file handles even on failure', async () => {
  mockFiles.set('file:///image.png', header(1080, 1080));
  await postcardExportAdapter({ current: null }, 'square').validate('file:///image.png');
  await expect(postcardExportAdapter({ current: null }, 'story').validate('file:///image.png')).rejects.toThrow('expected 1080 × 1920');
  expect(mockClose).toHaveBeenCalledTimes(2);
});
it('copies into its own cache and removes partial failed copies', async () => {
  mockFiles.set('file:///image.png', header(1080, 1080));
  const port = postcardExportAdapter({ current: null }, 'square');
  const uri = await port.copy('file:///image.png');
  expect(uri).toMatch(/^file:\/\/\/cache\/postcards\/postcard-\d+-unique-id.png$/);
  expect(new File(uri).exists).toBe(true); await port.remove(uri); expect(new File(uri).exists).toBe(false);
  mockCopyError = true; await expect(port.copy('file:///image.png')).rejects.toThrow('disk full');
  expect(new Directory('file:///cache', 'postcards').list()).toHaveLength(0);
});
it('cleans expired owned files without removing recent or unrelated ones', async () => {
  const now = Date.now();
  const expired = `file:///cache/postcards/postcard-${now - POSTCARD_RETENTION_MS}-old.png`;
  const recent = `file:///cache/postcards/postcard-${now}-new.png`;
  mockFiles.set(expired, header(1080, 1080)); mockFiles.set(recent, header(1080, 1080));
  mockFiles.set('file:///cache/postcards/other.png', header(1, 1));
  mockFiles.set('file:///cache/recorder-export.png', header(1, 1));
  await cleanupPostcards();
  expect(mockFiles.has(expired)).toBe(false); expect(mockFiles.has(recent)).toBe(true); expect(mockFiles.size).toBe(3);
});
it('uses the native capture API and PNG sharing options without permissions', async () => {
  const port = postcardExportAdapter({ current: null }, 'story');
  await port.capture();
  expect(captureRef).toHaveBeenCalledWith({ current: null }, expect.objectContaining({ format: 'png', result: 'tmpfile' }));
  port.release('/tmp/original.png'); expect(releaseCapture).toHaveBeenCalledWith('file:///tmp/original.png');
  await port.share('file:///cache/card.png');
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/card.png', { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share flight postcard' });
  expect(Platform.OS).toBeDefined();
});

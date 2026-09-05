import type { RefObject } from 'react';
import { PixelRatio, Platform, type View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { captureDimensions, expiredPostcard, localFileUri, type PostcardExportAdapter } from './export';
import { POSTCARD_SIZE, type PostcardFormat } from './presentation';

function cacheDirectory() {
  const directory = new Directory(Paths.cache, 'postcards');
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export async function cleanupPostcards() {
  for (const entry of cacheDirectory().list()) {
    if (entry instanceof File && expiredPostcard(entry.name, Date.now())) entry.delete();
  }
}

/** Check the PNG header itself, rather than trusting logical image sizes returned by a UI API. */
export function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('The postcard image could not be read. Please retry.');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: data.getUint32(16), height: data.getUint32(20) };
}

export function postcardExportAdapter(ref: RefObject<View | null>, format: PostcardFormat): PostcardExportAdapter {
  return {
    cleanup: cleanupPostcards,
    available: Sharing.isAvailableAsync,
    capture: () => captureRef(ref, {
      format: 'png', result: 'tmpfile', quality: 1,
      ...captureDimensions(format, Platform.OS, PixelRatio.get()),
    }),
    validate: async (uri) => {
      const handle = new File(uri).open();
      try {
        const actual = pngDimensions(handle.readBytes(24));
        const expected = POSTCARD_SIZE[format];
        if (actual.width !== expected.width || actual.height !== expected.height) {
          throw new Error(`The image was ${actual.width} × ${actual.height}; expected ${expected.width} × ${expected.height}. Please retry.`);
        }
      } finally { handle.close(); }
    },
    copy: async (uri) => {
      const destination = new File(cacheDirectory(), `postcard-${Date.now()}-${randomUUID()}.png`);
      try { new File(uri).copy(destination); }
      catch (error) { if (destination.exists) destination.delete(); throw error; }
      return destination.uri;
    },
    release: (uri) => releaseCapture(localFileUri(uri)),
    remove: async (uri) => { const file = new File(uri); if (file.exists) file.delete(); },
    share: (uri) => Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share flight postcard' }),
  };
}

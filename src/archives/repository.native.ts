import * as Crypto from 'expo-crypto';
import { Paths } from 'expo-file-system';
import { getArchiveDatabase, withArchiveWrite } from '../recorder/database.native';
import { simplifyTrack } from '../lib/track/simplify';
import { ArchiveRepositoryCore } from './repository-core';
import { parseArchivedIgc } from './igc';
import { ARCHIVE_FREE_SPACE_RESERVE } from './types';

export const archiveRepository = new ArchiveRepositoryCore({
  database: {
    read: async operation => operation(await getArchiveDatabase()),
    write: operation => withArchiveWrite(operation),
  },
  sha256: async bytes => Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))))
    .map(byte => byte.toString(16).padStart(2, '0')).join(''),
  checkStorage: bytes => {
    if (Paths.availableDiskSpace < ARCHIVE_FREE_SPACE_RESERVE + bytes * 2) {
      throw Object.assign(new Error('Free up space on this phone, then retry restoration.'), { code: 'archive_storage' });
    }
  },
  deriveTrack: (bytes, bounds) => simplifyTrack(parseArchivedIgc(bytes, bounds).points.map((point, sequence) => ({
    latitude: point.latitude, longitude: point.longitude, sourceTimestamp: point.timestamp, sequence, mocked: false,
  }))),
});

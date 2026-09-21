import type { ArchiveRepositoryCore } from './repository-core';

const unavailable = async (): Promise<never> => { throw new Error('Private flight restoration is available in the native app.'); };
export const archiveRepository: Pick<ArchiveRepositoryCore, keyof ArchiveRepositoryCore> = {
  list: async () => [], get: async () => null, listTracks: async () => ({}), getTrack: async () => [], readIgc: async () => null,
  getLastOwner: async () => null, getCursor: async () => null, getRestorePaused: async () => false,
  listDirtyMetadata: async () => [], listPendingDeletions: async () => [], listPendingDownloads: async () => [],
  upsertRemote: unavailable, updateMetadata: unavailable, deleteLocal: unavailable, applyRemoteDeletion: unavailable,
  markMetadataPushed: unavailable, recordMetadataFailure: unavailable, acknowledgeDeletion: unavailable, recordDeletionFailure: unavailable,
  markDownloadStarted: unavailable, recordDownloadFailure: unavailable, storeVerifiedIgc: unavailable, setCursor: unavailable,
  rememberOwner: unavailable, setRestorePaused: unavailable,
};

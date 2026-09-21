import { getArchiveDatabase, withArchiveWrite } from '@/recorder/database.native';
import { PublicationRepository } from '@/recorder/publication-repository-core';

export const publicationRepository = new PublicationRepository({
  read: async operation => operation(await getArchiveDatabase()),
  write: operation => withArchiveWrite(operation),
});

import * as Crypto from 'expo-crypto';
import { getArchiveDatabase, withArchiveWrite } from '../recorder/database.native';
import { EquipmentRepositoryCore } from './repository-core';

export const equipmentRepository = new EquipmentRepositoryCore({
  database: {
    read: async operation => operation(await getArchiveDatabase()),
    write: operation => withArchiveWrite(operation),
  },
  uuid: () => Crypto.randomUUID(),
});

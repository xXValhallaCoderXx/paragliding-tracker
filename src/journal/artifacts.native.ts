import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { archiveRepository } from '@/archives/repository';
import { journalEpoch, journalOwner } from './context';
import { assertFlightScope, captureFlightScope, type FlightActionScope } from '../lib/flight-scope';

/** Original bytes only: restoring a file never re-exports it under today's pilot headers. */
export async function shareArchivedIgc(flightId: string, scope: FlightActionScope = captureFlightScope()): Promise<void> {
  assertFlightScope(scope);
  const owner = journalOwner();
  const epoch = journalEpoch();
  if (!owner) throw new Error('This archive is not available for the current account.');
  const bytes = await archiveRepository.readIgc(owner, flightId);
  if (!bytes) throw new Error('Download this flight’s track before sharing its IGC.');
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device.');
  if (epoch !== journalEpoch()) throw new Error('The account changed. Please reopen this flight.');
  assertFlightScope(scope);
  const file = new File(Paths.cache, `flight-${flightId}.igc`);
  try {
    file.write(bytes);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/vnd.fai.igc', dialogTitle: 'Share archived IGC' });
  } finally {
    try { if (file.exists) file.delete(); } catch { /* Sharing completed; cache cleanup cannot undo it. */ }
  }
}

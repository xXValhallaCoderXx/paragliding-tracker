import { archiveRepository } from '@/archives/repository';
import { parseArchivedIgc } from '@/archives/igc';
import { flightRepository as recorded } from '@/recorder/flight-repository';
import type { ArchivedFlightDetail, FlightRepository, FlightSummary } from '@/recorder/types';
import type { FlightReplay } from '@/lib/replay/model';
import { notifyJournal, visibleJournalRead } from './context';

async function archiveReplay(owner: string, flightId: string): Promise<FlightReplay> {
  const flight = await archiveRepository.get(owner, flightId);
  if (!flight) return { kind: 'unavailable', reason: 'not_found' };
  const bytes = await archiveRepository.readIgc(owner, flightId);
  if (!bytes) return { kind: 'unavailable', reason: flight.archive.trackState === 'missing' ? 'archive_missing' : 'archive_pending' };
  if (flight.endedAt === null) return { kind: 'unavailable', reason: 'archive_invalid' };
  try {
    const parsed = parseArchivedIgc(bytes, { startedAt: flight.startedAt, endedAt: flight.endedAt });
    if (parsed.points.length < 2 || !parsed.bounds) return { kind: 'unavailable', reason: 'insufficient_fixes' };
    return { kind: 'available', source: 'archive', flightId, bounds: parsed.bounds, points: parsed.points, partial: flight.status === 'partial' };
  } catch {
    return { kind: 'unavailable', reason: 'archive_invalid' };
  }
}
/** The journal combines two provenances without writing archive data into recorder evidence. */
export const journalRepository: FlightRepository = {
  listFlights: () => visibleJournalRead(async (owner) => {
    const local = await recorded.listFlights();
    if (!owner) return local;
    const ids = new Set(local.map((flight) => flight.id));
    const archives = (await archiveRepository.list(owner)).filter((flight) => !ids.has(flight.id));
    return [...local, ...archives].sort((a, b) => b.startedAt - a.startedAt) as FlightSummary[];
  }),
  getFlight: (id) => visibleJournalRead(async (owner) =>
    await recorded.getFlight(id) ?? (owner ? archiveRepository.get(owner, id) : null)),
  updateFlight: (id, patch) => visibleJournalRead(async (owner) => {
    if (await recorded.getFlight(id)) return recorded.updateFlight(id, patch);
    if (!owner) throw new Error('Flight not found.');
    const flight = await archiveRepository.updateMetadata(owner, id, patch);
    notifyJournal({ kind: 'metadata', flightId: id });
    return flight as ArchivedFlightDetail;
  }),
  deleteFlight: (id) => visibleJournalRead(async (owner) => {
    if (await recorded.getFlight(id)) await recorded.deleteFlight(id);
    else if (owner) await archiveRepository.deleteLocal(owner, id);
    else throw new Error('Flight not found.');
    notifyJournal({ kind: 'delete', flightId: id });
  }),
  listTracks: () => visibleJournalRead(async (owner) => {
    const tracks = await recorded.listTracks();
    if (!owner) return tracks;
    const localIds = new Set((await recorded.listFlights()).map((flight) => flight.id));
    for (const [id, track] of Object.entries(await archiveRepository.listTracks(owner))) {
      if (!localIds.has(id)) tracks[id] = track;
    }
    return tracks;
  }),
  getTrack: (id) => visibleJournalRead(async (owner) => {
    if (await recorded.getFlight(id)) return recorded.getTrack(id);
    return owner ? archiveRepository.getTrack(owner, id) : [];
  }),
  getReplay: (id) => visibleJournalRead(async (owner) => {
    if (await recorded.getFlight(id)) return recorded.getReplay(id);
    return owner ? archiveReplay(owner, id) : { kind: 'unavailable', reason: 'not_found' };
  }),
  getLiveMapPage: recorded.getLiveMapPage,
};

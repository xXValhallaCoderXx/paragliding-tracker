import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { archiveRepository } from '@/archives/repository';
import { flightRepository as recorded } from '@/recorder/flight-repository';
import type { ArchivedFlightDetail, RecordedFlightDetail, SessionRecord } from '@/recorder/types';
import { flight, metrics } from '../../../tests/support/fixtures';
import { journalRepository } from '../repository.native';
import { shareArchivedIgc } from '../artifacts.native';
import { setJournalOwner, subscribeJournal } from '../context';

jest.mock('@/archives/repository', () => ({ archiveRepository: {
  list: jest.fn(), get: jest.fn(), updateMetadata: jest.fn(), deleteLocal: jest.fn(),
  listTracks: jest.fn(), getTrack: jest.fn(), readIgc: jest.fn(),
} }));
jest.mock('@/recorder/flight-repository', () => ({ flightRepository: {
  listFlights: jest.fn(), getFlight: jest.fn(), updateFlight: jest.fn(), deleteFlight: jest.fn(),
  listTracks: jest.fn(), getTrack: jest.fn(), getReplay: jest.fn(), getLiveMapPage: jest.fn(),
} }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: 'file:///cache' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
const archives = jest.mocked(archiveRepository);
const captures = jest.mocked(recorded);
const startedAt = Date.UTC(2026, 8, 20, 10);
const endedAt = startedAt + 1000;
const archive = (overrides: Partial<ArchivedFlightDetail> = {}): ArchivedFlightDetail => ({
  ...flight(), id: 'archive-1', source: 'archive', ownerUserId: 'owner-a', recordingSessionId: 'original-session', sessionStatus: null,
  session: null, startedAt, endedAt, metrics: metrics({ trackDistanceMetres: 99999 }),
  archive: { trackState: 'ready', downloadedAt: 1000, error: null }, ...overrides,
});
const captured = (): RecordedFlightDetail => ({ ...flight(), session: { id: 's1' } as SessionRecord });
const igc = new Uint8Array(Array.from('AXCLABCDEF\r\nHFDTE200926\r\nB1000000100000N10300000EA0000000010\r\nB1000010100060N10300060EA0000000011\r\n', char => char.charCodeAt(0)));
let file: { uri: string; exists: boolean; write: jest.Mock; delete: jest.Mock };
beforeEach(() => {
  jest.resetAllMocks(); setJournalOwner('owner-a');
  captures.listFlights.mockResolvedValue([]); captures.getFlight.mockResolvedValue(null); captures.listTracks.mockResolvedValue({});
  archives.list.mockResolvedValue([]); archives.get.mockResolvedValue(null); archives.listTracks.mockResolvedValue({}); archives.readIgc.mockResolvedValue(null);
  file = { uri: 'file:///cache/flight-archive-1.igc', exists: true, write: jest.fn(), delete: jest.fn() };
  jest.mocked(File).mockImplementation(() => file as unknown as File);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
});
afterEach(() => setJournalOwner(null));

it('prefers original captured summaries, details, thumbnails, and replay when both provenances exist', async () => {
  const local = captured(); const shadow = archive({ id: local.id });
  captures.listFlights.mockResolvedValue([local]); captures.getFlight.mockResolvedValue(local);
  archives.list.mockResolvedValue([shadow, archive()]);
  captures.listTracks.mockResolvedValue({ f1: [[1, 2]] }); archives.listTracks.mockResolvedValue({ f1: [[9, 9]], 'archive-1': [[3, 4]] });
  captures.getReplay.mockResolvedValue({ kind: 'unavailable', reason: 'insufficient_fixes' });
  const list = await journalRepository.listFlights();
  expect(list).toHaveLength(2); expect(list.find(item => item.id === 'f1')).toBe(local);
  expect(await journalRepository.getFlight('f1')).toBe(local);
  expect(await journalRepository.listTracks()).toEqual({ f1: [[1, 2]], 'archive-1': [[3, 4]] });
  expect(await journalRepository.getReplay('f1')).toEqual({ kind: 'unavailable', reason: 'insufficient_fixes' });
  expect(archives.readIgc).not.toHaveBeenCalled(); expect(archives.get).not.toHaveBeenCalled();
});

it('never exposes another owner catalogue and rejects a read that completed across an account switch', async () => {
  archives.list.mockImplementation(async owner => [archive({ ownerUserId: owner, id: owner })]);
  expect((await journalRepository.listFlights()).map(item => item.id)).toEqual(['owner-a']);
  setJournalOwner('owner-b');
  expect((await journalRepository.listFlights()).map(item => item.id)).toEqual(['owner-b']);
  let finish!: (value: ArchivedFlightDetail[]) => void;
  archives.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = journalRepository.listFlights();
  await Promise.resolve(); setJournalOwner('owner-c'); finish([archive({ ownerUserId: 'owner-b' })]);
  await expect(pending).rejects.toThrow('account changed');
  setJournalOwner(null); captures.listFlights.mockResolvedValue([flight()]);
  expect(await journalRepository.listFlights()).toEqual([flight()]);
});

it('replays retained verified IGC with null speed while preserving the downloaded summary metrics', async () => {
  const saved = archive({ archive: { trackState: 'error', downloadedAt: 1000, error: 'replacement failed' } });
  archives.get.mockResolvedValue(saved); archives.readIgc.mockResolvedValue(igc);
  const replay = await journalRepository.getReplay(saved.id);
  expect(replay).toMatchObject({ kind: 'available', source: 'archive', points: [
    { timestamp: startedAt, speed: null, altitude: 10 }, { timestamp: endedAt, speed: null, altitude: 11 },
  ] });
  expect(await journalRepository.getFlight(saved.id)).toBe(saved);
  expect(saved.metrics?.trackDistanceMetres).toBe(99999);
  expect(captures.updateFlight).not.toHaveBeenCalled(); expect(archives.updateMetadata).not.toHaveBeenCalled();
});

it('keeps missing or malformed archive tracks unavailable without losing their summaries', async () => {
  archives.get.mockResolvedValue(archive({ archive: { trackState: 'missing', downloadedAt: null, error: null } }));
  expect(await journalRepository.getReplay('archive-1')).toEqual({ kind: 'unavailable', reason: 'archive_missing' });
  archives.readIgc.mockResolvedValue(new Uint8Array([65]));
  expect(await journalRepository.getReplay('archive-1')).toEqual({ kind: 'unavailable', reason: 'archive_invalid' });
  expect(await journalRepository.getFlight('archive-1')).toMatchObject({ source: 'archive', metrics: { trackDistanceMetres: 99999 } });
});

it('routes mutations to their actual source and notifies archive changes', async () => {
  const local = captured(); const saved = archive(); const changed = jest.fn(); const unsubscribe = subscribeJournal(changed);
  try {
    captures.getFlight.mockResolvedValue(local); captures.updateFlight.mockResolvedValue(local);
    await journalRepository.updateFlight('f1', { title: 'Captured' }); await journalRepository.deleteFlight('f1');
    expect(captures.updateFlight).toHaveBeenCalledWith('f1', { title: 'Captured' }); expect(captures.deleteFlight).toHaveBeenCalledWith('f1');
    expect(archives.updateMetadata).not.toHaveBeenCalled(); expect(archives.deleteLocal).not.toHaveBeenCalled();
    captures.getFlight.mockResolvedValue(null); archives.updateMetadata.mockResolvedValue(saved);
    await journalRepository.updateFlight('archive-1', { notes: 'Offline edit' }); await journalRepository.deleteFlight('archive-1');
    expect(archives.updateMetadata).toHaveBeenCalledWith('owner-a', 'archive-1', { notes: 'Offline edit' });
    expect(archives.deleteLocal).toHaveBeenCalledWith('owner-a', 'archive-1');
    expect(changed).toHaveBeenCalledWith({ kind: 'metadata', flightId: 'archive-1' });
    expect(changed).toHaveBeenCalledWith({ kind: 'delete', flightId: 'archive-1' });
  } finally { unsubscribe(); }
});

it('shares exactly the original downloaded bytes then removes the temporary sharing copy', async () => {
  archives.readIgc.mockResolvedValue(igc);
  await shareArchivedIgc('archive-1');
  expect(archives.readIgc).toHaveBeenCalledWith('owner-a', 'archive-1');
  expect(file.write).toHaveBeenCalledWith(igc); expect(file.write.mock.calls[0][0]).toBe(igc);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(file.uri, expect.objectContaining({ mimeType: 'application/vnd.fai.igc' }));
  expect(file.delete).toHaveBeenCalledTimes(1);
});

it('does not open a share sheet if the account changed while the artifact was loading', async () => {
  archives.readIgc.mockImplementation(async () => { setJournalOwner('owner-b'); return igc; });
  await expect(shareArchivedIgc('archive-1')).rejects.toThrow('account changed');
  expect(file.write).not.toHaveBeenCalled(); expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

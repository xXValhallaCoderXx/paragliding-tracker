import { createHash } from 'node:crypto';
import * as SQLite from 'expo-sqlite';
import { equipmentRepository } from '../../equipment/repository.native';
import { ArchiveRepositoryCore } from '../../archives/repository-core';
import type { ArchiveRemoteFlight } from '../../archives/types';
import { flightRow } from '../../cloud/payloads';
import { TestDatabase, schemaAt, sqliteHarness } from '../../../tests/support/sqlite';
import * as database from '../database.native';
import { finalizeFlightForSession } from '../flight-repository.native';
import { equipmentExportHeaders } from '../equipment-export';
import { buildUnsignedIgc } from '../igc';
import { RECORDER_CONFIG } from '../config';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), backupDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => process.getBuiltinModule('node:crypto').randomUUID() }));

let harness: ReturnType<typeof sqliteHarness>;
let restoredDb: TestDatabase;
beforeAll(() => {
  harness = sqliteHarness();
  jest.mocked(SQLite.openDatabaseAsync).mockImplementation(harness.openDatabaseAsync);
  jest.mocked(SQLite.backupDatabaseAsync).mockImplementation(harness.backupDatabaseAsync as never);
  jest.mocked(SQLite.deleteDatabaseAsync).mockImplementation(harness.deleteDatabaseAsync);
});
afterAll(async () => { await restoredDb?.closeAsync(); await harness.dispose(); });

it('roundtrips actual saved/start equipment through SQLite, cloud payload, archive restore and IGC without applying later inventory changes', async () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  const sessionId = '00000000-0000-4000-8000-000000000002';
  const flightId = '00000000-0000-4000-8000-000000000003';
  const startedAt = Date.UTC(2026, 8, 27, 10);
  const power = { batteryLevel: null, batteryState: null, lowPowerMode: null,
    batteryOptimizationEnabled: null, recordedAt: startedAt };
  await database.updatePilotProfile({ pilotName: 'Roundtrip Pilot', registrationId: 'GLOBAL-PRIVATE-ID',
    gliderType: 'Old profile wing', gliderId: 'OLD-PROFILE-REG' });
  const saved = await equipmentRepository.saveAircraft({ owner: 'guest', sport: 'hang_gliding', model: 'Wills Wing Sport 3',
    size: '155', registrationId: 'HG-ORIGINAL', makeCurrent: true,
    identity: { pilotIdentifier: 'HG-PRIVATE-ID', expectedGeneration: 0 } });
  const aircraft = saved.aircraft[0]!;
  await database.bindCloudLink(owner);
  const current = await equipmentRepository.getInventory();
  expect(current.selection.value.aircraftId).toBe(aircraft.id);
  await database.createSession({ id: sessionId, flightId, startedAt, platform: 'android', deviceMetadata: {}, appMetadata: {}, startPower: power,
    equipment: { owner, aircraftId: aircraft.id, expectedGeneration: aircraft.generation } });
  await database.persistLocationBatch({ callbackId: 'synthetic-ground-track', receivedAt: startedAt + 3000, locations: [
    { timestamp: startedAt + 1000, coords: { latitude: 46, longitude: 8, altitude: 1000, altitudeAccuracy: 4, accuracy: 3, speed: 8, heading: 90 } },
    { timestamp: startedAt + 2000, coords: { latitude: 46.001, longitude: 8.001, altitude: 1010, altitudeAccuracy: 4, accuracy: 3, speed: 9, heading: 90 } },
  ] });
  await database.completeSession(sessionId, startedAt + 4000, 'stopped', power);
  await finalizeFlightForSession(sessionId);
  const initial = await database.getSessionExportData(sessionId);
  const snapshot = initial.equipmentSnapshot;
  expect(snapshot).toEqual({ version: 1, capturedAt: startedAt, aircraftId: aircraft.id, sport: 'hang_gliding',
    model: 'Wills Wing Sport 3', size: '155', registrationId: 'HG-ORIGINAL' });
  const pilot = await database.getPilotProfile();
  const initialIgc = buildUnsignedIgc(initial.session, initial.locations, equipmentExportHeaders(snapshot, pilot)).content;

  const edited = await equipmentRepository.saveAircraft({ owner, id: aircraft.id, expectedGeneration: aircraft.generation,
    sport: 'hang_gliding', model: 'Renamed aircraft', size: '170', registrationId: 'HG-CHANGED',
    identity: { pilotIdentifier: 'HG-NEW-PRIVATE-ID', expectedGeneration: current.identities[0]!.generation } });
  const archived = await equipmentRepository.setArchived(owner, aircraft.id, true, edited.aircraft[0]!.generation);
  expect(archived.selection.value.aircraftId).toBeNull();
  const replacement = await equipmentRepository.saveAircraft({ owner, sport: 'speedflying', model: 'Next speedwing', makeCurrent: true,
    expectedSelectionGeneration: archived.selection.generation });
  expect(replacement.selection.value.aircraftId).not.toBe(aircraft.id);
  const afterChanges = await database.getSessionExportData(sessionId);
  expect(afterChanges.equipmentSnapshot).toEqual(snapshot);
  expect(buildUnsignedIgc(afterChanges.session, afterChanges.locations,
    equipmentExportHeaders(afterChanges.equipmentSnapshot, await database.getPilotProfile())).content).toBe(initialIgc);

  // The actual pending-flight reader is the input to production's cloud serializer.
  const candidate = (await database.listDirtyFlights(100, Date.now(), { ownerUserId: owner })).find(item => item.id === flightId)!;
  expect(candidate).toBeDefined();
  const payload = flightRow(candidate, owner, 'android');
  expect(payload.equipment_snapshot).toEqual(snapshot);
  const bytes = new TextEncoder().encode(initialIgc);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const remote: ArchiveRemoteFlight = { ...payload,
    created_at: new Date(startedAt).toISOString(), updated_at: new Date(startedAt + 5000).toISOString(),
    igc_object_path: `${owner}/${flightId}.igc`, igc_sha256: digest, igc_byte_count: bytes.byteLength,
    igc_artifact_version: RECORDER_CONFIG.igcArtifactVersion };

  // A second database models restoration on a phone with neither inventory nor raw capture.
  restoredDb = new TestDatabase(); await schemaAt(restoredDb, 11);
  const archives = new ArchiveRepositoryCore({
    database: { read: operation => operation(restoredDb), write: async operation => {
      let result!: Awaited<ReturnType<typeof operation>>;
      await restoredDb.withExclusiveTransactionAsync(async tx => { result = await operation(tx); });
      return result;
    } },
    sha256: async value => createHash('sha256').update(value).digest('hex'), now: () => startedAt + 6000,
  });
  await archives.upsertRemote(owner, JSON.parse(JSON.stringify(remote)) as ArchiveRemoteFlight);
  expect(await archives.storeVerifiedIgc(owner, flightId, digest, bytes, RECORDER_CONFIG.igcArtifactVersion)).toBe(true);
  await archives.updateMetadata(owner, flightId, { title: 'Restored title', notes: 'Private journal note' });
  const restored = (await archives.get(owner, flightId))!;
  expect(restored.equipmentSnapshot).toEqual(snapshot);
  const restoredHeaders = equipmentExportHeaders(restored.equipmentSnapshot, pilot);
  expect(restoredHeaders).toEqual({ pilotName: 'Roundtrip Pilot', gliderType: 'WILLS WING SPORT 3', gliderId: 'HG-ORIGINAL' });
  expect(buildUnsignedIgc(initial.session, initial.locations, restoredHeaders).content).toBe(initialIgc);
  expect(await archives.readIgc(owner, flightId)).toEqual(bytes);
  expect(initialIgc).toContain('HFGTYGLIDERTYPE:WILLS WING SPORT 3\r\nHFGIDGLIDERID:HG-ORIGINAL\r\n');
  expect(initialIgc).not.toMatch(/GLOBAL-PRIVATE-ID|HG-PRIVATE-ID|HFCID|OLD-PROFILE-REG/);
  for (const table of ['sessions', 'location_fixes', 'pressure_samples', 'events', 'equipment_entities']) {
    expect(await restoredDb.getAllAsync(`SELECT * FROM ${table}`)).toEqual([]);
  }
});

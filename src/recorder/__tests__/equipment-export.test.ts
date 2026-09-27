import { equipmentExportHeaders, exportFilename } from '../equipment-export';
import { buildUnsignedIgc } from '../igc';
import type { FlightEquipmentSnapshot } from '@/equipment/types';

const equipment: FlightEquipmentSnapshot = {
  version: 1, capturedAt: 1000, aircraftId: 'wing-a', sport: 'hang_gliding',
  model: 'Wills Wing Sport 3', size: '155', registrationId: 'D-TEST',
};

it('exports the captured model and registration, with the current private pilot name', () => {
  const headers = equipmentExportHeaders(equipment, { pilotName: 'Test Pilot' });
  expect(headers).toEqual({ pilotName: 'Test Pilot', gliderType: 'WILLS WING SPORT 3', gliderId: 'D-TEST' });
  const result = buildUnsignedIgc({ id: 'session', startedAt: 1000, endedAt: 3000 },
    [{ sessionId: 'session', sequence: 1, callbackId: 'callback', batchIndex: 0,
      sourceTimestamp: 2000, receiptTimestamp: 2001, latitude: 1, longitude: 103,
      gpsAltitude: 10, verticalAccuracy: 1, horizontalAccuracy: 1, speed: 0, heading: 0, mocked: false }], headers);
  expect(result.content).toContain('HFGTYGLIDERTYPE:WILLS WING SPORT 3\r\n');
  expect(result.content).toContain('HFGIDGLIDERID:D-TEST\r\n');
  expect(result.content).not.toContain('155');
  expect(result.content).not.toContain('HFCID');
});

it.each([null, undefined, { ...equipment, aircraftId: null, sport: null, model: null, size: null, registrationId: null }])(
  'never infers a paraglider or current aircraft for unknown equipment', (snapshot) => {
    expect(equipmentExportHeaders(snapshot, null)).toEqual({
      pilotName: null, gliderType: 'UNSPECIFIED', gliderId: 'UNSPECIFIED',
    });
  },
);

it('keeps separate paths for earlier exports when headers or the format version change', () => {
  const first = exportFilename('session', 4, 'a'.repeat(64), 'igc');
  expect(exportFilename('session', 4, 'a'.repeat(64), 'igc')).toBe(first);
  expect(exportFilename('session', 4, 'b'.repeat(64), 'igc')).not.toBe(first);
  expect(exportFilename('session', 3, 'a'.repeat(64), 'igc')).not.toBe(first);
  expect(exportFilename('../session', 4, 'a'.repeat(64), 'igc')).not.toContain('/');
});

it('uses neutral unspecified equipment when its name cannot be represented by IGC ASCII headers', () => {
  expect(equipmentExportHeaders({ ...equipment, model: '翼', registrationId: '号' }, null)).toEqual({
    pilotName: null, gliderType: 'UNSPECIFIED', gliderId: 'UNSPECIFIED',
  });
});

import { RECORDER_CONFIG } from './config';
import { selectExportEligibleFixes } from './igc';
import { calculateAccuracyStatistics, calculateGapStatistics } from './statistics';
import type { SessionExportData } from './types';

export interface IgcArtifactSummary {
  available: boolean;
  sha256: string | null;
  byteCount: number;
  bRecordCount: number;
}

function callbackTotals(data: SessionExportData) {
  return data.events
    .filter(
      (event) =>
        event.type === 'location_callback' || event.type === 'location_callback_duplicate',
    )
    .reduce(
      (totals, event) => ({
        reported: totals.reported + Number(event.payload.reported ?? 0),
        inserted: totals.inserted + Number(event.payload.inserted ?? 0),
        duplicates: totals.duplicates + Number(event.payload.duplicates ?? 0),
        invalid: totals.invalid + Number(event.payload.invalid ?? 0),
      }),
      { reported: 0, inserted: 0, duplicates: 0, invalid: 0 },
    );
}

export function buildDiagnosticJson(
  data: SessionExportData,
  igc: IgcArtifactSummary,
): string {
  const eligibleFixes = selectExportEligibleFixes(data.locations, data.session);
  const callbacks = callbackTotals(data);
  const lastDataTimestamp = Math.max(
    data.session.updatedAt,
    ...data.locations.map((fix) => fix.receiptTimestamp),
    ...data.pressureSamples.map((sample) => sample.receiptTimestamp),
    ...data.events.map((event) => event.occurredAt),
  );

  const document = {
    artifact: {
      type: 'xc-recorder-diagnostics',
      version: RECORDER_CONFIG.diagnosticsArtifactVersion,
      generatedFromDataThrough: lastDataTimestamp,
      warning: 'Diagnostic evidence only; not a signed or competition-valid flight record.',
    },
    configuration: RECORDER_CONFIG,
    session: data.session,
    statistics: {
      callbacks,
      locationCadence: calculateGapStatistics(
        eligibleFixes.map((fix) => fix.sourceTimestamp),
      ),
      horizontalAccuracy: calculateAccuracyStatistics(
        eligibleFixes.map((fix) => fix.horizontalAccuracy),
      ),
      pressureCadence: calculateGapStatistics(
        data.pressureSamples.map((sample) => sample.receiptTimestamp),
      ),
      reconciliation: {
        persistedLocationRows: data.locations.length,
        exportEligibleSeconds: eligibleFixes.length,
        igcBRecords: igc.bRecordCount,
        callbackAccountingBalanced:
          callbacks.reported === callbacks.inserted + callbacks.duplicates + callbacks.invalid,
        igcCountBalanced: eligibleFixes.length === igc.bRecordCount,
      },
    },
    artifacts: {
      igc,
    },
    powerReadings: data.events.filter((event) => event.type === 'power_reading'),
    raw: {
      locationFixes: data.locations,
      pressureSamples: data.pressureSamples,
      events: data.events,
    },
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

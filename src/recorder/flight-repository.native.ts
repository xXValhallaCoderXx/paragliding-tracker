import { File } from 'expo-file-system';

import {
  completePendingFileDeletion,
  deleteCompletedFlight,
  getAppSettings,
  getPilotProfile,
  getFlightBySessionId,
  getFlightDetail,
  getSessionExportData,
  listFlights as listStoredFlights,
  listPendingFileDeletions,
  setFlightStatus,
  updateFlightMetadata,
  updateAppSettings,
  updatePilotProfile,
  upsertFlightMetrics,
} from './database.native';
import {
  calculateFlightMetrics,
  FLIGHT_METRICS_ALGORITHM_VERSION,
} from './flight-metrics';
import type {
  AppSettings,
  AppSettingsPatch,
  AppSettingsRepository,
  FlightDetail,
  FlightMetadataPatch,
  FlightRepository,
  FlightSummary,
  PilotProfile,
  PilotProfilePatch,
  PilotProfileRepository,
} from './types';

async function removePendingArtifacts(): Promise<void> {
  const paths = await listPendingFileDeletions();
  for (const path of paths) {
    try {
      const file = new File(path);
      if (file.exists) file.delete();
      await completePendingFileDeletion(path);
    } catch {
      // Keep the row queued so a later repository operation can retry safely.
    }
  }
}

export async function finalizeFlightForSession(sessionId: string): Promise<FlightDetail> {
  const data = await getSessionExportData(sessionId);
  if (data.session.status !== 'completed') {
    throw new Error(`Session ${sessionId} must be completed before flight stats are calculated.`);
  }

  const flight = await getFlightBySessionId(sessionId);
  if (!flight) throw new Error(`Flight for session ${sessionId} was not found.`);

  const calculated = calculateFlightMetrics(data.session, data.locations, data.events);
  const computedAt = Date.now();
  await upsertFlightMetrics({
    flightId: flight.id,
    ...calculated,
    computedAt,
  });
  await setFlightStatus({
    flightId: flight.id,
    status:
      data.session.completionReason === 'interrupted_finalized' ? 'partial' : 'completed',
    endedAt: data.session.endedAt,
    updatedAt: computedAt,
  });

  const detail = await getFlightDetail(flight.id);
  if (!detail) throw new Error(`Flight ${flight.id} disappeared while finalizing.`);
  return detail;
}

function needsMetrics(summary: FlightSummary): boolean {
  return (
    summary.endedAt !== null &&
    (summary.status === 'processing' ||
      summary.metrics === null ||
      summary.metrics.algorithmVersion !== FLIGHT_METRICS_ALGORITHM_VERSION)
  );
}

async function listFlights(): Promise<FlightSummary[]> {
  await removePendingArtifacts();
  const flights = await listStoredFlights();
  let recalculated = false;
  for (const flight of flights) {
    if (!needsMetrics(flight)) continue;
    try {
      await finalizeFlightForSession(flight.recordingSessionId);
      recalculated = true;
    } catch {
      // One damaged legacy row must not hide the rest of the local logbook.
    }
  }
  return recalculated ? listStoredFlights() : flights;
}

async function getFlight(flightId: string): Promise<FlightDetail | null> {
  await removePendingArtifacts();
  let detail = await getFlightDetail(flightId);
  if (!detail) return null;
  if (needsMetrics(detail)) {
    detail = await finalizeFlightForSession(detail.recordingSessionId);
  }
  return detail;
}

async function updateFlight(
  flightId: string,
  patch: FlightMetadataPatch,
): Promise<FlightDetail> {
  await updateFlightMetadata(flightId, patch);
  const detail = await getFlight(flightId);
  if (!detail) throw new Error(`Flight ${flightId} was not found after updating it.`);
  return detail;
}

async function deleteFlight(flightId: string): Promise<void> {
  await deleteCompletedFlight(flightId);
  await removePendingArtifacts();
}

export const flightRepository: FlightRepository = {
  listFlights,
  getFlight,
  updateFlight,
  deleteFlight,
};

/**
 * The pilot's own identity. Lives beside the flight repository because it shares the
 * same local database and the same platform split, and because it is what the IGC
 * writer reads. Entirely independent of any account: it works signed out and offline.
 */
export const pilotProfileRepository: PilotProfileRepository = {
  getProfile: (): Promise<PilotProfile> => getPilotProfile(),
  updateProfile: (patch: PilotProfilePatch): Promise<PilotProfile> => updatePilotProfile(patch),
};

/**
 * Kept out of `pilot_profile` on purpose: pushing a profile to the cloud must never be
 * able to leak whether this person has seen the intro. Separate table, separate facade.
 */
export const appSettingsRepository: AppSettingsRepository = {
  getSettings: (): Promise<AppSettings> => getAppSettings(),
  updateSettings: (patch: AppSettingsPatch): Promise<AppSettings> => updateAppSettings(patch),
};

import { File } from 'expo-file-system';

import { decodeTrackSegments, encodeTrackSegments } from '../lib/track/encoding';
import { orderedUsableFixes } from '../lib/track/fixes';
import { simplifyTrack, TRACK_ALGORITHM_VERSION } from '../lib/track/simplify';
import type { TrackSegments } from '../lib/track/types';
import {
  completePendingFileDeletion,
  deleteCompletedFlight,
  getAppSettings,
  getPilotProfile,
  getFlightBySessionId,
  getFlightDetail,
  getFlightTrackRow,
  getSessionExportData,
  listFlights as listStoredFlights,
  listFlightTrackRows,
  listPendingFileDeletions,
  listSessionTrackFixes,
  setFlightStatus,
  setFlightTakeoff,
  updateFlightMetadata,
  updateAppSettings,
  updatePilotProfile,
  upsertFlightMetrics,
  upsertFlightTrack,
} from './database.native';
import {
  calculateFlightMetrics,
  FLIGHT_METRICS_ALGORITHM_VERSION,
} from './flight-metrics';
import { selectExportEligibleFixes } from './igc';
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

  // Where the flight launched from, so it can be named later without a GPS read and
  // without re-reading its fixes. Deliberately the same predicate the IGC writer uses,
  // so the coordinate we offer launch names for is the one the file calls its first fix.
  // A flight with no eligible fix simply keeps NULL coordinates — the picker then offers
  // a live location read instead.
  const takeoff = selectExportEligibleFixes(data.locations, data.session)[0];
  if (takeoff) {
    await setFlightTakeoff({
      flightId: flight.id,
      latitude: takeoff.latitude,
      longitude: takeoff.longitude,
    });
  }

  // The drawable shape, from fixes already in memory for the metrics above — a few
  // milliseconds of CPU and no extra I/O at all. Every flight recorded from here on has its
  // track at stop time, which is what lets the logbook draw thumbnails without ever reading
  // a location_fixes row.
  await storeTrack(
    flight.id,
    simplifyTrack(
      orderedUsableFixes(
        data.locations.filter((fix) => fix.sessionId === data.session.id),
        data.session,
      ),
    ),
    computedAt,
  );

  const detail = await getFlightDetail(flight.id);
  if (!detail) throw new Error(`Flight ${flight.id} disappeared while finalizing.`);
  return detail;
}

async function storeTrack(
  flightId: string,
  segments: TrackSegments,
  computedAt: number,
): Promise<void> {
  await upsertFlightTrack({
    flight_id: flightId,
    segments: encodeTrackSegments(segments),
    algorithm_version: TRACK_ALGORITHM_VERSION,
    computed_at: computedAt,
  });
}

/**
 * Every stored track, for the logbook.
 *
 * Reads only. Deriving here would mean re-reading the fixes of every un-backfilled flight
 * before the list could paint — potentially seconds of blocked logbook on the first launch
 * after an algorithm bump. A card with no stored track simply shows no thumbnail; opening
 * that flight once fills it in, and it appears on the next visit to the list.
 */
async function listTracks(): Promise<Record<string, TrackSegments>> {
  const rows = await listFlightTrackRows();
  const tracks: Record<string, TrackSegments> = {};
  for (const row of rows) {
    if (row.algorithm_version !== TRACK_ALGORITHM_VERSION) continue;
    tracks[row.flight_id] = decodeTrackSegments(row.segments);
  }
  return tracks;
}

/**
 * One flight's track, derived from its fixes if it has none stored.
 *
 * The case this really exists for is not old flights — it is `TRACK_ALGORITHM_VERSION`.
 * Tuning the point budget or the tolerance re-derives every track lazily as flights are
 * opened, with no migration walking `location_fixes` inside a transaction.
 */
async function getTrack(flightId: string): Promise<TrackSegments> {
  const row = await getFlightTrackRow(flightId);
  if (row && row.algorithm_version === TRACK_ALGORITHM_VERSION) {
    return decodeTrackSegments(row.segments);
  }

  const detail = await getFlightDetail(flightId);
  if (!detail) return [];

  // Only a finalized flight is worth deriving. Doing it mid-processing would store a shape
  // built from however many fixes had landed at that moment, and finalize would then rewrite
  // the row while this query's cache entry kept the partial one — a track that is quietly
  // short until something else invalidates it. The plate says "plotting" in this state
  // anyway, so there is nothing to gain by guessing early.
  if (detail.status !== 'completed' && detail.status !== 'partial') {
    return row ? decodeTrackSegments(row.segments) : [];
  }

  const fixes = await listSessionTrackFixes(detail.recordingSessionId);
  const segments = simplifyTrack(
    orderedUsableFixes(
      fixes.map((fix) => ({
        latitude: fix.latitude,
        longitude: fix.longitude,
        sourceTimestamp: fix.source_timestamp,
        sequence: fix.sequence,
        mocked: fix.mocked !== 0,
      })),
      { startedAt: detail.session.startedAt, endedAt: detail.session.endedAt },
    ),
  );

  // Stored even when empty. The row's presence is what records that the simplifier has
  // already looked, so a flight with no usable fixes is not re-scanned on every open.
  await storeTrack(flightId, segments, Date.now());
  return segments;
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
  listTracks,
  getTrack,
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

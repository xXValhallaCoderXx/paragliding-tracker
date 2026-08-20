import {
  appSettingsRepository,
  flightRepository,
  pilotProfileRepository,
} from '@/recorder/flight-repository';
import type {
  AppSettings,
  AppSettingsPatch,
  FlightDetail,
  FlightMetadataPatch,
  FlightSummary,
  PilotProfile,
  PilotProfilePatch,
} from '@/recorder/types';

import { api } from './api';
import { repositoryQuery as read } from './query-fn';

/**
 * Every read the app performs, behind one cache.
 *
 * Each endpoint wraps a repository call that already existed — this adds no new data
 * access, only sharing and invalidation. Before it, four screens each re-read SQLite on
 * every focus and a write on one screen left the other three stale until they were
 * visited again.
 *
 * Two rules every `queryFn` here follows:
 *
 *  - **Return, never throw.** A thrown value lands in the store unserialized, which is
 *    what `serializableStateInvariant` exists to catch and what would not survive a
 *    devtools round-trip. `serializeQueryError` narrows it first.
 *  - **Refuse on web.** Every repository method here rejects on web. Queries dispatch
 *    from an effect, not during render, so static rendering never reaches them — but a
 *    browser would. Callers also pass `skip: !DATA_AVAILABLE`; that is the optimisation,
 *    this is the correctness guard.
 *
 * Recorder capabilities are deliberately NOT here. They already have two sources of
 * truth — the recorder's own snapshot and each screen's focus read — and a cache with its
 * own lifetime would be a third. `requestLocationPermissions()` mutates the service's
 * cache and returns the fresh value, so a cached copy would still show "denied" on the
 * settings screen immediately after the pilot granted it. Freshness there means "since
 * the pilot might have changed a system setting", which is a focus concern, not a TTL.
 */

export const dataApi = api.injectEndpoints({
  endpoints: (build) => ({
    getFlights: build.query<FlightSummary[], void>({
      queryFn: () => read(() => flightRepository.listFlights()),
      // One tag per flight plus the list itself, so editing a flight's metadata
      // invalidates that flight and the list without touching every other cached entry.
      providesTags: (result) =>
        result
          ? [
              ...result.map((flight) => ({ type: 'Flight' as const, id: flight.id })),
              { type: 'Flight' as const, id: 'LIST' },
            ]
          : [{ type: 'Flight' as const, id: 'LIST' }],
    }),

    getFlight: build.query<FlightDetail | null, string>({
      queryFn: (flightId) => read(() => flightRepository.getFlight(flightId)),
      providesTags: (_result, _error, flightId) => [{ type: 'Flight' as const, id: flightId }],
    }),

    getProfile: build.query<PilotProfile, void>({
      queryFn: () => read(() => pilotProfileRepository.getProfile()),
      providesTags: ['Profile'],
    }),

    getAppSettings: build.query<AppSettings, void>({
      queryFn: () => read(() => appSettingsRepository.getSettings()),
      providesTags: ['AppSettings'],
    }),

    updateFlight: build.mutation<FlightDetail, { flightId: string; patch: FlightMetadataPatch }>({
      queryFn: ({ flightId, patch }) => read(() => flightRepository.updateFlight(flightId, patch)),
      invalidatesTags: (_result, _error, { flightId }) => [
        { type: 'Flight', id: flightId },
        { type: 'Flight', id: 'LIST' },
      ],
    }),

    deleteFlight: build.mutation<null, string>({
      queryFn: (flightId) =>
        read(async () => {
          await flightRepository.deleteFlight(flightId);
          return null;
        }),
      invalidatesTags: (_result, _error, flightId) => [
        { type: 'Flight', id: flightId },
        { type: 'Flight', id: 'LIST' },
      ],
    }),

    updateProfile: build.mutation<PilotProfile, PilotProfilePatch>({
      queryFn: (patch) => read(() => pilotProfileRepository.updateProfile(patch)),
      // The logbook's setup checklist and its empty-state greeting both read the profile,
      // so this is what stops them going stale after an edit on the account screen.
      invalidatesTags: ['Profile'],
    }),

    updateAppSettings: build.mutation<AppSettings, AppSettingsPatch>({
      queryFn: (patch) => read(() => appSettingsRepository.updateSettings(patch)),
      invalidatesTags: ['AppSettings'],
    }),
  }),
});

export const {
  useGetFlightsQuery,
  useGetFlightQuery,
  useGetProfileQuery,
  useGetAppSettingsQuery,
  useUpdateFlightMutation,
  useDeleteFlightMutation,
  useUpdateProfileMutation,
  useUpdateAppSettingsMutation,
} = dataApi;

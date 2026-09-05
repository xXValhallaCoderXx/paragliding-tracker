import type { FlightReplay } from '@/lib/replay/model';
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

import { fetchNearbySites, searchSitesByName } from '@/sites/site-service';
import type { Coordinate, SiteLookupError, SiteSuggestion } from '@/sites/types';
import type { TrackSegments } from '@/lib/track/types';

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

    /**
     * Every stored track, for the logbook's thumbnails.
     *
     * A separate entry from `getFlights` on purpose. Editing a title invalidates the whole
     * flight list, and folding geometry into that cache would re-read and re-parse every
     * flight's shape to redraw one word. Under its own tag the thumbnails simply stay.
     */
    getFlightTracks: build.query<Record<string, TrackSegments>, void>({
      queryFn: () => read(() => flightRepository.listTracks()),
      providesTags: [{ type: 'FlightTrack' as const, id: 'LIST' }],
      // A finalized track never changes. Only a delete or a re-derive can invalidate it.
      keepUnusedDataFor: 3_600,
    }),

    getFlightTrack: build.query<TrackSegments, string>({
      queryFn: (flightId) => read(() => flightRepository.getTrack(flightId)),
      providesTags: (_result, _error, flightId) => [
        { type: 'FlightTrack' as const, id: flightId },
        // This is the one read that derives on a miss, so a hit here can be the moment a
        // thumbnail becomes available to the list.
        { type: 'FlightTrack' as const, id: 'LIST' },
      ],
      keepUnusedDataFor: 3_600,
    }),

    getFlightReplay: build.query<FlightReplay, string>({
      queryFn: (flightId) => read(() => flightRepository.getReplay(flightId)),
      providesTags: (_result, _error, flightId) => [{ type: 'FlightReplay', id: flightId }],
      // Raw fixes can be large. Leaving replay releases them; metadata never invalidates them.
      keepUnusedDataFor: 0,
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
      invalidatesTags: (_result, error, flightId) => error ? [] : [
        { type: 'Flight', id: flightId },
        { type: 'Flight', id: 'LIST' },
        { type: 'FlightTrack', id: flightId },
        { type: 'FlightReplay', id: flightId },
        { type: 'FlightTrack', id: 'LIST' },
      ],
    }),

    updateProfile: build.mutation<PilotProfile, PilotProfilePatch>({
      queryFn: (patch) => read(() => pilotProfileRepository.updateProfile(patch)),
      // The logbook's setup checklist and its empty-state greeting both read the profile,
      // so this is what stops them going stale after an edit on the account screen.
      invalidatesTags: ['Profile'],
    }),

    /**
     * Launches near a coordinate.
     *
     * Cached for an hour: launches do not move, and the round trip is to a volunteer-run
     * service. `api.signal` is threaded through so an abandoned lookup stops rather than
     * running to completion.
     */
    nearbySites: build.query<SiteSuggestion[], Coordinate>({
      queryFn: (near, api) => siteLookup(() => fetchNearbySites(near, { signal: api.signal })),
      keepUnusedDataFor: 60 * 60,
      providesTags: ['Site'],
    }),

    /** Places matching a typed name, biased toward the pilot when a position is known. */
    searchSites: build.query<SiteSuggestion[], { query: string; near: Coordinate | null }>({
      queryFn: (arg, api) =>
        siteLookup(() => searchSitesByName(arg.query, { near: arg.near, signal: api.signal })),
      keepUnusedDataFor: 60 * 60,
      providesTags: ['Site'],
    }),

    updateAppSettings: build.mutation<AppSettings, AppSettingsPatch>({
      queryFn: (patch) => read(() => appSettingsRepository.updateSettings(patch)),
      invalidatesTags: ['AppSettings'],
    }),
  }),
});

/**
 * The same return-never-throw contract as `repositoryQuery`, for the network.
 *
 * The site clients already reject with a classified `SiteLookupError`, so this only has
 * to keep it out of the throw path — an entry that threw never registers as providing its
 * tags, which turns a transient failure into permanent staleness.
 */
async function siteLookup(
  load: () => Promise<SiteSuggestion[]>,
): Promise<{ data: SiteSuggestion[] } | { error: SiteLookupError }> {
  try {
    return { data: await load() };
  } catch (error) {
    return {
      error: (error as SiteLookupError)?.kind
        ? (error as SiteLookupError)
        : { kind: 'unavailable', message: String(error) },
    };
  }
}

export const {
  useGetFlightsQuery,
  useGetFlightQuery,
  useGetFlightTracksQuery,
  useGetFlightTrackQuery,
  useGetFlightReplayQuery,
  useGetProfileQuery,
  useGetAppSettingsQuery,
  useNearbySitesQuery,
  useSearchSitesQuery,
  useUpdateFlightMutation,
  useDeleteFlightMutation,
  useUpdateProfileMutation,
  useUpdateAppSettingsMutation,
} = dataApi;

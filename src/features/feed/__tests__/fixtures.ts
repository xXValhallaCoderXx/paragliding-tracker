import type { FeedContextValue, FlightPublicationView, SharedFlightSummary, SharedReplayArtifactV1 } from '@/social/feed-types';
import type { FriendsContextValue } from '@/social/types';

export const sharedFlight = (patch: Partial<SharedFlightSummary> = {}): SharedFlightSummary => ({
  activityId: 'activity-1', author: { userId: 'friend-b', displayName: 'Pilot B' }, publishedAt: '2026-09-21T10:00:00Z',
  title: 'Evening ridge', site: 'Jugra', siteSource: 'manual', startedAt: 1000, endedAt: 61000, timezoneOffsetMinutes: -480,
  status: 'completed', metrics: { durationMs: 60000, trackDistanceMetres: 2100, minGpsAltitude: 100, maxGpsAltitude: 130,
    maxGroundSpeed: 15, fixCount: 61, quality: 'healthy' }, routePreview: [[2.8, 101.5, 2.801, 101.501]],
  provenance: 'recorded', replayAvailable: true, artifact: { generation: 'generation-1', sha256: 'a'.repeat(64), byteCount: 200 }, ...patch,
});

export const replayArtifact = (patch: Partial<SharedReplayArtifactV1> = {}): SharedReplayArtifactV1 => ({
  schemaVersion: 1, provenance: 'recorded', bounds: { startedAt: 1000, endedAt: 2000 }, partial: false,
  points: [{ timestamp: 1000, latitude: 2.8, longitude: 101.5, altitude: 100, speed: 2 },
    { timestamp: 2000, latitude: 2.801, longitude: 101.501, altitude: 110, speed: 3 }], ...patch,
});

export const feedContext = (patch: Partial<FeedContextValue> = {}): FeedContextValue => ({
  identityKey: 'owner-a', available: true, recorderBusy: false, revision: 0, preferences: { enabled: false, generation: null },
  items: [sharedFlight()], nextCursor: null, loading: false, loadingMore: false, busy: false, error: null,
  refresh: jest.fn().mockResolvedValue(undefined), loadMore: jest.fn().mockResolvedValue(undefined),
  setAutoShare: jest.fn().mockResolvedValue(undefined), getDetail: jest.fn().mockResolvedValue(sharedFlight()),
  getPublication: jest.fn().mockResolvedValue({ flightId: 'flight-1', activityId: null, revision: 0, state: 'private' }),
  getReplay: jest.fn().mockResolvedValue(replayArtifact()), ...patch,
});

export const friendsContext = (patch: Partial<FriendsContextValue> = {}): FriendsContextValue => ({
  status: 'ready', identityKey: 'owner-a', available: true, revision: 0, loading: false, busy: false, error: null,
  profile: { userId: 'owner-a', displayName: 'My Name', backedUpFlightCount: 3 }, inviteCode: 'ABCD2345WXYZ', relationships: [],
  refresh: jest.fn().mockResolvedValue(undefined), saveProfile: jest.fn().mockResolvedValue(undefined),
  rotateInviteCode: jest.fn().mockResolvedValue('REPLACED2345'), requestFriend: jest.fn().mockResolvedValue('sent'),
  changeRelationship: jest.fn().mockResolvedValue(undefined), getFriendProfile: jest.fn(), ...patch,
});

export const publicationView = (patch: Partial<FlightPublicationView> = {}): FlightPublicationView => ({
  state: 'private', activityId: null, error: null, busy: false, available: true, online: true, pendingHide: false,
  refresh: jest.fn().mockResolvedValue(undefined), share: jest.fn().mockResolvedValue(undefined), hide: jest.fn().mockResolvedValue(undefined),
  retry: jest.fn().mockResolvedValue(undefined), ...patch,
});

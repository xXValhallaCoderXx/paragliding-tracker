export interface SocialProfile {
  userId: string;
  displayName: string;
  username: string | null;
  backedUpFlightCount: number;
}
export interface OwnSocialProfile extends SocialProfile {
  discoverable: boolean;
}
export interface SaveSocialProfileInput {
  displayName: string;
  username: string;
  discoverable: boolean;
}

export type FriendshipState = 'incoming' | 'outgoing' | 'accepted' | 'blocked';
export interface FriendshipSummary {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  state: FriendshipState;
}
export type FriendshipAction = 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock';
export type FriendRequestStatus = 'sent' | 'incoming' | 'outgoing' | 'accepted' | 'unavailable' | 'rate_limited';

export interface PilotSearchResult {
  userId: string;
  displayName: string;
  username: string;
  relationshipId: string | null;
  relationshipState: 'none' | 'incoming' | 'outgoing' | 'accepted';
}
export interface PilotSearchCursor {
  query: string;
  rank: 0 | 1;
  username: string;
  userId: string;
}
export interface PilotSearchPage {
  status: 'ok' | 'rate_limited';
  items: PilotSearchResult[];
  nextCursor: PilotSearchCursor | null;
}

export interface SocialState {
  profile: OwnSocialProfile | null;
  relationships: FriendshipSummary[];
}
export interface FriendsSnapshot extends SocialState {
  identityKey: string | null;
  /** Requires a signed-in owner, foreground app, and an available connection. */
  available: boolean;
  /** Invalidates displayed friend profiles and search results; reads never change it. */
  revision: number;
  loading: boolean;
  busy: boolean;
  error: string | null;
}
export interface FriendsContextValue extends FriendsSnapshot {
  status: 'unconfigured' | 'restoring' | 'signed_out' | 'ready';
  refresh(): Promise<void>;
  saveProfile(input: SaveSocialProfileInput): Promise<void>;
  requestPilot(userId: string): Promise<FriendRequestStatus>;
  blockPilot(userId: string): Promise<void>;
  searchPilots(query: string, cursor?: PilotSearchCursor | null, signal?: AbortSignal): Promise<PilotSearchPage>;
  changeRelationship(relationship: FriendshipSummary, action: FriendshipAction): Promise<void>;
  getFriendProfile(userId: string): Promise<SocialProfile>;
}
export interface SocialService {
  getState(signal: AbortSignal): Promise<SocialState>;
  saveProfile(input: SaveSocialProfileInput, signal: AbortSignal): Promise<void>;
  requestPilot(userId: string, signal: AbortSignal): Promise<FriendRequestStatus>;
  blockPilot(userId: string, signal: AbortSignal): Promise<void>;
  searchPilots(query: string, cursor: PilotSearchCursor | null, signal: AbortSignal): Promise<PilotSearchPage>;
  changeRelationship(relationship: FriendshipSummary, action: FriendshipAction, signal: AbortSignal): Promise<void>;
  getFriendProfile(userId: string, signal: AbortSignal): Promise<SocialProfile>;
}

export class SocialError extends Error {
  constructor(readonly code: 'invalid_input' | 'invalid_response' | 'request_failed' | 'unavailable' | 'stale' | 'busy'
    | 'consent_changed' | 'publication_changed' | 'flight_not_ready' | 'profile_required' | 'account_deleting' | 'unsupported', message: string) {
    super(message);
    this.name = 'SocialError';
  }
}

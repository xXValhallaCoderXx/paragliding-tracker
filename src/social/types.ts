export interface SocialProfile {
  userId: string;
  displayName: string;
  backedUpFlightCount: number;
}

export type FriendshipState = 'incoming' | 'outgoing' | 'accepted' | 'blocked';
export interface FriendshipSummary {
  id: string;
  userId: string;
  displayName: string;
  state: FriendshipState;
}
export type FriendshipAction = 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock';
export type FriendRequestStatus = 'sent' | 'incoming' | 'outgoing' | 'accepted' | 'unavailable' | 'rate_limited';

export interface SocialState {
  profile: SocialProfile | null;
  inviteCode: string | null;
  relationships: FriendshipSummary[];
}
export interface FriendsSnapshot extends SocialState {
  identityKey: string | null;
  /** Requires a signed-in owner, foreground app, and an available connection. */
  available: boolean;
  /** Invalidates displayed friend profiles; reading a profile never changes it. */
  revision: number;
  loading: boolean;
  busy: boolean;
  error: string | null;
}
export interface FriendsContextValue extends FriendsSnapshot {
  status: 'unconfigured' | 'restoring' | 'signed_out' | 'ready';
  refresh(): Promise<void>;
  saveProfile(displayName: string): Promise<void>;
  rotateInviteCode(): Promise<string>;
  requestFriend(code: string): Promise<FriendRequestStatus>;
  changeRelationship(relationship: FriendshipSummary, action: FriendshipAction): Promise<void>;
  getFriendProfile(userId: string): Promise<SocialProfile>;
}
export interface SocialService {
  getState(signal: AbortSignal): Promise<SocialState>;
  saveProfile(displayName: string, signal: AbortSignal): Promise<void>;
  rotateInviteCode(signal: AbortSignal): Promise<string>;
  requestFriend(code: string, signal: AbortSignal): Promise<FriendRequestStatus>;
  changeRelationship(relationship: FriendshipSummary, action: FriendshipAction, signal: AbortSignal): Promise<void>;
  getFriendProfile(userId: string, signal: AbortSignal): Promise<SocialProfile>;
}

export class SocialError extends Error {
  constructor(readonly code: 'invalid_input' | 'invalid_response' | 'request_failed' | 'unavailable' | 'stale' | 'busy'
    | 'consent_changed' | 'publication_changed' | 'flight_not_ready' | 'profile_required' | 'account_deleting', message: string) {
    super(message);
    this.name = 'SocialError';
  }
}

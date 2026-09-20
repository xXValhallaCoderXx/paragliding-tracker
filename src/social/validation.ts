import { SocialError, type FriendRequestStatus, type FriendshipSummary, type SocialProfile, type SocialState } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (): never => { throw new SocialError('invalid_response', 'Friends returned an unexpected response. Try refreshing.'); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid();
  return value;
}
function displayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > 60) return invalid();
  return value;
}
export function normalizeSocialName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || Array.from(normalized).length > 60) {
    throw new SocialError('invalid_input', 'Use a display name between 1 and 60 characters.');
  }
  return normalized;
}
export function normalizeInviteCode(value: string): string {
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{12}$/.test(normalized)) {
    throw new SocialError('invalid_input', 'Enter the 12-character invite code.');
  }
  return normalized;
}
export function parseInviteCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]{12}$/.test(value)) return invalid();
  return value;
}
export function parseSocialProfile(value: unknown): SocialProfile {
  const profile = object(value);
  if (!Number.isSafeInteger(profile.backedUpFlightCount) || (profile.backedUpFlightCount as number) < 0) return invalid();
  return { userId: identifier(profile.userId), displayName: displayName(profile.displayName), backedUpFlightCount: profile.backedUpFlightCount as number };
}
export function parseSocialState(value: unknown): SocialState {
  const state = object(value);
  if (!Array.isArray(state.relationships)) return invalid();
  const relationships = state.relationships.map((item): FriendshipSummary => {
    const row = object(item);
    if (!['incoming', 'outgoing', 'accepted', 'blocked'].includes(String(row.state))) return invalid();
    return { id: identifier(row.id), userId: identifier(row.userId), displayName: displayName(row.displayName), state: row.state as FriendshipSummary['state'] };
  });
  if (new Set(relationships.map(row => row.userId)).size !== relationships.length ||
      new Set(relationships.map(row => row.id)).size !== relationships.length) return invalid();
  return { profile: state.profile === null ? null : parseSocialProfile(state.profile),
    inviteCode: state.inviteCode === null ? null : parseInviteCode(state.inviteCode), relationships };
}
export function parseFriendRequest(value: unknown): FriendRequestStatus {
  const status = object(value).status;
  if (!['sent', 'incoming', 'outgoing', 'accepted', 'unavailable', 'rate_limited'].includes(String(status))) return invalid();
  return status as FriendRequestStatus;
}
export function assertSocialUserId(value: string): void {
  if (!UUID.test(value)) throw new SocialError('invalid_input', 'This friend is unavailable. Refresh Friends and try again.');
}

import { SocialError, type FriendRequestStatus, type FriendshipSummary, type OwnSocialProfile, type PilotSearchCursor, type PilotSearchPage, type PilotSearchResult, type SaveSocialProfileInput, type SocialProfile, type SocialState } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9_]{3,24}$/;
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
function username(value: unknown): string {
  if (typeof value !== 'string' || !USERNAME.test(value)) return invalid();
  return value;
}
export function normalizeSocialUsername(value: string): string {
  const normalized = value.trim().replace(/^@/, '').toLowerCase();
  if (!USERNAME.test(normalized)) throw new SocialError('invalid_input', 'Use a username of 3–24 letters, numbers or underscores.');
  return normalized;
}
export function normalizeSocialProfile(input: SaveSocialProfileInput): SaveSocialProfileInput {
  if (typeof input.discoverable !== 'boolean') throw new SocialError('invalid_input', 'Choose whether pilots can find your profile.');
  return { displayName: normalizeSocialName(input.displayName), username: normalizeSocialUsername(input.username), discoverable: input.discoverable };
}
export function normalizePilotQuery(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  const length = Array.from(normalized.replace(/^@/, '')).length;
  if (length < 2 || length > 60) throw new SocialError('invalid_input', 'Search with 2–60 characters.');
  return normalized;
}
export function parseSocialProfile(value: unknown): SocialProfile {
  const profile = object(value);
  if (!Number.isSafeInteger(profile.backedUpFlightCount) || (profile.backedUpFlightCount as number) < 0) return invalid();
  return { userId: identifier(profile.userId), displayName: displayName(profile.displayName),
    username: profile.username === null ? null : username(profile.username), backedUpFlightCount: profile.backedUpFlightCount as number };
}
function parseOwnSocialProfile(value: unknown): OwnSocialProfile {
  const profile = object(value);
  if (typeof profile.discoverable !== 'boolean') return invalid();
  return { ...parseSocialProfile(profile), discoverable: profile.discoverable };
}
export function parseSocialState(value: unknown): SocialState {
  const state = object(value);
  if (!Array.isArray(state.relationships)) return invalid();
  const relationships = state.relationships.map((item): FriendshipSummary => {
    const row = object(item);
    if (!['incoming', 'outgoing', 'accepted', 'blocked'].includes(String(row.state))) return invalid();
    return { id: identifier(row.id), userId: identifier(row.userId), displayName: displayName(row.displayName),
      username: row.username === null ? null : username(row.username), state: row.state as FriendshipSummary['state'] };
  });
  if (new Set(relationships.map(row => row.userId)).size !== relationships.length ||
      new Set(relationships.map(row => row.id)).size !== relationships.length) return invalid();
  return { profile: state.profile === null ? null : parseOwnSocialProfile(state.profile), relationships };
}
function parsePilotSearchCursor(value: unknown, query: string): PilotSearchCursor {
  const row = object(value);
  if (row.query !== query || (row.rank !== 0 && row.rank !== 1)) return invalid();
  const cursor: PilotSearchCursor = { query, rank: row.rank, username: username(row.username), userId: identifier(row.userId) };
  if (cursor.rank !== (cursor.username === query.replace(/^@/, '') ? 0 : 1)) return invalid();
  return cursor;
}
export function validatePilotSearchCursor(value: PilotSearchCursor, query: string): PilotSearchCursor {
  try { return parsePilotSearchCursor(value, query); }
  catch { throw new SocialError('invalid_input', 'This search changed. Search again from the first page.'); }
}
export function parsePilotSearchPage(value: unknown, query: string): PilotSearchPage {
  const page = object(value);
  if (!['ok', 'rate_limited'].includes(String(page.status)) || !Array.isArray(page.items) || page.items.length > 20) return invalid();
  const items = page.items.map((value): PilotSearchResult => {
    const row = object(value);
    if (!['none', 'incoming', 'outgoing', 'accepted'].includes(String(row.relationshipState))) return invalid();
    const relationshipId = row.relationshipId === null ? null : identifier(row.relationshipId);
    if ((row.relationshipState === 'none') !== (relationshipId === null)) return invalid();
    return { userId: identifier(row.userId), displayName: displayName(row.displayName), username: username(row.username),
      relationshipId, relationshipState: row.relationshipState as PilotSearchResult['relationshipState'] };
  });
  if (new Set(items.map(row => row.userId)).size !== items.length || new Set(items.map(row => row.username)).size !== items.length) return invalid();
  const nextCursor = page.nextCursor === null ? null : parsePilotSearchCursor(page.nextCursor, query);
  if (nextCursor && (!items.length || nextCursor.userId !== items.at(-1)!.userId || nextCursor.username !== items.at(-1)!.username)) return invalid();
  if (page.status === 'rate_limited' && (items.length || nextCursor)) return invalid();
  return { status: page.status as PilotSearchPage['status'], items, nextCursor };
}
export function parseFriendRequest(value: unknown): FriendRequestStatus {
  const status = object(value).status;
  if (!['sent', 'incoming', 'outgoing', 'accepted', 'unavailable', 'rate_limited'].includes(String(status))) return invalid();
  return status as FriendRequestStatus;
}
export function assertSocialUserId(value: string): void {
  if (!UUID.test(value)) throw new SocialError('invalid_input', 'This friend is unavailable. Refresh Friends and try again.');
}

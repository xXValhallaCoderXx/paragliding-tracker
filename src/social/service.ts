import type { FriendshipAction, FriendshipSummary, SocialService } from './types';
import { SocialError } from './types';
import { assertSocialUserId, normalizePilotQuery, normalizeSocialProfile, parseFriendRequest, parsePilotSearchPage, parseSocialProfile, parseSocialState, validatePilotSearchCursor } from './validation';

export type SocialRpcRequest =
  | { name: 'social_get_state'; args?: undefined }
  | { name: 'social_save_profile'; args: { p_display_name: string; p_username: string; p_discoverable: boolean } }
  | { name: 'social_search_pilots'; args: { p_query: string; p_cursor: { query: string; rank: 0 | 1; username: string; userId: string } | null } }
  | { name: 'social_request_pilot'; args: { p_user_id: string } }
  | { name: 'social_block_pilot'; args: { p_user_id: string } }
  | { name: 'social_change_relationship'; args: { p_other_user_id: string; p_action: FriendshipAction; p_request_id?: string } }
  | { name: 'social_get_friend_profile'; args: { p_user_id: string } };
export type SocialRpc = (request: SocialRpcRequest, signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;

/** A pure service until a method dispatches an RPC; transport is injected. */
export function createSocialService(rpc: SocialRpc): SocialService {
  async function call(request: SocialRpcRequest, signal: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    try {
      if (signal.aborted) throw new SocialError('stale', 'Friends changed while this request was running. Try again.');
      const result = await rpc(request, controller.signal);
      if (signal.aborted) throw new SocialError('stale', 'Friends changed while this request was running. Try again.');
      const code = result.error && typeof result.error === 'object' && 'code' in result.error ? result.error.code : null;
      if (request.name === 'social_save_profile' && code === '23505') {
        throw new SocialError('invalid_input', 'That username is already taken. Choose another username.');
      }
      if (request.name === 'social_get_friend_profile' && code === '42501') {
        throw new SocialError('unavailable', 'This profile is no longer available. Refresh Friends.');
      }
      if (code === '42501') throw new SocialError('unavailable', 'This pilot or Friends action is no longer available. Refresh Friends.');
      if (code === 'PGRST202') throw new SocialError('unavailable', 'Friends is not available on this server yet. Try again later.');
      if (result.error || controller.signal.aborted) throw new SocialError('request_failed', 'Could not reach Friends. Check your connection and try again.');
      return result.data;
    } catch (error) {
      if (signal.aborted) throw new SocialError('stale', 'Friends changed while this request was running. Try again.');
      if (error instanceof SocialError) throw error;
      throw new SocialError('request_failed', 'Could not reach Friends. Check your connection and try again.');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  return {
    getState: async signal => parseSocialState(await call({ name: 'social_get_state' }, signal)),
    saveProfile: async (input, signal) => {
      const profile = normalizeSocialProfile(input);
      await call({ name: 'social_save_profile', args: { p_display_name: profile.displayName, p_username: profile.username, p_discoverable: profile.discoverable } }, signal);
    },
    requestPilot: async (userId, signal) => {
      assertSocialUserId(userId);
      return parseFriendRequest(await call({ name: 'social_request_pilot', args: { p_user_id: userId } }, signal));
    },
    blockPilot: async (userId, signal) => {
      assertSocialUserId(userId);
      await call({ name: 'social_block_pilot', args: { p_user_id: userId } }, signal);
    },
    searchPilots: async (query, cursor, signal) => {
      const normalized = normalizePilotQuery(query);
      return parsePilotSearchPage(await call({ name: 'social_search_pilots', args: {
        p_query: normalized, p_cursor: cursor === null ? null : validatePilotSearchCursor(cursor, normalized),
      } }, signal), normalized);
    },
    changeRelationship: async (relationship: FriendshipSummary, action: FriendshipAction, signal) => {
      assertSocialUserId(relationship.userId);
      assertSocialUserId(relationship.id);
      await call({ name: 'social_change_relationship', args: { p_other_user_id: relationship.userId, p_action: action,
        ...(['accept', 'decline', 'cancel', 'remove'].includes(action) ? { p_request_id: relationship.id } : {}),
      } }, signal);
    },
    getFriendProfile: async (userId, signal) => {
      assertSocialUserId(userId);
      const profile = parseSocialProfile(await call({ name: 'social_get_friend_profile', args: { p_user_id: userId } }, signal));
      if (profile.userId !== userId) throw new SocialError('invalid_response', 'This friend is unavailable. Refresh Friends and try again.');
      return profile;
    },
  };
}

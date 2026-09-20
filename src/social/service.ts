import type { FriendshipAction, FriendshipSummary, SocialService } from './types';
import { SocialError } from './types';
import { assertSocialUserId, normalizeInviteCode, normalizeSocialName, parseFriendRequest, parseInviteCode, parseSocialProfile, parseSocialState } from './validation';

export type SocialRpcRequest =
  | { name: 'social_get_state'; args?: undefined }
  | { name: 'social_save_profile'; args: { p_display_name: string } }
  | { name: 'social_rotate_invite_code'; args?: undefined }
  | { name: 'social_request_friend'; args: { p_code: string } }
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
      if (request.name === 'social_get_friend_profile' && code === '42501') {
        throw new SocialError('unavailable', 'This profile is no longer available. Refresh Friends.');
      }
      if (code === 'PGRST202') throw new SocialError('unavailable', 'Friends is not available on this server yet. Try again later.');
      if (result.error || controller.signal.aborted) throw new SocialError('request_failed', 'Could not reach Friends. Check your connection and try again.');
      return result.data;
    } catch (error) {
      if (error instanceof SocialError) throw error;
      throw new SocialError('request_failed', 'Could not reach Friends. Check your connection and try again.');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  return {
    getState: async signal => parseSocialState(await call({ name: 'social_get_state' }, signal)),
    saveProfile: async (displayName, signal) => { await call({ name: 'social_save_profile', args: { p_display_name: normalizeSocialName(displayName) } }, signal); },
    rotateInviteCode: async signal => parseInviteCode(await call({ name: 'social_rotate_invite_code' }, signal)),
    requestFriend: async (code, signal) => parseFriendRequest(await call({ name: 'social_request_friend', args: { p_code: normalizeInviteCode(code) } }, signal)),
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

import { createFeedService } from './feed-service';
import { MAX_SHARED_ARTIFACT_BYTES } from './feed-validation';
import { SocialError } from './types';

export const feedService = createFeedService({
  rpc: async (request, signal) => {
    const { getSupabase } = await import('@/cloud/supabase');
    if (request.name === 'social_list_feed') {
      return getSupabase().rpc(request.name, { p_limit: request.args.p_limit,
        ...(request.args.p_cursor_activity_id && request.args.p_cursor_published_at ? {
          p_cursor_activity_id: request.args.p_cursor_activity_id, p_cursor_published_at: request.args.p_cursor_published_at,
        } : {}) }).abortSignal(signal);
    }
    if (request.name === 'social_prepare_share') {
      // Generated SQL function types omit argument nullability. Manual publication
      // deliberately sends JSON null; the assertion changes no runtime value.
      return getSupabase().rpc(request.name, { ...request.args, p_consent_generation: request.args.p_consent_generation! }).abortSignal(signal);
    }
    if (request.name === 'social_list_kudos') {
      return getSupabase().rpc(request.name, { p_activity_id: request.args.p_activity_id, p_limit: request.args.p_limit,
        ...(request.args.p_cursor_created_at && request.args.p_cursor_id ? {
          p_cursor_created_at: request.args.p_cursor_created_at, p_cursor_id: request.args.p_cursor_id,
        } : {}) }).abortSignal(signal);
    }
    return getSupabase().rpc(request.name, request.args).abortSignal(signal);
  },
  edge: async (request, signal) => {
    const [{ getSupabase }, { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY }, Crypto] = await Promise.all([
      import('@/cloud/supabase'), import('@/cloud/config'), import('expo-crypto'),
    ]);
    const { data, error } = await getSupabase().auth.getSession();
    if (error || !data.session || signal.aborted) throw new SocialError('stale', 'Sign in again to use shared flights.');
    const owner = data.session.user.id;
    const response = await fetch(`${SUPABASE_URL}/functions/v1/shared-flight`, {
      method: 'POST', signal, headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (Number(response.headers.get('content-length')) > MAX_SHARED_ARTIFACT_BYTES) throw new SocialError('invalid_response', 'The shared route exceeds the supported size.');
    const body = await response.text();
    const byteCount = new TextEncoder().encode(body).byteLength;
    if (byteCount > MAX_SHARED_ARTIFACT_BYTES) throw new SocialError('invalid_response', 'The shared route exceeds the supported size.');
    const current = await getSupabase().auth.getSession();
    if (signal.aborted || current.data.session?.user.id !== owner) throw new SocialError('stale', 'Your account changed. Open Friends again.');
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw new SocialError('request_failed', 'Shared flights did not respond. Try again.'); }
    if (!response.ok) return { data: null, error: { ...(parsed && typeof parsed === 'object' ? parsed : {}), status: response.status } };
    return { data: parsed, error: null, ...(request.action === 'read' ? { byteCount, sha256: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, body) } : {}) };
  },
});

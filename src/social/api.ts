import { createSocialService } from './service';

/** Loading this module never creates a client or opens a native session. */
export const socialService = createSocialService(async (request, signal) => {
  const { getSupabase } = await import('@/cloud/supabase');
  return getSupabase().rpc(request.name, request.args).abortSignal(signal);
});

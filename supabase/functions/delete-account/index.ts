// Account deletion.
//
// Required by App Store Guideline 5.1.1(v) and Google Play's data deletion policy: an
// app that lets people create an account must let them delete it from inside the app.
//
// This cannot be done from the client. Deleting an auth.users row needs the
// service_role key, which must never appear in the app bundle — so the work happens
// here, where the platform injects the key as an environment variable.
//
// Deployed with JWT verification ON (the default), and the caller is verified again
// below with their own token before anything is deleted.
//
// Note for the repo: this file is Deno, not React Native. It is excluded from
// tsconfig.json's `include` and from eslint's config, so `pnpm typecheck` and
// `pnpm lint` do not try to resolve `jsr:` specifiers or the `Deno` global.

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authorization = request.headers.get('Authorization');
  const accessToken = authorization?.replace(/^Bearer\s+/i, '');
  if (!accessToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  // The secret key (sb_secret_..., formerly service_role) is injected by the platform
  // and must never appear in the app bundle. The explicit override exists so a project
  // that has disabled the legacy JWT keys can supply one with
  // `supabase secrets set ACCOUNT_DELETION_SECRET_KEY=sb_secret_...`.
  const secretKey =
    Deno.env.get('ACCOUNT_DELETION_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secretKey) {
    return new Response(
      'Server misconfigured: no secret key available to this function.',
      { status: 500 },
    );
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, {
    auth: { persistSession: false },
  });

  // 1. Establish who is asking by validating their own access token. Never trust a user
  //    id from the request body: that would let anyone delete anyone. Passing the token
  //    to getUser() verifies it server-side, so no second client and no publishable key
  //    are needed here.
  const {
    data: { user },
    error: callerError,
  } = await admin.auth.getUser(accessToken);

  if (callerError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Storage has no foreign key to auth.users, so nothing cascades: the IGC objects
  //    have to be removed explicitly, and before the user row, so a failure here leaves
  //    an account that can still be deleted rather than orphaned files nobody can reach.
  let offset = 0;
  for (;;) {
    const { data: objects, error: listError } = await admin.storage
      .from('flight-igc')
      .list(user.id, { limit: 100, offset });
    if (listError) {
      return new Response(`Could not list stored files: ${listError.message}`, { status: 500 });
    }
    if (!objects || objects.length === 0) break;

    const { error: removeError } = await admin.storage
      .from('flight-igc')
      .remove(objects.map((object) => `${user.id}/${object.name}`));
    if (removeError) {
      return new Response(`Could not delete stored files: ${removeError.message}`, { status: 500 });
    }
    if (objects.length < 100) break;
    offset += objects.length;
  }

  // 3. public.profiles and public.flights cascade from auth.users.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return new Response(deleteError.message, { status: 500 });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

// Deployed with JWT verification ON; the handler also validates the caller's token.
// The platform injects the secret key. It must never enter the app bundle.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createDeleteAccountHandler } from './handler.ts';

Deno.serve(createDeleteAccountHandler({
  env: (name) => Deno.env.get(name),
  createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false } }),
}));

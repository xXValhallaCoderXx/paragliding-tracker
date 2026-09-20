// JWT verification stays enabled; the handler also verifies the caller token.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createSharedFlightHandler } from './handler.ts';

Deno.serve(createSharedFlightHandler({
  env: (name) => Deno.env.get(name),
  createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false } }),
}));

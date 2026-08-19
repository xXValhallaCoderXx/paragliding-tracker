/**
 * Cloud backup configuration.
 *
 * Pure and platform-free: the web bundle imports this too, so nothing here may
 * reach for a native module. `cloudConfigured` being false is a first-class UI
 * state, never a crash — that is what keeps `pnpm test` and all three
 * `expo export` targets green in a checkout with no .env.local.
 */

// Written as full static member expressions on purpose. babel-preset-expo only
// inlines `process.env.EXPO_PUBLIC_X` when it appears literally; destructuring
// `process.env` yields undefined at runtime. Both names below are therefore spelled
// out rather than looked up dynamically.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/**
 * The client-side key: `sb_publishable_...` on current projects.
 *
 * Supabase renamed the `anon` key to the publishable key; the legacy name is still
 * accepted here so an older project keeps working, and because the legacy JWT keys are
 * not fully retired until the end of 2026.
 *
 * Public by design — it ships inside the app bundle. Row level security is the only
 * thing protecting the data, which is why `supabase/migrations/*_cloud_rls.sql` has
 * pgTAP tests rather than being taken on trust.
 */
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const cloudConfigured = SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;

export const CLOUD_CONFIG = Object.freeze({
  igcBucket: 'flight-igc',
  /** Flights pushed per cycle. Keeps a first sync of a long logbook incremental. */
  pushBatchSize: 25,
  pullPageSize: 200,
  /** Non-manual triggers inside this window are throttled. */
  minimumSyncIntervalMs: 30_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 30 * 60_000,
  /** Supabase allows one OTP per address per 60 s. */
  otpResendCooldownMs: 60_000,
  /** Supabase OTP codes expire after 1 h. */
  otpExpiryMs: 60 * 60_000,
});

import { CLOUD_CONFIG } from './config';
import type {
  CloudAuthStatus,
  SyncBlockReason,
  SyncTrigger,
} from './types';

/**
 * Every decision the sync engine makes, as pure functions.
 *
 * Kept away from the network code so the rules that protect a recording in progress are
 * unit-testable in Node. Jest only collects `.ts` files, so nothing decision-shaped may
 * live in the engine or a component.
 */

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface SyncGateInput {
  configured: boolean;
  authStatus: CloudAuthStatus;
  sessionUserId: string | null;
  /** The account this device's logbook is already bound to, if any. */
  linkedUserId: string | null;
  recorderRecovering: boolean;
  /** Status of the one unfinished session, if there is one. */
  unfinishedSessionStatus: 'recording' | 'interrupted' | null;
  now: number;
  lastSyncAt: number | null;
  nextAttemptAt: number;
  trigger: SyncTrigger;
}

export type SyncGateDecision =
  | { run: true; bindTo: string | null }
  | { run: false; reason: SyncBlockReason };

/**
 * Whether a sync cycle may start.
 *
 * The order matters: the most fundamental reasons come first so the UI reports the real
 * cause rather than an incidental one (a signed-out pilot should be told they are signed
 * out, not that they are throttled).
 */
export function evaluateSyncGate(input: SyncGateInput): SyncGateDecision {
  if (!input.configured) return { run: false, reason: 'unconfigured' };
  if (input.authStatus !== 'signed_in' || input.sessionUserId === null) {
    return { run: false, reason: 'signed_out' };
  }
  if (input.linkedUserId !== null && input.linkedUserId !== input.sessionUserId) {
    // Another pilot's logbook is on this device. Uploading it into this account would
    // be a privacy failure, so do nothing and let the UI offer an explicit rebind.
    return { run: false, reason: 'account_mismatch' };
  }
  if (input.recorderRecovering) return { run: false, reason: 'recovering' };
  if (input.unfinishedSessionStatus === 'recording') {
    // Never compete with an active capture. Note that 'interrupted' does *not* block:
    // the phone is on the ground and probably back on signal, and that session's flight
    // is not 'completed' so the push query excludes it anyway.
    return { run: false, reason: 'recording' };
  }
  if (input.trigger !== 'manual' && input.now < input.nextAttemptAt) {
    return { run: false, reason: 'backoff' };
  }
  if (
    input.trigger !== 'manual' &&
    input.lastSyncAt !== null &&
    input.now - input.lastSyncAt < CLOUD_CONFIG.minimumSyncIntervalMs
  ) {
    // A manual tap always runs: if a pilot asks, something visible must happen.
    return { run: false, reason: 'throttled' };
  }
  return {
    run: true,
    // First sign-in claims the whole existing logbook, which needs no other code: every
    // flight lacks a sync-state row and is therefore already dirty.
    bindTo: input.linkedUserId === null ? input.sessionUserId : null,
  };
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

export interface LocalMetadata {
  title: string | null;
  site: string | null;
  notes: string | null;
  updatedAt: number;
}

export interface RemoteMetadata {
  title: string | null;
  site: string | null;
  notes: string | null;
  clientUpdatedAt: number;
}

/**
 * Last-write-wins on the client clock, applied as a whole record.
 *
 * Per-field merging is deliberately avoided: editing title and notes together and having
 * only one of them survive is worse than either side winning outright.
 *
 * A tie is a no-op, which is what stops the echo loop — a push bumps the server's own
 * `updated_at`, so the very next pull sees that row again with an equal client clock.
 */
export function resolveMetadataConflict(
  local: LocalMetadata,
  remote: RemoteMetadata,
): RemoteMetadata | null {
  if (remote.clientUpdatedAt <= local.updatedAt) return null;
  return remote;
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export interface BackoffResult {
  attemptCount: number;
  nextAttemptAt: number;
}

/**
 * Exponential backoff with jitter.
 *
 * `random` is injected rather than called directly so tests are deterministic, and so
 * this module stays pure — the same reason `now` is a parameter.
 */
export function nextBackoff(
  attemptCount: number,
  now: number,
  random: () => number,
): BackoffResult {
  const exponent = Math.max(0, attemptCount);
  const base = Math.min(
    CLOUD_CONFIG.backoffBaseMs * 2 ** exponent,
    CLOUD_CONFIG.backoffMaxMs,
  );
  // ±20 %, so a fleet of devices that all lost signal at once does not return in lockstep.
  const jitter = base * 0.2 * (random() * 2 - 1);
  return {
    attemptCount: attemptCount + 1,
    nextAttemptAt: Math.round(now + base + jitter),
  };
}

export type SyncErrorKind = 'retry' | 'fatal' | 'reauth';

interface ErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * How to react to a failed request.
 *
 * `fatal` exists so a single bad row cannot hot-loop forever: it is parked with a long
 * backoff and surfaced in the UI, rather than retried every 30 seconds until the pilot
 * notices their battery is gone.
 */
export function classifySyncError(error: unknown): SyncErrorKind {
  const candidate = (error ?? {}) as ErrorLike;
  const message = candidate.message ?? String(error);

  // A network failure surfaces as a bare TypeError from fetch with no status at all.
  if (/network request failed|fetch failed|failed to fetch|timeout|aborted/i.test(message)) {
    return 'retry';
  }

  const status = candidate.status;
  if (status === 401 || status === 403) return 'reauth';
  if (status === 429) return 'retry';
  if (status !== undefined && status >= 500) return 'retry';

  // PostgREST reports an RLS denial as 42501 rather than an HTTP 403.
  if (candidate.code === '42501' || candidate.code === 'PGRST301') return 'reauth';
  // 23xxx is the integrity-violation class: a constraint this row will never satisfy.
  if (typeof candidate.code === 'string' && candidate.code.startsWith('23')) return 'fatal';

  if (status !== undefined && status >= 400) return 'fatal';
  return 'retry';
}

// ---------------------------------------------------------------------------
// IGC upload
// ---------------------------------------------------------------------------

export interface IgcUploadCandidate {
  igcSha256: string | null;
  igcObjectPath?: string | null;
  metrics: { fixCount: number; quality: string } | null;
}

/**
 * Whether a flight's IGC file needs uploading.
 *
 * The IGC is deterministic given (session, fixes, pilot headers), so its SHA-256 is a
 * perfect content key: a flight uploads exactly once and re-uploads only when its bytes
 * actually change. A flight with no usable track has no IGC to build at all —
 * `buildUnsignedIgc` throws on zero eligible fixes.
 */
export function shouldUploadIgc(candidate: IgcUploadCandidate, freshSha256: string): boolean {
  if (!hasUsableTrack(candidate)) return false;
  return candidate.igcSha256 !== freshSha256 || !candidate.igcObjectPath;
}

export function hasUsableTrack(candidate: IgcUploadCandidate): boolean {
  const metrics = candidate.metrics;
  return metrics !== null && metrics.fixCount > 0 && metrics.quality !== 'no_track';
}

/** `<user_id>/<flight_id>.igc` — the owner is the first segment, which is what the
 *  storage policies match on. */
export function igcObjectPath(userId: string, flightId: string): string {
  return `${userId}/${flightId}.igc`;
}

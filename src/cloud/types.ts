/**
 * Cloud backup domain vocabulary.
 *
 * Shared and platform-free, mirroring `src/recorder/types.ts`. Nothing here imports a
 * native module, so the web bundle can typecheck and build against it.
 */

export type CloudAuthStatus =
  /** Web. Cloud backup is a mobile-app feature, like the recorder itself. */
  | 'unsupported'
  /** No EXPO_PUBLIC_SUPABASE_* in this build. A first-class UI state, never a crash. */
  | 'unconfigured'
  /** Reading a stored session off disk. */
  | 'restoring'
  | 'signed_out'
  | 'signed_in';

export interface AuthSnapshot {
  status: CloudAuthStatus;
  userId: string | null;
  email: string | null;
  lastError: CloudFailure | null;
}

export type CloudFailureCode =
  | 'not_configured'
  | 'unsupported_platform'
  | 'offline'
  | 'rate_limited'
  | 'invalid_code'
  | 'expired_code'
  | 'auth_error'
  | 'sync_error'
  | 'storage_error'
  | 'account_mismatch';

export interface CloudFailure {
  code: CloudFailureCode;
  message: string;
  occurredAt: number;
}

/** Mirrors `RecorderError` so both layers report failures the same way. */
export class CloudError extends Error {
  readonly code: CloudFailureCode;

  constructor(code: CloudFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CloudError';
    this.code = code;
  }
}

export function cloudFailure(
  code: CloudFailureCode,
  message: string,
  occurredAt: number,
): CloudFailure {
  return { code, message, occurredAt };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncTrigger = 'foreground' | 'logbook-focus' | 'manual' | 'post-save' | 'post-sign-in';

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'blocked';

export type SyncBlockReason =
  | 'unsupported'
  | 'unconfigured'
  | 'signed_out'
  /** This device's logbook is already backed up to a different account. */
  | 'account_mismatch'
  /** A flight is in progress. Never compete with the recorder. */
  | 'recording'
  | 'recovering'
  | 'backoff'
  | 'throttled';

export interface SyncSnapshot {
  phase: SyncPhase;
  blockedBy: SyncBlockReason | null;
  lastSyncAt: number | null;
  pendingFlights: number;
  pendingDeletions: number;
  /** Flights the account holds that this device does not. Counted, not downloaded. */
  cloudOnlyFlights: number;
  /**
   * `cloud_link.user_id`: the account this device is bound to, or null if it never has
   * been. Survives sign-out on purpose — it is how the logbook tells a pilot who simply
   * signed out apart from one who has never had an account, so signing out is not a
   * capacity cliff.
   */
  linkedUserId: string | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface CloudAuthService {
  getSnapshot(): AuthSnapshot;
  restore(): Promise<AuthSnapshot>;
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  subscribe(listener: (snapshot: AuthSnapshot) => void): () => void;
}

export interface CloudSyncEngine {
  getSnapshot(): SyncSnapshot;
  /**
   * Rebinds this device's logbook to `userId`, dropping every sync watermark so the
   * whole logbook re-claims into that account. Never touches a flight, session or
   * evidence row: changing accounts must not cost the pilot their logbook.
   */
  rebindTo(userId: string): Promise<void>;
  /**
   * Coalesces onto an in-flight cycle rather than queueing another one.
   *
   * `recorderRecovering` comes from the caller because it lives in React state
   * (`useRecorderLifecycle`), and the engine deliberately never imports the recorder
   * service — subscribing to it would start a 1 Hz poll.
   */
  requestSync(
    trigger: SyncTrigger,
    options?: { recorderRecovering?: boolean },
  ): Promise<SyncSnapshot>;
  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void;
}

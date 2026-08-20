import type { AuthError, Session } from '@supabase/supabase-js';

import { cloudConfigured } from './config';
import { normalizeEmail, normalizeOtpCode, otpErrorMessage } from './otp-policy';
import { getSupabase } from './supabase';
import {
  CloudError,
  cloudFailure,
  type AuthSnapshot,
  type CloudAuthService,
  type CloudFailureCode,
} from './types';

/**
 * Email one-time-code authentication.
 *
 * A domain service with no React in it, mirroring `recorderService`'s observable
 * singleton shape so the provider layer looks the same for both.
 *
 * Signing in is optional throughout: nothing here is on the recorder's path, and every
 * failure resolves to a snapshot the UI can render rather than an unhandled rejection.
 */

export function initialAuthSnapshot(): AuthSnapshot {
  return {
    status: cloudConfigured ? 'restoring' : 'unconfigured',
    userId: null,
    email: null,
    lastError: null,
  };
}

/**
 * Whether the server rejected the code itself, as opposed to failing for some other
 * reason. Only a rejection is worth retrying under a different OTP type — a network
 * failure or a rate limit would just fail again.
 */
function isOtpRejection(error: unknown): boolean {
  const code = (error as AuthError | undefined)?.code;
  return code === 'otp_expired' || code === 'validation_failed';
}

/** Network failures surface as a plain TypeError from fetch, with no code to switch on. */
function isOfflineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /network request failed|fetch failed|failed to fetch/i.test(message);
}

function failureCodeFor(error: AuthError): CloudFailureCode {
  switch (error.code) {
    case 'otp_expired':
      return 'expired_code';
    case 'validation_failed':
      return 'invalid_code';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rate_limited';
    default:
      return 'auth_error';
  }
}

function toCloudError(error: unknown, fallbackCode: CloudFailureCode): CloudError {
  if (error instanceof CloudError) return error;
  if (isOfflineError(error)) {
    return new CloudError('offline', 'No connection. Try again when you have signal.', {
      cause: error,
    });
  }
  const authError = error as AuthError;
  if (authError?.name === 'AuthApiError' || typeof authError?.code === 'string') {
    return new CloudError(
      failureCodeFor(authError),
      otpErrorMessage(authError.code, authError.message),
      { cause: error },
    );
  }
  return new CloudError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

class SupabaseAuthService implements CloudAuthService {
  private snapshot: AuthSnapshot = initialAuthSnapshot();
  private readonly listeners = new Set<(snapshot: AuthSnapshot) => void>();
  private subscribed = false;

  getSnapshot(): AuthSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<AuthSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private applySession(session: Session | null): void {
    this.update({
      status: session ? 'signed_in' : 'signed_out',
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
    });
  }

  private fail(error: unknown, fallbackCode: CloudFailureCode): never {
    const cloudError = toCloudError(error, fallbackCode);
    this.update({ lastError: cloudFailure(cloudError.code, cloudError.message, Date.now()) });
    throw cloudError;
  }

  subscribe(listener: (snapshot: AuthSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    this.ensureAuthStateSubscription();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureAuthStateSubscription(): void {
    if (this.subscribed || !cloudConfigured) return;
    this.subscribed = true;
    // Never await a supabase call inside this callback: it runs while auth-js holds its
    // internal lock, and awaiting another auth call there deadlocks the client. Push
    // state synchronously and let interested parties react to the snapshot instead.
    getSupabase().auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
  }

  async restore(): Promise<AuthSnapshot> {
    if (!cloudConfigured) {
      this.update({ status: 'unconfigured' });
      return this.snapshot;
    }
    try {
      const { data, error } = await getSupabase().auth.getSession();
      if (error) throw error;
      this.applySession(data.session);
    } catch (error) {
      // A stored session that cannot be read is not an error the pilot can act on —
      // it just means signed out. Nothing about the local logbook depends on it.
      this.update({ status: 'signed_out', userId: null, email: null });
      if (__DEV__) console.warn('Cloud session restore failed', error);
    }
    return this.snapshot;
  }

  async requestOtp(email: string): Promise<void> {
    try {
      const { error } = await getSupabase().auth.signInWithOtp({
        email: normalizeEmail(email),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      this.update({ lastError: null });
    } catch (error) {
      this.fail(error, 'auth_error');
    }
  }

  async verifyOtp(email: string, code: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const token = normalizeOtpCode(code);

    try {
      // 'email' is the type Supabase documents for the signInWithOtp flow, and it is
      // what an existing user's code verifies against.
      //
      // A brand-new address takes a different path server-side. That signInWithOtp with
      // shouldCreateUser sends the "Confirm signup" template rather than "Magic Link" is
      // now CONFIRMED, not suspected: a first-time sign-in on a real device produced the
      // stock Confirm-signup body, and Supabase documents it ("when signInWithOtp is used
      // with new users, the signup confirmation template is deployed"). Both templates
      // now live in supabase/templates/ and render {{ .Token }}.
      //
      // What is still unsettled is whether the resulting token verifies under 'email' or
      // only under 'signup'. It cannot be probed from outside: /auth/v1/verify checks the
      // token before the type, so a wrong type is indistinguishable from a wrong code.
      //
      // Getting this wrong would break every first-ever sign-up while working perfectly
      // for the developer's own already-existing account — so rather than guess, fall
      // back to 'signup' once. The cost is one extra request on a mistyped code; the
      // cost of being wrong is nobody can create an account.
      //
      // The __DEV__ warn below is the diagnostic: watch Metro during a first-time
      // sign-in. If it fires, the fallback is load-bearing and this comment should say
      // so permanently. If it never fires, the fallback is dead code and can go.
      const session = await this.verifyOtpAs(normalizedEmail, token, 'email').catch(
        async (firstError: unknown) => {
          if (!isOtpRejection(firstError)) throw firstError;
          if (__DEV__) {
            // If you see this on a real sign-in, type 'email' does NOT cover the
            // new-user path and the fallback is load-bearing. If you never see it,
            // the fallback is dead code and can be deleted.
            console.warn("[auth] verifyOtp type 'email' was rejected; retrying as 'signup'");
          }
          return this.verifyOtpAs(normalizedEmail, token, 'signup').catch(() => {
            // Report the original failure: for the overwhelmingly common case of a
            // mistyped code, "that code is not right" is the useful message.
            throw firstError;
          });
        },
      );
      this.update({ lastError: null });
      this.applySession(session);
    } catch (error) {
      this.fail(error, 'auth_error');
    }
  }

  private async verifyOtpAs(
    email: string,
    token: string,
    type: 'email' | 'signup',
  ): Promise<Session | null> {
    const { data, error } = await getSupabase().auth.verifyOtp({ email, token, type });
    if (error) throw error;
    return data.session;
  }

  async signOut(): Promise<void> {
    try {
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
    } catch (error) {
      // Even a failed sign-out must leave the app signed out locally: the stored
      // session is already gone in every case that matters, and refusing to sign out
      // because the network is down would trap the pilot.
      if (__DEV__) console.warn('Cloud sign-out failed', error);
    } finally {
      this.update({ status: 'signed_out', userId: null, email: null, lastError: null });
    }
  }

  async deleteAccount(): Promise<void> {
    try {
      const { error } = await getSupabase().functions.invoke('delete-account', { method: 'POST' });
      if (error) throw error;
    } catch (error) {
      // Never optimistically sign out here. If the server copy might still exist, the
      // pilot has to be able to try again.
      this.fail(error, 'auth_error');
    }
    await this.signOut();
  }
}

export const cloudAuthService: CloudAuthService = new SupabaseAuthService();

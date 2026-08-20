import { CLOUD_CONFIG, OTP_LENGTH } from './config';

/**
 * Pure state machine for the email one-time-code flow.
 *
 * Lives in its own `.ts` module so jest covers it — `testMatch` only picks up `.ts`,
 * so nothing decision-shaped may live in the `.tsx` card.
 */

export type OtpStage = 'email' | 'code';

export interface OtpState {
  stage: OtpStage;
  email: string;
  /** When the last code was sent, used for the 60 s resend cooldown and the 1 h expiry. */
  sentAt: number | null;
}

export const INITIAL_OTP_STATE: OtpState = Object.freeze({
  stage: 'email',
  email: '',
  sentAt: null,
});

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Deliberately permissive. The authoritative check is whether the code arrives; a
 * stricter regex would reject valid addresses and strand the pilot with no way in.
 * This only catches obvious typos before spending one of the 60 s send slots.
 */
export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 3 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/** Strips the spaces and dashes people paste in from an email client. */
export function normalizeOtpCode(value: string): string {
  return value.replace(/\D+/g, '').slice(0, OTP_LENGTH);
}

export function isCompleteOtpCode(value: string): boolean {
  return normalizeOtpCode(value).length === OTP_LENGTH;
}

export function canResend(state: OtpState, now: number): boolean {
  if (state.sentAt === null) return true;
  return now - state.sentAt >= CLOUD_CONFIG.otpResendCooldownMs;
}

export function resendCountdownSeconds(state: OtpState, now: number): number {
  if (state.sentAt === null) return 0;
  const remaining = state.sentAt + CLOUD_CONFIG.otpResendCooldownMs - now;
  return remaining <= 0 ? 0 : Math.ceil(remaining / 1000);
}

export function isCodeExpired(state: OtpState, now: number): boolean {
  if (state.sentAt === null) return false;
  return now - state.sentAt >= CLOUD_CONFIG.otpExpiryMs;
}

/** The helper line under the code field: countdown, or an invitation to resend. */
export function resendLabel(state: OtpState, now: number): string {
  const seconds = resendCountdownSeconds(state, now);
  return seconds > 0 ? `Resend code in ${seconds} s` : 'Send a new code';
}

/**
 * Maps Supabase auth error codes to copy a pilot can act on.
 *
 * Unknown codes fall back to the raw message rather than a generic apology: when
 * something new goes wrong, the actual text is more useful than "Something went wrong".
 */
export function otpErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'otp_expired':
      return 'That code has expired. Send a new one.';
    case 'otp_disabled':
      return 'Email sign-in is not enabled for this app yet.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many codes requested. Wait a minute and try again.';
    case 'validation_failed':
      return 'That code is not right. Check the email and try again.';
    case 'email_address_invalid':
      return 'That email address was rejected. Check it and try again.';
    default:
      return fallback;
  }
}

/**
 * Whether a failed verification should send the pilot back to the email step.
 *
 * It should not: a wrong digit is the common case, and clearing the email they just
 * typed would be actively hostile. Only an expired code changes the stage.
 */
export function stageAfterVerifyFailure(state: OtpState, code: string | undefined): OtpStage {
  return code === 'otp_expired' ? 'code' : state.stage;
}

import { CLOUD_CONFIG, OTP_LENGTH } from '../config';
import {
  canResend,
  isCodeExpired,
  isCompleteOtpCode,
  isValidEmail,
  normalizeEmail,
  normalizeOtpCode,
  otpErrorMessage,
  resendCountdownSeconds,
  resendLabel,
  stageAfterVerifyFailure,
  type OtpState,
} from '../otp-policy';

const SENT_AT = 1_760_000_000_000;
const state: OtpState = { stage: 'code', email: 'renate@example.com', sentAt: SENT_AT };

describe('email normalisation and validation', () => {
  it('trims and lowercases so the verify call matches the send call', () => {
    // Supabase matches the address exactly, so a stray capital would fail verification
    // with a confusing "invalid code" error.
    expect(normalizeEmail('  Renate@Example.COM ')).toBe('renate@example.com');
  });

  it('catches obvious typos without rejecting valid addresses', () => {
    expect(isValidEmail('renate@example.com')).toBe(true);
    expect(isValidEmail('a+tag@sub.example.co.uk')).toBe(true);
    expect(isValidEmail("o'brien@example.com")).toBe(true);

    expect(isValidEmail('renate')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('renate@example')).toBe(false);
    expect(isValidEmail('renate@@example.com')).toBe(false);
    expect(isValidEmail('renate @example.com')).toBe(false);
    expect(isValidEmail('renate@.com')).toBe(false);
    expect(isValidEmail('renate@example.')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('code normalisation', () => {
  it('accepts a code pasted with the spacing an email client added', () => {
    expect(normalizeOtpCode('1234 5678')).toBe('12345678');
    expect(normalizeOtpCode('1234-5678')).toBe('12345678');
    expect(normalizeOtpCode(' 1 2 3 4 5 6 7 8 ')).toBe('12345678');
  });

  it('drops anything that is not a digit and never exceeds the configured length', () => {
    expect(OTP_LENGTH).toBe(8);
    expect(normalizeOtpCode('12ab34cd56ef78gh90')).toBe('12345678');
    expect(isCompleteOtpCode('1234567')).toBe(false);
    expect(isCompleteOtpCode('12345678')).toBe(true);
    expect(isCompleteOtpCode('123456789')).toBe(true);
  });
});

describe('resend cooldown', () => {
  it('allows the first send immediately', () => {
    expect(canResend({ ...state, sentAt: null }, SENT_AT)).toBe(true);
    expect(resendCountdownSeconds({ ...state, sentAt: null }, SENT_AT)).toBe(0);
  });

  it('blocks until the 60 s window closes, inclusive of the boundary', () => {
    const cooldown = CLOUD_CONFIG.otpResendCooldownMs;
    expect(canResend(state, SENT_AT + cooldown - 1)).toBe(false);
    expect(canResend(state, SENT_AT + cooldown)).toBe(true);
    expect(canResend(state, SENT_AT + cooldown + 1)).toBe(true);
  });

  it('counts whole seconds down so the label never shows 0 while still blocked', () => {
    expect(resendCountdownSeconds(state, SENT_AT)).toBe(60);
    expect(resendCountdownSeconds(state, SENT_AT + 17_400)).toBe(43);
    expect(resendCountdownSeconds(state, SENT_AT + 59_999)).toBe(1);
    expect(resendCountdownSeconds(state, SENT_AT + 60_000)).toBe(0);
  });

  it('switches the label from countdown to invitation', () => {
    expect(resendLabel(state, SENT_AT + 17_400)).toBe('Resend code in 43 s');
    expect(resendLabel(state, SENT_AT + 60_000)).toBe('Send a new code');
  });
});

describe('code expiry', () => {
  it('expires exactly at the one hour boundary', () => {
    const expiry = CLOUD_CONFIG.otpExpiryMs;
    expect(isCodeExpired(state, SENT_AT + expiry - 1)).toBe(false);
    expect(isCodeExpired(state, SENT_AT + expiry)).toBe(true);
  });

  it('cannot expire before anything was sent', () => {
    expect(isCodeExpired({ ...state, sentAt: null }, SENT_AT + 10 * 60 * 60_000)).toBe(false);
  });
});

describe('error copy', () => {
  it('translates the codes a pilot can actually act on', () => {
    expect(otpErrorMessage('otp_expired', 'raw')).toMatch(/expired/i);
    expect(otpErrorMessage('over_email_send_rate_limit', 'raw')).toMatch(/Wait a minute/i);
    expect(otpErrorMessage('validation_failed', 'raw')).toMatch(/not right/i);
    expect(otpErrorMessage('otp_disabled', 'raw')).toMatch(/not enabled/i);
  });

  it('surfaces the raw message for anything unrecognised, rather than hiding it', () => {
    expect(otpErrorMessage('something_new', 'Network request failed')).toBe(
      'Network request failed',
    );
    expect(otpErrorMessage(undefined, 'Network request failed')).toBe('Network request failed');
  });
});

describe('stage after a failed verification', () => {
  it('keeps the pilot on the code step so their typed email is not thrown away', () => {
    expect(stageAfterVerifyFailure(state, 'validation_failed')).toBe('code');
    expect(stageAfterVerifyFailure(state, undefined)).toBe('code');
    expect(stageAfterVerifyFailure(state, 'otp_expired')).toBe('code');
  });
});

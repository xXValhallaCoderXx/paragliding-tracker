import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OTP_LENGTH } from '../config';

/**
 * Guards the defect that broke sign-in for every new pilot.
 *
 * `signInWithOtp({ shouldCreateUser: true })` makes Supabase send the "Confirm signup"
 * template — not "Magic Link" — whenever the address is new. The stock body of that
 * template contains {{ .ConfirmationURL }} and nothing else, so a first-time pilot
 * received a link and no code. The app has no callback route and is built with
 * detectSessionInUrl: false, so the link was unusable too.
 *
 * Nothing in TypeScript can catch that, because the templates live in Supabase. Keeping
 * them in the repo and asserting their shape here is the only thing standing between us
 * and a silent repeat. The dashboard is still where they get applied — see
 * supabase/config.toml — so treat a failure here as "the canonical copy drifted", and
 * re-paste both templates after fixing it.
 */

const TEMPLATES = join('supabase', 'templates');

const FILES = ['confirm-signup.html', 'magic-link.html'] as const;

function template(name: string): string {
  return readFileSync(join(TEMPLATES, name), 'utf8');
}

/** Strips the HTML comment block so the reasoning in it cannot satisfy an assertion. */
function body(name: string): string {
  return template(name).replace(/<!--[\s\S]*?-->/g, '');
}

describe('supabase email templates', () => {
  it.each(FILES)('%s renders the one-time code', (name) => {
    expect(body(name)).toContain('{{ .Token }}');
  });

  it.each(FILES)('%s never renders a confirmation URL', (name) => {
    // The whole defect in one assertion.
    expect(body(name)).not.toContain('{{ .ConfirmationURL }}');
    expect(body(name)).not.toContain('{{ .TokenHash }}');
  });

  it.each(FILES)('%s contains no link at all', (name) => {
    // Beyond being useless to this app, a link in a sign-in email gets pre-fetched by
    // corporate mail scanners, which burns the single-use token before the pilot reads it.
    expect(body(name)).not.toMatch(/<a[\s>]/i);
    expect(body(name)).not.toMatch(/https?:\/\//i);
  });

  it('both templates say the same thing', () => {
    // Signing up and signing in are one action to a pilot, and the two templates are
    // chosen by the server, not by us. If they diverge, half the pilots get the odd one.
    const [confirmation, magicLink] = FILES.map(body);
    expect(magicLink.trim()).toBe(confirmation.trim());
  });

  it('config.toml points at both templates', () => {
    const config = readFileSync(join('supabase', 'config.toml'), 'utf8');
    expect(config).toContain('[auth.email.template.confirmation]');
    expect(config).toContain('[auth.email.template.magic_link]');
    for (const name of FILES) expect(config).toContain(`supabase/templates/${name}`);
  });

  it('the OTP length in config matches what the app accepts', () => {
    // normalizeOtpCode() and isCompleteOtpCode() both use this same policy value.
    const config = readFileSync(join('supabase', 'config.toml'), 'utf8');
    expect(config).toMatch(new RegExp(`^otp_length = ${OTP_LENGTH}$`, 'm'));
  });
});

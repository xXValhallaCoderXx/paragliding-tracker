import { readFileSync } from 'node:fs';
import { OTP_LENGTH } from '../config';

const config = readFileSync('supabase/config.toml', 'utf8');

it.each([
  ['confirmation', 'confirm-signup.html'],
  ['magic_link', 'magic-link.html'],
])('%s delivers the code the app accepts, without a token-consuming link', (kind, file) => {
  // Supabase selects confirmation for new pilots and magic_link for returning pilots.
  const body = readFileSync(`supabase/templates/${file}`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  expect(body).toContain('{{ .Token }}');
  expect(body).not.toMatch(/\{\{\s*\.(ConfirmationURL|TokenHash)\s*\}\}|<a[\s>]|https?:\/\//i);
  expect(config).toContain(`[auth.email.template.${kind}]`);
  expect(config).toContain(`supabase/templates/${file}`);
  expect(config).toMatch(new RegExp(`^otp_length = ${OTP_LENGTH}$`, 'm'));
});

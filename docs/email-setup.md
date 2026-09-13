# Sign-in email setup: Namecheap → Resend → Supabase

One-time setup. Until all of it is done, `signInWithOtp` cannot deliver a code to anyone but
you, and sign-in is broken for every real pilot.

Substitute your own domain for `example.com` throughout.

## 1. Resend: add a sending subdomain

Dashboard → **Domains** → **Add Domain**.

Enter **`mail.example.com`**, not `example.com`. The subdomain is not cosmetic:

- Resend's verification includes an **MX record**. On the root domain that MX is what decides
  where your inbox mail goes, so putting Resend there would break receiving if you ever point
  the root at Proton, Fastmail or Google.
- A domain may hold only one `v=spf1` TXT record, so a root shared with another mail provider
  means merging SPF by hand. A subdomain gets its own.
- Sending reputation stays isolated from anything else the domain ever does.

Choose the region closest to your pilots. Resend then shows a **Records** tab with three
records generated for your domain — an `MX`, an SPF `TXT`, and a DKIM `TXT`. Leave that tab
open.

## 2. Namecheap: add the DNS records

Domain List → **Manage** → **Advanced DNS**.

> **First, check you are in the right zone.** Resend verifies `mail.example.com`, but the zone
> you edit at Namecheap is the *registered* domain, `example.com`. Adding the records to a
> different domain you happen to own is the classic failure: Resend sits on "pending" forever
> and reports no error, because from its side the records simply do not exist.

Resend's **Name** column is already relative to your registered domain — it shows `send.mail`
and `resend._domainkey.mail`, not the fully-qualified names. Paste those into Namecheap's
`Host` field **exactly as shown**. Do not append the domain: `send.mail.example.com` in the
Host field becomes `send.mail.example.com.example.com`, which never verifies.

The **Content** column is truncated in the UI (`p=MIGfMA[…]wIDAQAB`). Use Resend's copy button
on each row — a hand-typed DKIM key is silently wrong.

Namecheap splits these across **two different sections of the same page**, which is the part
that confuses everyone:

**Host Records** (the top section, `ADD NEW RECORD`) — the TXT records:

| Type | Host | Value |
| --- | --- | --- |
| `TXT Record` | `resend._domainkey.mail` | the DKIM `p=MIGfMA…` value |
| `TXT Record` | `send.mail` | the SPF `v=spf1 … ~all` value |
| `TXT Record` | `_dmarc` | `v=DMARC1; p=none;` (optional, recommended) |

**Mail Settings** (further down, its own table) — the MX record. Set the dropdown to
**Custom MX**, then fill the row: Host `send.mail`, Mail Server the value Resend shows —
`feedback-smtp.eu-west-1.amazonses.com` if you picked Ireland, or `us-east-1` / `sa-east-1` /
`ap-northeast-1` for the other three regions — Priority `10`, TTL Automatic. Copy it from
Resend rather than typing it; Namecheap rejects anything containing `<` or `>` as a
"possible XSS threat", so a placeholder pasted literally fails rather than being caught as a
mistake.

> **Check for existing email forwarding first.** Namecheap's Mail Settings is a single
> exclusive mode, and switching it to **Custom MX** replaces the root `MX` records with
> whatever is in that table. If the domain currently forwards mail — root `MX` pointing at
> `eforward1-5.registrar-servers.com`, root `TXT` containing
> `include:spf.efwd.registrar-servers.com` — those forwards stop the moment you save, with no
> warning. Re-add them by hand in the same table alongside the Resend row:
>
> | Host | Mail Server | Priority |
> | --- | --- | --- |
> | `@` | `eforward1.registrar-servers.com` | `10` |
> | `@` | `eforward2.registrar-servers.com` | `10` |
> | `@` | `eforward3.registrar-servers.com` | `10` |
> | `@` | `eforward4.registrar-servers.com` | `15` |
> | `@` | `eforward5.registrar-servers.com` | `20` |
> | `send.mail` | `feedback-smtp.eu-west-1.amazonses.com` (your region) | `10` |
>
> Confirm what is actually live before changing anything — the published records are the
> truth, not the dashboard:
>
> ```bash
> curl -s -H 'accept: application/dns-json' \
>   'https://cloudflare-dns.com/dns-query?name=example.com&type=MX' | python3 -m json.tool
> ```

Because the Resend MX host is `send.mail` rather than `@`, it does **not** affect mail
delivered to the root domain. Any existing website records — a `www` CNAME, a `@` URL
redirect, a `_railway-verify` TXT — are unrelated to mail and must be left alone.

Then **Save All Changes**. The two sections save independently; saving one does not save the
other.

**If Namecheap says "possible XSS threat"**, the value contains `<` or `>` — almost always a
placeholder from a guide pasted verbatim. Copy the real value from Resend.

**If Namecheap says "Failed to save record. Please try again."** it never says why. In order of
likelihood: the page's session expired (reload and retry — this fails every row at once); the
value has a trailing dot or space, which Namecheap rejects with exactly this message; or the
batch save is being flaky, in which case add and save **one row at a time** using the green ✓
on the row itself rather than **Save All Changes**.

Then confirm what actually published, rather than trusting the dashboard:

```bash
for r in resend._domainkey.mail.example.com:TXT send.mail.example.com:TXT \
         send.mail.example.com:MX _dmarc.example.com:TXT; do
  curl -s -H 'accept: application/dns-json' \
    "https://cloudflare-dns.com/dns-query?name=${r%%:*}&type=${r##*:}" \
    | python3 -c 'import sys,json;a=json.load(sys.stdin).get("Answer");print(a or "(none)")'
done
```

Back in Resend, click **I've added the records**. It usually verifies within ~15 minutes; DNS
can take up to 72 hours in the worst case.

## 3. Resend: create the API key

Dashboard → **API Keys** → **Create API Key**. Sending permission is enough; restrict it to
`mail.example.com` if offered. Copy the `re_...` value — it is shown once.

This is the SMTP **password**. It is a server-side secret and must never be an
`EXPO_PUBLIC_*` variable or land in `.env.local`. See `.env.example`.

## 4. Supabase: custom SMTP

Dashboard → **Authentication** → **Emails** → **SMTP Settings**. Enable custom SMTP and enter:

| Field | Value |
| --- | --- |
| Sender email | `no-reply@mail.example.com` (must be on the verified domain) |
| Sender name | `Flight Log` |
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` — the literal word, not your email |
| Password | the `re_...` API key |

These mirror `[auth.email.smtp]` in `supabase/config.toml`, which is the reviewable record of
what is set here. Hosted projects do not read that file.

## 5. Supabase: raise the email rate limit

**Easy to miss, and everything looks broken without it.** Supabase caps auth email at *2 per
hour*, and that cap stays after you configure SMTP — it is only *editable* once custom SMTP
exists.

Dashboard → **Authentication** → **Rate Limits** → emails per hour. Raise it to `30`, matching
`[auth.rate_limit] email_sent` in `supabase/config.toml`.

## 6. Supabase: paste both email templates

Dashboard → **Authentication** → **Emails** → **Templates**.

| Template | Paste from | Subject |
| --- | --- | --- |
| **Confirm signup** | `supabase/templates/confirm-signup.html` | `Your Flight Log sign-in code` |
| **Magic Link** | `supabase/templates/magic-link.html` | `Your Flight Log sign-in code` |

**Both.** `signInWithOtp` sends *Confirm signup* when the address is new and *Magic Link* when
it already exists, so doing only one leaves every first-time pilot with an unusable link and no
code — the exact bug this project already shipped once.

`src/cloud/__tests__/email-templates.test.ts` guards the repo copies. If it fails, the canonical
files drifted; fix them and re-paste.

## 7. Verify end to end

1. Sign in with an address **never used on this project** — a fresh one, not yours. This is the
   only way to exercise the *Confirm signup* path, and it is the path that was broken.
2. The email must show an 8-digit code and contain no link at all.
3. Enter it. The app reaches `signed_in`.
4. Watch Metro for `[auth] verifyOtp type 'email' was rejected; retrying as 'signup'`. If it
   appears, the fallback in `src/cloud/auth-service.native.ts` is load-bearing and its comment
   should say so permanently. If it never appears, that fallback is dead code and can go.
5. Repeat with the *same* address, now an existing user, to exercise *Magic Link*.
6. Resend's **Logs** tab shows every send, with bounces and rejections — check there first when
   a pilot reports no email.

## When something does not arrive

| Symptom | Cause |
| --- | --- |
| Account service unreachable while other sites work | Check the configured Supabase hostname and project status first. A paused project can stop resolving in DNS, so the request never reaches Auth or SMTP. Resume the existing project in Supabase; changing client keys does not repair this. |
| Resend shows nothing in Logs | Supabase never called it — SMTP settings wrong, or you are still on the built-in sender |
| `403` in Resend Logs | Sender address is not on a verified domain |
| Domain never verifies | Records went into the wrong zone — a different domain you also own — or the Host field has the domain appended twice. Check both; neither reports an error |
| Works for you, nobody else | Still on the built-in sender: it refuses to deliver to anyone outside the project team, on every plan |
| Code arrives, app says expired | Codes expire after `otp_expiry` (3600 s); resend cooldown is 60 s |
| "Too many codes requested" | Step 5 was skipped |

### Paused backend check

On 13 September 2026, the installed APK targeted the correct project,
`dqbmbkalksunxbjldxdo` (Paragliding Tracking), with its client key present. The
project reported `INACTIVE`; its hostname returned NXDOMAIN from public DNS and
could not resolve on the phone, while other services remained reachable. The
older app message, "No connection. Try again when you have signal.", incorrectly
suggested that phone connectivity was the only possible cause. Auth transport
errors now say that the account service could not be reached.

See [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
for the resume procedure. After resuming, verify `ACTIVE_HEALTHY`, DNS resolution,
and successful reads of Auth health/settings with the configured client key.
These checks establish service availability; the user must still request and
verify an email code to establish end-to-end sign-in and delivery.

The user completed email-code sign-in on the installed Android app after the
project resumed. Backup then exposed a separate deployment gap: the hosted
database lacked `profiles.registration_id`, which the APK writes and reads.
The pending migration was `20260820120000_profile_site_columns.sql`. Before
applying it, check its removal of `home_site` against existing data; the affected
project had no stored values in that column.

If sign-in works but backup fails, compare `supabase migration list` with the
checkout before changing Auth or SMTP settings. Verify a phone sync and its IGC
objects after schema repair; a successful sign-in alone does not verify backup.

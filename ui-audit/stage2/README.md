# Stage 2 implementation and verification

Scope: [PAR-47](https://linear.app/sentiment-hound/issue/PAR-47) and the sign-in slice of [PAR-66](https://linear.app/sentiment-hound/issue/PAR-66), design pages 9–12. See the [implementation contract](../../new-design/stage-2.md).

**Android acceptance is pending.** The user asked to stop ADB/phone work while away. No Stage 2 APK has been installed, no Stage 2 screenshot has been captured, and no real code has been requested or verified in this delivery. The initial read-only device listing preceded that instruction; there have been no further ADB calls. PAR-47 must remain open until the checks below pass; PAR-66 remains open for its wider scope.

## Local verification

Implementation commits: `6450e7e` and final source `9933e72` on `feature/ui-revamp-beta` (local only). Node `v24.16.0`. Logs contain synthetic test data only; the isolated database connection string is redacted. Compiled bundles/APKs/source maps stay under the ignored `.artifacts/stage2/` directory.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused auth/setup and Stage 1 regression suites | Passed: 8 suites / 113 tests | [Focused tests](logs/focused-tests.log) |
| Full Node 24 `pnpm test` | Passed in 75.2 seconds | [Full workflow](logs/full-verification.log) |
| TypeScript, ESLint, architecture checks | Passed; 3 architecture checks | Full workflow |
| Full Jest suite | Passed: 130 suites / 1,300 tests | Full workflow |
| Deno function tests | Passed: 71 tests | Full workflow |
| Isolated Supabase / pgTAP | Passed: 13 files / 469 tests; generated types match; cleaned up | Full workflow |
| Android export with source maps | Passed | [Android export](logs/android-export.log) |
| Isolated Stage 2 Android release | Passed: final build in 52 seconds | [Gradle release](logs/android-release.log) |
| Online Expo dependency recommendations | Exit 1: newer recommended Expo 57 / RN patch versions | [Dependency recommendations](logs/dependencies.log) |
| Installed SDK offline dependency check | Exit 0: reports up to date, with Expo's offline reliability caveat | [Offline check](logs/dependencies-installed-sdk.log) |
| `git diff --check` | Passed | Source commit |

`package.json` and `pnpm-lock.yaml` are unchanged from the Stage 1 base. The online dependency warning reflects newer patch recommendations, not an upgrade made by Stage 2. No dependencies were upgraded. The offline result does not replace the online warning.

- Focused behavior: explicit submission and formatted paste; duplicate/conflicting requests; 60-second resend/expiry; editable email changes; connection/invalid/expired/rate-limit failure recovery; late send/verification results after leaving; fresh form on re-entry; mounted form during an email-app round trip.
- Setup/provider regression: all authentication stages at 3/3, Android Back to Permissions, restoring/unconfigured local completion, no automatic completion after verification, explicit destinations through save success/failure/Retry/Continue without saving, destination consumption, and Review's original timestamps.
- Sign-in route/confirmation: Back/Not now/Android Back, route blur, pending/error/recording/account-mismatch backup states, explicit Pilot link, and Friends handoff with no automatic profile or preference writes. Full Stage 1 coverage is retained.

The mocked email-app/Back/keyboard tests verify component behavior and platform props. They do not establish native keyboard, accessibility or lifecycle acceptance.

## Source and build identity

[Build identity](build-identity.json) records source commit `9933e723ce745d7ae1c9bbd475a820f0903c79f7`, the APK and bundle hashes, preserved source maps, input hashes, and restoration of ordinary native configuration.

| Item | Value |
| --- | --- |
| QA app | Flight Log Stage 2 QA |
| Package / scheme | `com.xxvalhallacoderxx.xcmvp.stage2qa` / `xcmvp-stage2qa` |
| Version / target | `1.0.0-stage2-qa` / Android release, arm64-v8a |
| APK | `.artifacts/stage2/flight-log-stage2-20260927.apk` |
| APK SHA-256 | `c83b30373824e2b5139e4fb941857e60f3845d1452315fd8d7b98a1e72a19bbd` |
| APK / embedded bundle | Both match generated release outputs |
| Source-map parity | All 12 changed runtime files and all 242 mapped runtime files match the final source commit in both preserved maps |
| Manifest | INTERNET retained; `allowBackup=false`; named Stage 2 package, scheme and label verified |
| Device, screenshots, email delivery, TalkBack | Pending; no Stage 2 install or device activity |

See the [APK manifest extract](logs/apk-manifest.txt). Ordinary native configuration was restored to `com.xxvalhallacoderxx.xcmvp`, `xcmvp`, Flight Log Alpha, INTERNET present, and `allowBackup=false`; the original iOS script was preserved. No ordinary APK was built or installed. [Restoration readback](logs/ordinary-native-restoration.json).

## Hosted configuration, read-only

[Allowlisted OTP configuration](hosted-otp-config.json), captured with GET requests only, confirms the linked project has eight-digit codes, 3,600-second expiry, 60-second send frequency, email enabled, new accounts enabled, custom SMTP configured, and code tokens in both signup and magic-link templates without confirmation links. Credentials, SMTP secrets, template bodies and codes are excluded. This proves configuration only, not real delivery or sign-in.

## Pending Android acceptance

Use the named Stage 2 QA build and a dedicated QA email address with synthetic data. Keep the normal app and its data untouched. Enter codes directly on the phone; never record codes or credentials in screenshots, logs or issue evidence.

1. Record installed APK hash, implementation commit, device/Android version, screen dimensions and text scale. Check app name/package and INTERNET permission against build identity.
2. Fresh setup: optional Backup stays 3/3; local-only completion works; Back returns to Permissions; re-entry resets the form. Check restoring/unconfigured states with appropriate fixtures, keeping fixture evidence distinct from the configured release.
3. Fresh and returning accounts: real email delivery; formatted code paste; explicit Continue; resend countdown; address change; invalid/expired/rate-limit/offline recovery. Returning sign-in must keep existing Friends/discovery/sharing preferences. Verify connection recovery using network controls, not missing INTERNET.
4. Send/verify in progress: Back/Not now/Close review remains available; no automatic navigation after dismissal. Re-entering starts clean and rejects a conflicting request until the old one settles. Email-app round trip preserves the mounted form.
5. Keyboard: first-focus email and code inputs, visible/scrollable primary actions, Android Back dismissing the keyboard and then leaving. Check normal and enlarged text, long addresses, small screen, safe areas, TalkBack names/order/error announcements and focus after step changes.
6. Signed-in confirmation: pending/failed/recording-paused/account-mismatched backup states show actual status. Open Home finishes promptly without waiting for transfers; View backup opens existing Pilot controls; no implicit account rebind.
7. Optional Friends handoff: new profile fields remain blank until explicit edits and Create; existing profile/preferences survive. Check separate sharing consent. Capture only redacted/synthetic evidence with no codes.
8. Save failure fixtures: selected destination survives Retry and Continue without saving; Review dismissal returns to the original caller and retains original timestamps. Distinguish controlled fixtures from real storage failures.

Record named-build screenshots/results here and attach acceptance evidence to PAR-47. Close PAR-47 only after acceptance; record the sign-in slice on PAR-66 and keep PAR-66 open. Broader hosted account/release, recorder reliability, accessibility and postcard gates retain their existing owners.

## Linear delivery

Implementation/build comments and status readbacks are recorded in [Linear delivery](linear-delivery.json). PAR-47 and PAR-66 are **In Progress**, neither complete. Their PAR-40 parent, Design label and original design attachments remain. Moving to In Progress caused Linear's automatic current-cycle assignment; that automation was reversed immediately, and both cycle assignments were read back as null, matching the original state. No acceptance gate was closed.

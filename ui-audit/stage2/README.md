# Stage 2 implementation and verification

Scope: [PAR-47](https://linear.app/sentiment-hound/issue/PAR-47) and the sign-in slice of [PAR-66](https://linear.app/sentiment-hound/issue/PAR-66), design pages 9–12. See the [implementation contract](../../new-design/stage-2.md).

**Bounded Stage 2 Android acceptance passed on 27 September 2026.** The user resumed device testing after returning. The isolated QA build is installed on Samsung SM-S938B with a verified APK hash. Device checks found and fixed onboarding keyboard Back behavior. Real fresh and returning sign-in, wrong-code recovery, the email-app round trip, local-only completion, saved-session restoration, explicit Friends handoff, Review completion, enlarged email layout and a bounded TalkBack check passed. The user confirmed both live sign-in passes and clear TalkBack announcements. PAR-47 is Done; PAR-66 remains open for its wider scope.

## Local verification

Implementation commits: `6450e7e`, `9933e72`, keyboard Back fix `6a20639`, and final source `28890f2` on `feature/ui-revamp-beta` (local only). Node `v24.16.0`. Logs contain synthetic test data only; the isolated database connection string is redacted. Compiled bundles/APKs/source maps stay under the ignored `.artifacts/stage2/` directory.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused auth/setup and Stage 1 regression suites | Passed: 8 suites / 113 tests | [Focused tests](logs/focused-tests.log) |
| Full Node 24 `pnpm test` | Passed after device fixes in 66.1 seconds | [Final full workflow](logs/full-verification-device-fixes.log) |
| TypeScript, ESLint, architecture checks | Passed; 3 architecture checks | Full workflow |
| Full Jest suite | Passed: 130 suites / 1,301 tests | Full workflow |
| Deno function tests | Passed: 71 tests | Full workflow |
| Isolated Supabase / pgTAP | Passed: 13 files / 469 tests; generated types match; cleaned up | Full workflow |
| Initial Android export with source maps | Passed; final bundle also verified through build C | [Android export](logs/android-export.log) |
| Isolated Stage 2 Android release | Passed: final build C in 48 seconds | [Final Gradle release](logs/android-release-build-c.log) |
| Online Expo dependency recommendations | Exit 1: newer recommended Expo 57 / RN patch versions | [Dependency recommendations](logs/dependencies.log) |
| Installed SDK offline dependency check | Exit 0: reports up to date, with Expo's offline reliability caveat | [Offline check](logs/dependencies-installed-sdk.log) |
| `git diff --check` | Passed | Source commit |

`package.json` and `pnpm-lock.yaml` are unchanged from the Stage 1 base. The online dependency warning reflects newer patch recommendations, not an upgrade made by Stage 2. No dependencies were upgraded. The offline result does not replace the online warning.

- Focused behavior: explicit submission and formatted paste; duplicate/conflicting requests; 60-second resend/expiry; editable email changes; connection/invalid/expired/rate-limit failure recovery; late send/verification results after leaving; fresh form on re-entry; mounted form during an email-app round trip.
- Setup/provider regression: all authentication stages at 3/3, Android Back first dismissing the keyboard and then returning to Permissions, restoring/unconfigured local completion, no automatic completion after verification, explicit destinations through save success/failure/Retry/Continue without saving, destination consumption, and Review's original timestamps.
- Sign-in route/confirmation: Back/Not now/Android Back, route blur, pending/error/recording/account-mismatch backup states, explicit Pilot link, and Friends handoff with no automatic profile or preference writes. Full Stage 1 coverage is retained.

The mocked email-app/Back/keyboard tests verify component behavior and platform props. They do not establish native keyboard, accessibility or lifecycle acceptance.

## Source and build identity

[Build identity](build-identity.json) records final source commit `28890f2ff56f4e4247ff09888b6c16bfc7de8f13`, the APK and bundle hashes, preserved source maps, input hashes, and restoration of ordinary native configuration.

| Item | Value |
| --- | --- |
| QA app | Flight Log Stage 2 QA |
| Package / scheme | `com.xxvalhallacoderxx.xcmvp.stage2qa` / `xcmvp-stage2qa` |
| Version / target | `1.0.0-stage2-qa` / Android release, arm64-v8a |
| APK | `.artifacts/stage2/build-c/flight-log-stage2-20260927.apk` |
| APK SHA-256 | `8151839485aab2e5259450e4046fd41ca95405c5dc07e754eafb27311bd614f0` |
| APK / embedded bundle | Both match generated release outputs |
| Source-map parity | All 12 changed runtime files and all 242 mapped runtime files match the final source commit in both preserved maps |
| Manifest | INTERNET retained; `allowBackup=false`; named Stage 2 package, scheme and label verified |
| Device | Samsung SM-S938B, Android 16 / API 36, 1080 × 2340, density override 420 |
| Text scale | Baseline 0.9; email layout checked at 1.3; baseline restored |
| Email delivery / TalkBack | Real delivery and sign-in passed; bounded TalkBack focus/announcements check passed with user confirmation |

See the [APK manifest extract](logs/apk-manifest-build-c.txt). Ordinary native configuration was restored to `com.xxvalhallacoderxx.xcmvp`, `xcmvp`, Flight Log Alpha, INTERNET present, and `allowBackup=false`; the original iOS script was preserved. No ordinary APK was built or installed. [Restoration readback](logs/ordinary-native-restoration-device.json).

## Physical-device evidence

[Device identity](device-identity.json) records each installed hash. [Device results](device-results.json) separates builds, passes, the resolved finding and outstanding checks. Original [build A](build-a-identity.json) and keyboard-fix [build B](build-b-identity.json) artifacts/maps are retained separately from final build C.

| Check | Result / evidence |
| --- | --- |
| Optional Backup remains 3/3 | Passed: [fresh Backup](screens/02-backup-intro.png) |
| Local-only completion | Passed: [Home without sign-in](screens/06-local-only-home.png) |
| Dedicated Pilot route and keyboard | Passed: [Sign in](screens/07-pilot-sign-in.png), [email and action above keyboard](screens/08-pilot-email-keyboard.png) |
| Onboarding Android Back | Build A left the step with the keyboard open. Fixed in `6a20639`; build B [before Back](screens/11-build-b-keyboard-before-back.png) and [after first Back](screens/12-build-b-first-back.png) retain step 3/3 and the draft; the next Back returns to Permissions. |
| Dismissal/re-entry and Review close | Passed: [fresh form after re-entry](screens/13-build-b-reentry-blank.png); Close review returned to Settings. |
| Enlarged text and long email | Build C: [intro at 1.3](screens/14-build-c-enlarged-intro.png), [email and send action above keyboard after scrolling](screens/15-build-c-enlarged-email-keyboard.png). First Back retained the draft. |
| Real email and explicit verification | Passed: user confirmation and [Signed in](../../.artifacts/stage2/device-private/17-build-c-signed-in.png). |
| Optional Friends handoff | Passed: [blank explicit profile flow](screens/18-build-c-friends-opt-in.png); no profile created or preference changed. |
| TalkBack | Visible focus on the setup Back control; user confirmed clear announcements; existing service settings restored. [Record](talkback-check.json). |
| Already-signed-in Review | Stays 3/3 until action; Open Home navigated immediately. |
| Saved account session | Passed: [Pilot after cold launch](../../.artifacts/stage2/device-private/19-build-c-session-restored.png). |
| Preserving installed QA data | Updating from A to B to C retained the synthetic private name and completed setup; cold launch opened Home. |

The enlarged-text script reached and captured the email/action layout, then its later re-entry visibility assertion did not complete. Blank re-entry is separately verified at baseline text size; this is not recorded as a complete enlarged-text end-to-end pass. Earlier scroll attempts began inside the text input; the successful capture used the scroll margin. The purple floating overlay in screenshots belongs to the phone's existing Wispr accessibility service.

Screens 01–10 use build A, 11–13 use build B, and 14 onward use final build C. The invalid first scroll capture was discarded. No OTP values or credentials are retained. The ordinary app and its data are untouched.

## Hosted configuration, read-only

[Allowlisted OTP configuration](hosted-otp-config.json), captured with GET requests only, confirms the linked project has eight-digit codes, 3,600-second expiry, 60-second send frequency, email enabled, new accounts enabled, custom SMTP configured, and code tokens in both signup and magic-link templates without confirmation links. Credentials, SMTP secrets, template bodies and codes are excluded. This proves configuration only, not real delivery or sign-in.

## Acceptance coverage

Use the named Stage 2 QA build and the user-authorized dedicated email alias with synthetic data. Codes are entered directly on the phone and excluded from evidence.

| Behavior | Automated verification | Physical verification |
| --- | --- | --- |
| Local-only, restoring and unconfigured completion | Passed | Local-only passed in the configured release; restoring/unconfigured fixtures remain automated evidence |
| Explicit eight-digit verification, formatted paste | Passed | Real delivery and fresh-account verification passed; returning-account verification passed at 3/3 |
| Duplicate/conflicting requests and late results after dismissal | Passed | Back/Not now stays available; deliberate network-delay race fixtures are automated evidence |
| Resend timing, expiry, address change, offline/invalid/rate-limit recovery | Passed | User confirmed wrong-code rejection followed by a valid-code retry; expiry/rate-limit/offline fixtures remain automated evidence |
| Dismissal resets; temporary email-app switch preserves the mounted form | Passed | Blank re-entry passed; user confirmed the email-app round trip |
| Keyboard, Android Back, enlarged text | Passed component/route tests | Back fix passed; baseline email and primary action plus enlarged 1.3 layout checked |
| TalkBack | Native control labels and states retained | Visible focus on Back; user confirmed clear spoken announcements during bounded check |
| Separate Friends choice; no implicit profile/preferences/sharing writes | Passed | Explicit handoff showed blank display name and username, with Create disabled; no creation or preference action performed |
| Completion destinations, save failure, Retry, Continue without saving, Review history | Passed | Local-only Home, signed-in Home, Review close and final Finish review-to-Settings passed; storage failure fixtures/history assertions remain automated evidence |
| Actual backup status and account-binding behavior | Passed presentation/service coverage | Zero eligible flights after sign-in; existing Pilot controls and stored session verified; broader transfer/binding acceptance remains PAR-10/PAR-66 |

Returning-account sign-in, wrong-code recovery and the email-app round trip passed with user confirmation. [Signed in at 3/3](../../.artifacts/stage2/device-private/25-build-c-returning-signed-in.png) remained on screen until an explicit action. [Finish review](screens/26-build-c-finish-review-settings.png) returned to the original Settings caller. PAR-47 is Done after this bounded acceptance. PAR-66 stays open for backup/restoration/account editing/sign-out/deletion redesign. Cross-app accessibility, hosted release acceptance, recorder reliability and the postcard issue retain their existing owners.

See the [shareable device evidence packet](stage2-device-evidence.pdf). Its screenshots use synthetic data. Account-email screenshots are retained only under ignored `.artifacts/stage2/device-private/`; their local links and [hash manifest](private-evidence-manifest.json) support inspection without committing those images.

## Linear delivery

Acceptance comments, attachments and status readbacks are recorded in [Linear delivery](linear-delivery.json). **PAR-47 is Done**, with its three implementation checklist items checked. **PAR-66 remains In Progress** with the shared sign-in slice accepted and its wider scope open. The seven-page evidence packet is attached to both issues. Their PAR-40 parent, Design label and original design attachments remain.

Linear automatically assigned the current cycle again when PAR-47 moved to Done. That assignment was removed and read back as null; PAR-66 also retains its original null cycle. No wider owner gate was closed. Source/build commits and the evidence commit are local; no push or release publication was performed.

# Stage 2: optional backup and shared sign-in

Scope: [PAR-47](https://linear.app/sentiment-hound/issue/PAR-47) and the sign-in slice of [PAR-66](https://linear.app/sentiment-hound/issue/PAR-66). Design reference: the 27 September 2026 PAR-40 pack, original PDF pages 9–12 / HTML B1-09 through B1-12. Stage 1's theme, controls and navigation URLs remain the foundation.

## Implemented contract

- Pilot's Sign in action opens `/sign-in`. Setup uses the same component-local email/code form within Backup, always step 3/3. Continue verifies the eight-digit code; typing/pasting never submits it. A formatted paste is normalized before limiting to eight digits.
- Android Back first dismisses an open keyboard; the next Back returns to Permissions. The setup header Back returns directly to Permissions. Pilot Back/Not now returns to Pilot. Leaving or blurring the sign-in route, leaving Backup, or closing Review discards the unfinished form. Switching to an email app leaves the form mounted. Use a different email clears the code/error/countdown and makes the email editable.
- Each form owns email, code, stage, busy state, errors and the wall-clock countdown. Nothing persists an unfinished sign-in or cooldown. The account service rejects overlapping account requests across dismissal/re-entry; session restoration is deduplicated. A late verification may establish the requested stored account session, but cannot navigate or complete setup.
- Fields and address changes are disabled during requests; leaving remains possible. Send/verify failures retain input. Successful resend clears the obsolete code. The server remains authoritative after dismissal and for invalid, expired or rate-limited codes. Existing first-time-user verification fallback is retained.
- Checking a saved session and unconfigured builds have explicit states and local-only completion. Signed in is separate from actual backup status, using the existing sync presentation for pending flights/deletions, errors, recording pause and account mismatch. View backup in Pilot leads to the existing controls. Setup never waits for uploads/downloads and never rebinds an account.
- Disclosure covers email, private pilot details, summaries including notes, and IGC files containing coordinates. Raw sensor and diagnostic samples stay local. No completed-backup, nearby-pilot, guaranteed-autofill, or hidden-launch-point promise is made.
- Signed-in confirmation offers Open Home and a separate Set up Friends action. Friends opens the existing explicit profile flow at `/friends/manage`, including for an account that already has a profile. Signing in creates no Friends profile, copies no private name, changes no discoverability and enables no sharing. Existing preferences remain intact.
- Setup completion carries an explicit Home/Friends/Pilot/return destination through persistence failure, Retry and Continue without saving. Navigation consumes it once. Closing Review returns to its caller; completing Review preserves the original completion and acknowledgement history.

Backup/restoration controls, account switching, private pilot editing, sign-out and deletion redesigns remain later PAR-66 work. No database migration, backend change, SDK/dependency upgrade or recorder change is included. PAR-6 cross-app accessibility, PAR-10 hosted account acceptance and PAR-65 postcards retain their owners.

## Verification

See [Stage 2 evidence](../ui-audit/stage2/README.md) for commands, results, source/build identity and bounded Android acceptance. After returning, the user resumed phone testing and confirmed fresh/returning email sign-in, wrong-code recovery, the email-app round trip and clear TalkBack announcements. The shared form, optional Friends handoff, local-only completion, session restoration, keyboard/Back and completion routes were checked on the named QA build. Broader owner gates remain separate.

Versioned documentation reviewed before editing: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [SDK 57 Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/), React Native 0.86 [TextInput](https://reactnative.dev/docs/0.86/textinput) and [KeyboardAvoidingView](https://reactnative.dev/docs/0.86/keyboardavoidingview), [Keyboard](https://reactnative.dev/docs/0.86/keyboard) and [Modal](https://reactnative.dev/docs/0.86/modal). New route declarations were regenerated with the installed Expo CLI type generator; no cast bypasses typed routes.

## Isolated Android QA build

`FLIGHT_LOG_QA=stage2` selects **Flight Log Stage 2 QA**, package `com.xxvalhallacoderxx.xcmvp.stage2qa`, scheme `xcmvp-stage2qa`, version `1.0.0-stage2-qa`. This is separate from both the normal installation and Stage 1 QA. Stage 2 always retains INTERNET; the Stage 1 setup-only offline flag does not apply.

```sh
env -u FLIGHT_LOG_QA_OFFLINE FLIGHT_LOG_QA=stage2 pnpm exec expo prebuild --platform android --no-install
cd android
env -u FLIGHT_LOG_QA_OFFLINE FLIGHT_LOG_QA=stage2 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Copy the APK and both generated source maps into `.artifacts/stage2/` before restoring ordinary native configuration with `env -u FLIGHT_LOG_QA -u FLIGHT_LOG_QA_OFFLINE pnpm exec expo prebuild --platform android --no-install`. Preserve the repository's `expo start --ios` script if prebuild rewrites it. Do not install or reset the normal app for Stage 2 acceptance. Do not remove INTERNET to simulate offline behavior.

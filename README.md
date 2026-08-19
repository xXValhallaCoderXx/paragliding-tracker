# Flight Log Alpha

An Android-first Expo SDK 57 personal paragliding logbook. It records flights locally, preserves
raw GPS and pressure evidence, summarizes completed flights, and exports deterministic IGC files.

This is an internal test build. It is not a certified flight recorder and must never be the only
recorder carried on a flight.

## What is implemented

- Flight history (logbook), manual recording, and flight-detail screens using stable Stack
  navigation, restyled after the "field notebook" design; see
  [`docs/ui-design-implementation.md`](./docs/ui-design-implementation.md).
- Precise foreground and background location with an Android foreground service.
- A globally defined TaskManager location callback that writes directly to SQLite.
- A custom root entry point that registers the location task before Expo Router or any screen code.
- A repository-pinned Expo TaskManager 57.0.11 patch that keeps Android's synthetic headless timer guard
  alive until the native task event actually finishes.
- WAL-backed, foreign-keyed SQLite flight summaries, sessions, fixes, pressure samples, events,
  and export records.
- One-second barometer sampling while the JavaScript listener remains active.
- Evidence-based cold-launch recovery with Resume and Save Partial paths.
- Deterministic unsigned IGC and adjacent diagnostic JSON artifacts.
- Native share-sheet export and automated feasibility tests.
- A buildable unsupported-platform page on web.
- An optional pilot profile that works offline and fills the IGC pilot and glider headers.
- Optional email one-time-code sign-in and push-only cloud backup of flights and IGC files.

The personal alpha is intentionally narrow: it lists flights recorded on this device, derives a
small set of trustworthy track statistics, allows optional title/site/notes, and shows no map.
There are no imported or manually created flights. Deletion is permanent after confirmation. The
logbook's season card and the detail screen's one-line insight are computed only from flights
stored on this phone.

The UI fonts (Archivo, IBM Plex Mono) load at runtime through `expo-font`, so design changes do
not require a native rebuild.

Physical reliability is not established by the code or bundle checks. Follow
[`docs/iteration-1-feasibility.md`](./docs/iteration-1-feasibility.md) and record real-device
results before treating the recorder as reliable.

## Accounts and cloud backup

Signing in is **optional and never gates anything**. The recorder, the logbook and every export
work with no account and no signal — a login wall in front of a device that records in the air
would break the product, and App Store Guideline 5.1.1(v) forbids requiring registration for
features that do not need an account. There is deliberately no `Stack.Protected` in this app.

**Auth** is Supabase email one-time codes (`signInWithOtp` + `verifyOtp`). No magic links: email
clients pre-fetch and burn single-use links. No Apple or Google sign-in: those are third-party
logins, which would trigger Guideline 4.8's Sign-in-with-Apple obligation. Sessions persist in
`expo-sqlite/localStorage`, which costs no new dependency and no-ops on web.

**Backup is push-only.** The phone is the source of truth:

- Flight facts (status, timestamps, metrics, IGC references) are pushed and never pulled.
- Only `title`, `site` and `notes` merge back down, last-write-wins on the client clock.
- A deletion on this phone is pushed; a deletion elsewhere never removes local evidence.
- Raw fixes and pressure samples are never uploaded — the derived IGC file is the archive.
- A fresh install does **not** re-download flights. Cloud-only flights are counted and shown.

**Backup never competes with capture.** `evaluateSyncGate` refuses to run while a session is
recording, and the dirty-flight query independently excludes anything that is not a completed
session. No network call happens inside a database transaction, and auth token refresh is stopped
while the app is backgrounded so a long flight generates no auth traffic. Two independent tests
guard this: `src/cloud/__tests__/sync-plan.test.ts` and
`src/cloud/__tests__/module-boundaries.test.ts`.

### Layout

| Path | Role |
| --- | --- |
| `src/cloud/` | Domain layer: config, types, pure policy, Supabase client, auth service, sync engine. Imports `src/recorder`, never the reverse. |
| `src/features/account/` | The `/account` route's providers, presentation and components. |
| `src/recorder/sync-repository-core.ts` | Platform-free SQL and mappers for the v5 sync bookkeeping tables. |
| `supabase/migrations/` | Server schema, RLS policies and the IGC storage bucket. |
| `supabase/functions/delete-account/` | In-app account deletion (needs `service_role`, so it cannot be done from the client). |

### Setup

Copy `.env.example` to `.env.local` and fill in the two values from Supabase's Project Settings →
API: the project URL and the **publishable key** (`sb_publishable_...`, formerly called the anon
key). Both are public by design and ship inside the bundle — row level security is what protects
the data. The secret key is never needed by the app; the account-deletion Edge Function is the
only thing that uses one, and Supabase injects it there automatically.

Register the same variables as EAS environment variables too: EAS Build respects `.gitignore`, so
an ignored `.env.local` alone would produce a build with no backend. A build with no configuration
is a supported state — the account screen says backup is unavailable and everything else works.

```bash
pnpm dlx supabase@latest link --project-ref <ref>
pnpm db:push
pnpm fn:deploy
pnpm db:test      # pgTAP RLS regression tests
```

Two dashboard steps are easy to miss and both are required:

1. Edit the **Magic Link** email template to contain `{{ .Token }}`. Otherwise `signInWithOtp`
   sends a link, and pilots receive something they cannot use.
2. Configure **custom SMTP**. The built-in sender is capped at roughly two emails per hour, which
   makes even solo testing impossible.

### Before submitting to a store

- The app now collects email, precise background location, user content and a user ID, all linked
  to identity. Update the App Privacy answers and the Play Data safety form accordingly — Play's
  background-location review gets materially stricter once location is stored off-device.
- Publish a privacy policy and set `EXPO_PUBLIC_PRIVACY_POLICY_URL`; it must be reachable while
  signed out. Play also needs a web-accessible account-deletion URL declared in the console.
- In-app account deletion is implemented and required by Guideline 5.1.1(v).
- `ios.bundleIdentifier` is set; no Apple Developer console work is needed for email OTP.

## Local Android development from WSL2

Background location is unavailable in Expo Go. Use the Flight Log Alpha development app and keep
this checkout, Node, Java, the Android SDK, Gradle, and `adb` on the WSL/Linux side. Do not build
this checkout with Windows tools or move it under `/mnt/c`.

This workstation's WSL toolchain is installed under `$HOME` and targets the versions required by
Expo SDK 57: JDK 17, Android API 36, Build Tools 36.0.0, NDK 27.1.12297006, and CMake. A fresh WSL
shell loads it from `$HOME/.config/android-development/env.sh`.

### Connect the physical Android device

On the phone, enable Developer options and open **Wireless debugging**. Choose **Pair device with
pairing code**, then run the following in WSL. The pairing and connection ports shown by Android
are different:

```bash
adb pair PHONE_IP:PAIRING_PORT
adb connect PHONE_IP:CONNECTION_PORT
adb devices -l
```

Pairing is normally one-time. If the phone does not reconnect after Wi-Fi or WSL restarts, repeat
only `adb connect` with the current connection port.

### Build, install, and iterate

For the first local build, or after a native/configuration change:

```bash
pnpm android
```

That command generates the ignored `android/` project when needed, performs an incremental Gradle
build, installs it on the selected device, and starts Metro. If Metro is already running in another
terminal, avoid starting a second server:

```bash
pnpm android:no-bundler
```

This debug APK loads its JavaScript from Metro; it is ideal for feature iteration, but it is not the
standalone artifact for the long-duration evidence gate. Keep Metro running while using this build.
Before an endurance or termination/recovery trial, create a production-like internal APK with an
embedded bundle, then install it without Metro:

```bash
pnpm android:release
pnpm android:release:install
adb reverse --remove-all
```

The resulting artifact is `android/app/build/outputs/apk/release/app-release.apk`. Stop Metro before
the trial; the release APK must launch and record from its embedded JavaScript bundle.

For ordinary TypeScript, React, route, style, and recorder-logic changes, do not rebuild the APK.
Keep the installed development app and run Metro with Fast Refresh:

```bash
pnpm start:lan
```

If the phone cannot reach WSL's LAN address but wireless `adb` is connected, route Metro through
that connection instead:

```bash
adb reverse tcp:8081 tcp:8081
pnpm start
```

WSL mirrored networking is required for direct LAN access. If it is not active yet, or a firewall
blocks the phone, use the slower tunnel fallback:

```bash
pnpm start:tunnel
```

Rebuild only after changing native packages or patches, config plugins, Android permissions,
icons/splash configuration, or the Expo/React Native SDK. EAS remains useful for CI and shareable
or release builds, but it is not part of the daily Android development loop.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:deps
pnpm dlx expo-doctor@latest
pnpm exec expo export --platform android --output-dir dist/android
pnpm exec expo export --platform ios --output-dir dist/ios
pnpm exec expo export --platform web --output-dir dist/web
```

The web export is not cosmetic: it is what catches a shared component importing a platform-split
`.native` module, which would otherwise only fail at build time with a stack trace pointing at
expo-sqlite rather than at the offending import.

## References

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo Location 57](https://docs.expo.dev/versions/v57.0.0/sdk/location/)
- [Expo TaskManager 57](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/)
- [Expo SQLite 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Supabase Auth for React Native](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [App Store Review Guideline 4.8 and 5.1.1](https://developer.apple.com/app-store/review/guidelines/)
- [Iteration 1 evidence protocol](./docs/iteration-1-feasibility.md)
- [UI design implementation notes](./docs/ui-design-implementation.md)

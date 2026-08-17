# Flight Log Alpha

An Android-first Expo SDK 57 personal paragliding logbook. It records flights locally, preserves
raw GPS and pressure evidence, summarizes completed flights, and exports deterministic IGC files.

This is an internal test build. It is not a certified flight recorder and must never be the only
recorder carried on a flight.

## What is implemented

- Flight history, manual recording, and flight-detail screens using stable Stack navigation.
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

The personal alpha is intentionally narrow: it lists flights recorded on this device, derives a
small set of trustworthy track statistics, allows optional title/site/notes, and shows no map.
There are no imported or manually created flights, accounts, or cloud sync. Deletion is permanent
after confirmation.

Physical reliability is not established by the code or bundle checks. Follow
[`docs/iteration-1-feasibility.md`](./docs/iteration-1-feasibility.md) and record real-device
results before treating the recorder as reliable.

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

## References

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo Location 57](https://docs.expo.dev/versions/v57.0.0/sdk/location/)
- [Expo TaskManager 57](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/)
- [Expo SQLite 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Iteration 1 evidence protocol](./docs/iteration-1-feasibility.md)

# XC Recorder Lab

An Android-first Expo SDK 57 feasibility recorder for measuring six-hour background GPS,
pressure-sensor continuity, local persistence, interruption recovery, and deterministic export.

This is an internal test build. It is not a certified flight recorder and must never be the only
recorder carried on a flight.

## What is implemented

- One diagnostic Expo Router screen using stable Stack navigation.
- Precise foreground and background location with an Android foreground service.
- A globally defined TaskManager location callback that writes directly to SQLite.
- WAL-backed, foreign-keyed SQLite sessions, fixes, pressure samples, events, and export records.
- One-second barometer sampling while the JavaScript listener remains active.
- Cold-launch recovery with Resume and Finalize Partial paths.
- Deterministic unsigned IGC and adjacent diagnostic JSON artifacts.
- Native share-sheet export and automated feasibility tests.
- A buildable unsupported-platform page on web.

Physical reliability is not established by the code or bundle checks. Follow
[`docs/iteration-1-feasibility.md`](./docs/iteration-1-feasibility.md) and record real-device
results before choosing the iteration-two architecture.

## Development build

Background location is unavailable in Expo Go. The native dependencies and permission config in
this iteration require a new Android development build:

```bash
pnpm install
pnpm dlx eas-cli@latest build --platform android --profile development
```

Install that APK on the test phone, then start Metro from WSL2:

```bash
pnpm start
```

If LAN discovery fails:

```bash
pnpm exec expo start --tunnel
```

Ordinary TypeScript and style edits use Fast Refresh. Rebuild the development APK after changing
native packages, config plugins, permissions, icons, or the Expo SDK.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:deps
pnpm dlx expo-doctor@latest
pnpm exec expo export --platform android --output-dir dist/android
pnpm exec expo export --platform ios --output-dir dist/ios
```

## References

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Expo Location 57](https://docs.expo.dev/versions/v57.0.0/sdk/location/)
- [Expo TaskManager 57](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/)
- [Expo SQLite 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Iteration 1 evidence protocol](./docs/iteration-1-feasibility.md)

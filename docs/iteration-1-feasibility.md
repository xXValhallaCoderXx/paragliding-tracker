# Iteration 1 feasibility: Android-first XC recorder

Status as of 2026-08-16: implementation and automated checks complete; physical Android evidence
pending.

## Decision this iteration must support

Determine whether Expo SDK 57 can reliably capture, commit, recover, and export a six-hour
paragliding track on one physical Android phone. GPS and locked-screen pressure are evaluated
separately. No result in this report makes the app a sole safety, navigation, or scoring device.

The physical gate must be completed alongside an established flight recorder. Simulator results,
Metro uptime, and successful JavaScript bundles do not count as background-sensor evidence.

## Implemented architecture

- `expo-location` runs one `BestForNavigation` background task with a 1000 ms Android interval,
  zero distance threshold, no deferred batching, and a visible foreground-service notification.
- `killServiceOnDestroy` is false, but Recents removal remains a measured vendor behavior. Expo
  states that user termination stops background location and Android does not automatically
  restart it.
- The task is defined at JavaScript bundle-global scope and opens the SQLite repository directly;
  it does not depend on a mounted React tree.
- Every callback batch is handled in one awaited exclusive SQLite transaction. Fix inserts, the
  session sequence/last-fix checkpoint, and the callback accounting event commit or roll back
  together. Callback event IDs and fix source keys make redelivery idempotent.
- SQLite uses WAL, foreign keys, a single-unfinished-session constraint, bound parameters, and
  append-only fix, pressure, event, and export rows. Session lifecycle/checkpoint fields are the
  intentionally mutable portion.
- The visible screen polls persisted summaries. It never starts a competing foreground location
  subscription.
- The Expo Barometer listener requests one-second updates for the lifetime of the recording JS
  runtime. Expo documents the sensor API but gives no background-continuity guarantee; locked
  screen pressure is therefore an experiment.
- A cold launch with an unfinished session and no registered location task records an interruption
  and offers Resume or Finalize Partial. A still-registered task reopens as recording.
- Power state is recorded at start, end, and approximately every minute while recording.

Relevant SDK 57 contracts: [Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/),
[TaskManager](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/),
[Barometer](https://docs.expo.dev/versions/v57.0.0/sdk/barometer/), and
[SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

## Export contract

The `.igc` artifact is byte-deterministic and unsigned. Valid persisted fixes are ordered by source
timestamp and reduced to one fix per UTC second. B records use Expo's WGS84 ellipsoid GPS altitude;
pressure altitude is `00000` and `HFALPNIL` declares it unavailable. FXA is included as the B-record
extension. There is no security/G record, and the header identifies the file as diagnostic and
unsigned. It must not be represented as competition-valid.

The layout follows the January 2026 AL10 FAI technical specification listed on the
[FAI IGC specification page](https://www.fai.org/node/25026). Diagnostic JSON includes raw rows,
configuration, callback accounting, source-timestamp and pressure gaps, accuracy percentiles,
power readings, device/app metadata, reconciliation fields, and the IGC SHA-256. Exports use the
SDK 57 [File/Directory API](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/) and
[Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/).

Repeated export without new recorder data must produce identical bytes and SHA-256. Export-table
timestamps are intentionally excluded from the diagnostic payload so exporting does not mutate
its own input.

## Automated evidence

Run from the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:deps
pnpm dlx expo-doctor@latest
pnpm exec expo export --platform android --output-dir dist/android
pnpm exec expo export --platform ios --output-dir dist/ios
```

Current results:

| Check | Result | Evidence |
| --- | --- | --- |
| Strict TypeScript | Pass | `tsc --noEmit` on 2026-08-16 |
| Expo lint | Pass | No warnings or errors on 2026-08-16 |
| Jest / jest-expo | Pass | 6 suites, 19 tests on 2026-08-16 |
| Expo dependency validation | Pass | SDK 57 dependencies up to date on 2026-08-16 |
| Expo Doctor | Pass | 21/21 checks on 2026-08-16 |
| Android JS bundle | Pass | Hermes bundle exported to `dist/android` on 2026-08-16 |
| iOS JS bundle | Pass | Hermes bundle exported to `dist/ios`; compilation only, no reliability claim |
| Web static bundle | Pass | Unsupported-platform route exported to `dist/web` |
| Android development APK | In progress | [EAS build `f99f3ca6-ef6f-445a-b7a6-36a4346e039b`](https://expo.dev/accounts/xxvalhallacoderxx/projects/xc-mvp/builds/f99f3ca6-ef6f-445a-b7a6-36a4346e039b) |

Automated tests cover valid/invalid and repeated state actions, transactional callback insertion,
sequence ordering, callback/source deduplication, registered-versus-absent task recovery,
coordinate/hemisphere rounding, UTC rollover, negative altitude, a pinned IGC SHA-256, cadence and
accuracy statistics, row/B-record reconciliation, deterministic diagnostics, and permission,
location-service, barometer, task-error, and share-sheet UI notices.

## Physical Android protocol

### Test preparation

1. Create a new Android development APK after the dependency/config changes and install it on the
   named test phone. Record the EAS build URL/ID, phone model, Android version, app version, and
   firmware/build number below.
2. Disable OEM auto-cleaning for the app only if that is normal for the intended test population;
   record the exact setting. Do not hide battery optimization state—the app records and displays it.
3. Grant precise location and Allow all the time/background location. Confirm the persistent
   foreground-service notification appears after Arm.
4. Start with at least 90% battery for the six-hour run. Carry an established independent recorder.
5. For each run, Arm a fresh session, note UTC start/end, perform the scenario, Stop normally unless
   the scenario explicitly calls for termination, then export both artifacts.

### Sequence

| Run | Procedure | Required observations |
| --- | --- | --- |
| Foreground smoke | 15 minutes outdoors with app visible and movement where practical | Crash/thermal state, fixes, pressure, notification, battery delta, max/p95 gaps |
| Locked-screen smoke | 15 minutes outdoors with screen locked | GPS and pressure counts before/after lock, gaps, notification, battery delta |
| Rehearsal | 2 hours; include app switching, an incoming call, airplane mode off/on, and reopening | Exact UTC event times, expected airplane-mode gap, recovery state, row survival |
| Endurance | 6 hours screen-locked, at least 1 hour moving outdoors | Start/end battery, crash/thermal state, p95/max GPS gaps, p95 accuracy, pressure continuity |
| Recents removal | Arm, collect fixes, remove from Recents, then cold launch | Vendor behavior, last committed counts, recording/interrupted state, Resume and export |
| Force-stop | Arm, collect fixes, force-stop in Android settings, then cold launch | No continuity expectation; all committed rows preserved; Finalize Partial and export work |

Airplane-mode and termination gaps are explained only when their UTC boundaries are written down
during the test. Do not classify any other gap over 15 seconds as explained after the fact.

### Export repeatability check

For each completed or finalized session:

1. Export IGC and diagnostics and retain both files.
2. Relaunch without resuming or modifying that session.
3. Export both again.
4. Compare byte size, SHA-256, persisted fix count, export-eligible seconds, IGC B-record count, and
   callback accounting. Both pairs must be byte-identical.

On a workstation, hashes can be compared with:

```bash
sha256sum first/*.igc second/*.igc first/*.json second/*.json
```

## Acceptance gate

Android GPS passes only when all conditions are true:

- The six-hour run has no crash, database corruption, or thermal shutdown.
- Starting at 90% battery or above leaves at least 30% on the test phone.
- Source-timestamp p95 gap is at most 5 seconds, with no unexplained gap over 15 seconds while
  location is available.
- Open-sky p95 horizontal accuracy is at most 30 metres.
- Callback accounting balances: every reported fix equals inserted + duplicate + invalid.
- Cold launch after termination preserves every committed row and offers the correct recording,
  Resume, or Finalize Partial path.
- IGC B-record count equals export-eligible UTC seconds.
- Repeated unchanged IGC and diagnostic exports are byte-identical with equal SHA-256 values.

Pressure passes only when the locked-screen smoke, rehearsal, and endurance artifacts show the
expected one-second cadence without suspension-sized gaps while GPS continues.

## Physical evidence record

Fill this table with artifact-backed results; do not replace Pending with an impression.

| Field | Result |
| --- | --- |
| Test phone / Android / firmware | Pending |
| Development build URL or ID | [EAS build `f99f3ca6-ef6f-445a-b7a6-36a4346e039b`](https://expo.dev/accounts/xxvalhallacoderxx/projects/xc-mvp/builds/f99f3ca6-ef6f-445a-b7a6-36a4346e039b) (submitted; artifact pending) |
| Foreground smoke | Pending |
| Locked-screen smoke | Pending |
| Two-hour rehearsal | Pending |
| Six-hour endurance | Pending |
| Start / end battery | Pending |
| GPS p95 / max gap | Pending |
| Open-sky accuracy p95 | Pending |
| Pressure p95 / max gap | Pending |
| Recents-removal behavior | Pending |
| Force-stop recovery and row counts | Pending |
| Callback accounting | Pending |
| Repeated IGC hashes / counts | Pending |
| Repeated JSON hashes / counts | Pending |

## Architecture recommendation

Current recommendation: keep this Expo implementation as a diagnostic test build only. Automated
and bundle success can establish implementation consistency, not six-hour operating-system
behavior. Do not start Kotlin or Swift in iteration 1, and do not promote this recorder until the
physical gate is complete.

After physical evidence:

- GPS and pressure pass: continue with Expo APIs and repeat the same gate on a physical iPhone.
- GPS passes but locked-screen pressure fails: retain Expo location/storage/export and implement a
  native pressure recorder in iteration 2.
- GPS cadence, persistence, or recovery fails: implement a native Android flight foreground service
  in iteration 2 and keep the platform-neutral TypeScript schema/export logic.
- Any result: preserve the exported artifacts and complete this report before architecture work
  proceeds.

## Exclusions

No XContest work, signing, upload, authentication, credential storage, backend, cloud sync, maps,
airspace, BLE, audio vario, automatic takeoff/landing, accounts, analytics, logbook, or competition
features are included. All data remains local until the tester deliberately invokes the share
sheet.

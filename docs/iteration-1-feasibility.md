# Iteration 1 capture feasibility inside Flight Log Alpha

Status as of 2026-08-17: implementation and automated checks complete; a predecessor-build
recovery smoke passed, while the current-artifact background, locked-screen, fault-injection,
rehearsal, and endurance evidence remains pending.

## Decision this iteration must support

Determine whether Expo SDK 57 can reliably capture, commit, recover, and export a six-hour
paragliding track on one physical Android phone. GPS and locked-screen pressure are evaluated
separately. No result in this report makes the app a sole safety, navigation, or scoring device.

The physical gate must be completed alongside an established flight recorder. Simulator results,
Metro uptime, and successful JavaScript bundles do not count as background-sensor evidence.

## Implemented architecture

- `expo-location` runs one `BestForNavigation` background task with a 1000 ms Android interval,
  zero distance threshold, no deferred batching, and a visible foreground-service notification.
- The Android manifest includes `RECEIVE_BOOT_COMPLETED`. Expo TaskManager 57 schedules its
  callback delivery job as persisted; omitting this permission crashes that job on the tested
  Samsung/Android build. This permission does not change the documented force-stop expectations.
- `killServiceOnDestroy` is false, but Recents removal remains a measured vendor behavior. Expo
  states that user termination stops background location and Android does not automatically
  restart it.
- A custom root entry point defines the task synchronously before Expo Router loads. The task then
  lazy-loads SQLite inside its executor, so headless registration does not depend on a mounted
  React tree or database-module initialization finishing first.
- Expo TaskManager 57.0.11 registers Android's synthetic headless keepalive with an immediately
  resolved promise. React Native consequently releases it before the real Expo task finishes and
  pauses JavaScript timers after the Activity backgrounds. A pinned pnpm patch keeps that promise
  pending so TaskManager's native `TaskService` remains the sole lifecycle owner. A physical
  app-switch trial exposed the upstream behavior; the formal background trials must use the patched
  release artifact recorded below.
- Every callback batch is handled in one awaited exclusive SQLite transaction. Fix inserts, the
  session sequence/last-fix checkpoint, and the callback accounting event commit or roll back
  together. Callback event IDs and fix source keys make redelivery idempotent.
- SQLite uses WAL, foreign keys, a single-unfinished-session constraint, bound parameters, and
  append-only fix, pressure, event, and export rows. Session lifecycle/checkpoint fields are the
  intentionally mutable portion.
- Schema v2 adds one user-facing flight for every recording session and versioned derived metrics.
  Schema v3 adds the transactional callback heartbeat and eligible-fix receipt index. Schema v4
  adds an immutable manual-stop boundary and typed recovery attempts with fixed deadlines,
  baseline sequences, and proving-fix references. Existing sessions are backed up,
  integrity-checked, and deterministically backfilled without rewriting raw capture rows.
- Flight history, recording, and detail screens read persisted summaries. They never start a
  competing foreground location subscription. Title, site, and notes are optional metadata layered
  over the immutable raw recording evidence.
- The Expo Barometer listener requests one-second updates for the lifetime of the recording JS
  runtime. Expo documents the sensor API but gives no background-continuity guarantee; locked
  screen pressure is therefore an experiment.
- TaskManager registration is control-plane evidence only. Recording health requires both a recent
  persisted callback and a recent valid, non-mocked fix. Snapshot polling is read-only; a separate
  serialized supervisor owns recovery so it cannot race Arm, Stop, Resume, or finalization.
- On launch or foreground, a healthy unfinished session continues. A stale session no more than 15
  minutes from its last valid fix (or start when it has no fix) gets one durable recovery claim and
  one controlled task restart. The fixed 20-second deadline and pre-restart sequence baseline
  survive process death. Only a non-mocked post-baseline fix received inside that original window
  can prove success; reopening observes the existing claim and never issues a second restart.
  Timeout or an older gap marks the session interrupted and offers Resume or Save Partial.
- Explicit Resume ignores the 15-minute automatic cutoff but still requires a new valid fix within
  20 seconds. Task registration alone never changes an interrupted session back to recording.
- A manual stop captures the press time and starts its first-wins database claim immediately,
  ahead of the serialized recovery/cleanup queue. Once committed it closes logical capture before
  any native teardown. That Stop is terminal: process death or native cleanup failure cannot return
  the session to recording, and cold recovery completes it as `stopped` at the stored boundary.
  Flight metrics and IGC use the same window, so a late callback cannot extend the flight.
- Save Partial uses the latest eligible GPS source timestamp captured at interruption, or the
  session start if no valid fix exists. The durable boundary prevents late callbacks from inflating
  the flight, while a captured manual-stop timestamp still takes precedence.
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
unsigned under the Flight Log Alpha name. The current IGC and diagnostics artifact versions are
both v2. It must not be represented as competition-valid.

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
pnpm exec expo export --platform web --output-dir dist/web
```

Current results:

| Check | Result | Evidence |
| --- | --- | --- |
| Strict TypeScript | Pass | `tsc --noEmit` on 2026-08-17 |
| Expo lint | Pass | No warnings or errors on 2026-08-17 |
| Jest / jest-expo | Pass | 14 suites, 85 tests on 2026-08-17 |
| Expo dependency validation | Pass | SDK 57 dependencies up to date on 2026-08-17 |
| Expo Doctor | Pass | 21/21 checks on 2026-08-17 |
| Android JS bundle | Pass | Hermes bundle exported to `dist/android` on 2026-08-17 |
| iOS JS bundle | Pass | Hermes bundle exported to `dist/ios`; compilation only, no reliability claim |
| Web static bundle | Pass | Unsupported-platform route exported to `dist/web` |
| Android internal release APK | Pass | Embedded `index.js` bundle, 111,165,091 bytes, SHA-256 `315de38d159a70bb604cc5dbb0dff3810d55a423c2ef18a93ec95525c6f58155` |

Automated tests cover valid/invalid and repeated state actions, transactional callback insertion,
sequence ordering, callback/source deduplication, active-versus-absent update recovery,
manual-stop boundaries, coordinate/hemisphere rounding, UTC rollover, negative altitude, a pinned
IGC SHA-256, flight metrics and quality classification, cadence and accuracy statistics,
row/B-record reconciliation, deterministic diagnostics, metadata/status normalization, and
permission, location-service, barometer, task-error, and share-sheet UI notices.
The bootstrap suite also locks the custom entry ordering and the SDK 57 Android headless-timer
patch so a dependency reinstall cannot silently restore the immediately completed keepalive.
Crash-boundary tests lock durable Stop-before-teardown and recovery claim-before-start ordering;
storage tests cover first-wins Stop, fixed deadline/baseline proof, attempt pairing, and v1/v2/v3
to v4 migration integrity.

## Physical Android protocol

### Test preparation

1. Create and install a production-like internal APK with an embedded JavaScript bundle on the
   named test phone. Do not use the Metro-dependent debug APK for acceptance evidence. Record its
   SHA-256, phone model, Android version, app version, and firmware/build number below.
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
| Force-stop | Arm, collect fixes, force-stop in Android settings, wait over 15 seconds, then cold launch | No fixes while force-stopped; committed rows preserved; one controlled same-session recovery when the last eligible fix is within 15 minutes, otherwise an interrupted flight with Resume / Save Partial |
| Stop crash boundary | Press Stop, terminate the process immediately after the durable stop marker, then cold launch | Original stop timestamp becomes `ended_at`; zero recovery starts; no late row changes metrics/IGC |
| Recovery crash boundary | Trigger stale recovery, terminate after its persisted attempt marker, then cold launch | Same attempt/deadline is reconciled; no second native restart; proof is inside its stored window or session fails closed |

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
| Test phone / Android / firmware | Samsung SM-S938B / Android 16 / `S938BXXSBCZG3` |
| Internal release build | Embedded-bundle APK installed on 2026-08-17; 111,165,091 bytes; SHA-256 `315de38d159a70bb604cc5dbb0dff3810d55a423c2ef18a93ec95525c6f58155`; internal debug certificate, not a distribution signing identity |
| Preliminary launch / recovery smoke | Predecessor artifact: same unfinished session recovered after a 17-second force-stop; visible fix count advanced from 82 to 100, both callback/fix ages returned to `just now`, and exactly one stop/start recovery occurred. Repeat on the current hash and formal exported row reconciliation Pending |
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

Current recommendation: use the user-facing flight log as a local alpha while keeping its capture
engine under the iteration 1 evidence gate. Automated and bundle success establish implementation
consistency, not six-hour operating-system behavior. Do not start Kotlin or Swift in iteration 1,
and do not promote the recorder as reliable until the physical gate is complete.

After physical evidence:

- GPS and pressure pass: continue with Expo APIs and repeat the same gate on a physical iPhone.
- GPS passes but locked-screen pressure fails: retain Expo location/storage/export and implement a
  native pressure recorder in iteration 2.
- GPS cadence, persistence, or recovery fails: implement a native Android flight foreground service
  in iteration 2 and keep the platform-neutral TypeScript schema/export logic.
- Any result: preserve the exported artifacts and complete this report before architecture work
  proceeds.

## Exclusions

No XContest work, IGC/competition signing, upload, authentication, credential storage, backend,
cloud sync, maps,
airspace, BLE, audio vario, automatic takeoff/landing, accounts, analytics, imported or manually
created flights, or competition features are included. The logbook contains only flights recorded
on this device. All data remains local until the tester deliberately invokes the share sheet.

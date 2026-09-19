# Optional in-flight map

Implementation of the [official v1 plan](https://linear.app/sentiment-hound/document/optional-in-flight-map-official-v1-plan-3c170335e8d5),
based on `2a12c1f`, on `feature/in-flight-map`. Local verification and a short Samsung ground
test are recorded below. Full Android acceptance remains open under PAR-37; the short test
does not establish recorder endurance or accepted field use.

## Behavior

Each recording starts in **Instruments**. **Map** deliberately opens the same Mapbox Outdoors
basemap and public-token configuration used for saved replay. Map mode shows compact airtime,
GPS altitude and ground speed. Capture status and hold-to-stop/save retry remain outside the
scrolling and map regions. The small view/camera preference survives navigation in the same
process and session; a new recording resets it. Recorder recovery and explicit interrupted-flight
Resume/Save partial retain ownership of capture.

The map follows committed recorded positions north-up at initial zoom 14. Pan/pinch selects
manual framing; Recenter returns to following at the chosen zoom. A stale position keeps its
true age and a distinct marker, without following delayed movement. Source age, receipt age
and recorder health all matter: newly received old GPS data is not a new position. There is no
interpolation, navigation, additional GPS watcher or change to recording cadence.

The **Recent trail** covers up to 15 minutes and at most 999 captured rows plus one latest
position record. It can cover less time at higher capture rates or after rejected samples.
Invalid, out-of-order and missing intervals remain breaks; live maps have no Start/Stop endpoint
labels. A position can remain visibly stale after its trail has aged out.

No eligible same-session fix shows a waiting state. A map-data read failure retains the last
evidence and retries reads while visible; it does not change recorder health. Missing native
configuration, map loading errors or the 15-second initial deadline show Grid. Grid fits the
bounded route, with no geographic camera controls. Configured map failures offer **Retry map**;
there is no automatic basemap retry loop. Network availability alone does not trigger fallback,
and usable cached tiles remain usable. Downloaded offline areas remain PAR-28.

Selecting Instruments, leaving the screen, backgrounding, foreground recovery and saving unmount
the live query and native map. The cache, timers and trail arrays are released. Re-entry loads
the recent bounded window; old read/load callbacks cannot affect the next view or session.

## Data and compatibility

- Features read through `useGetLiveMapQuery(sessionId)`. They never access SQLite directly.
- A repository page contains session identity, raw committed rows, a sequence cursor, committed
  high-water mark, latest valid position and `hasMore`. All queries bind session and watermark.
- Bootstrap reads the newest bounded raw rows. Delta reads advance by scanned sequence even
  when rows are rejected. An oversized backlog causes a fresh bounded bootstrap instead of
  walking historical pages. SQL is parameterized; read cycles are serialized at no more than 1 Hz.
- Local schema **8** adds only `location_fixes_map_source_order`, a partial source-time index
  for valid non-mocked coordinates. It makes latest-position lookup efficient beyond an old
  trail or long rejected tail. Existing recordings and evidence are preserved; no cloud schema
  migration, new permission, dependency upgrade or native module is introduced.
- Existing Mapbox and TaskManager patches stay in place. Saved replay keeps explicit **Fit flight**.

## Maintenance delivered separately

**PAR-32:** Account-deletion storage cleanup repeatedly drains page zero before deleting the
authenticated user. Tests exercise the extracted handler with fake storage/auth clients,
including page boundaries, owner isolation and failure/retry. The archive layout is the existing
flat `<user-id>/<flight-id>.igc` layout. This source change has not been deployed. Hosted retesting
must use disposable accounts; the owner's logbook and hosted account have not been deleted.

**PAR-33:** A small flight-specific replay bookmark survives the recorder recovery gate. Restored
playback is paused, retains speed, and clamps elapsed time to refreshed bounds. Query/player
unmounting still releases raw samples; a fresh replay route or different flight starts at zero.
Process-death restoration is outside this change.

## Verification

19 September 2026, working tree based on `2a12c1f`:

| Gate | Result |
| --- | --- |
| TypeScript and lint/architecture | Passed |
| Jest, including real SQLite and screen/lifecycle integration | 81 suites, 666 tests passed |
| Isolated Deno deletion-handler tests | 28 tests passed |
| Android Expo export | Passed; output `/tmp/xc-in-flight-map-export` |
| Standalone Android release APK | Initial build passed in 3m 56s; layout-corrected build passed in 57s; artifact identities below |
| Layout correction checks | Four focused Jest suites, 23 tests, targeted lint and TypeScript passed; includes the real NativeWind styling pipeline |
| Docker pgTAP and generated cloud-schema comparison | Blocked: Docker unavailable in this WSL environment; full `pnpm test` exits nonzero at this stage |
| Named-device smoke | Passed bounded ground checks on SM-S938B: corrected width/follow, ten view round trips, ten brief Home/return cycles, and stop/save. Full PAR-37 measurement and fault coverage remain open |
| Hosted deletion function | Source and handler checks complete; not deployed or exercised against a live account |

Local run logs are `/tmp/xc-in-flight-map-verification.log` and
`/tmp/xc-in-flight-map-export.log`. The export is an Android bundle, not a standalone APK or
installed-device proof. No hosted deployment or account deletion was performed. Compatible
in-place installation preserved the three existing flights; authorized ground tests added
two separate recordings.

### Artifact and signing identity

Both builds use package `com.xxvalhallacoderxx.xcmvp`, version `1.0.0` (code `1`), on
`feature/in-flight-map` at `2a12c1f10666f2001fc3be2768fb37b56e0585cf` plus a captured working tree.
Each snapshot contains 323 tracked/untracked source files and records no source drift during
the build. Documentation written afterward is not part of those snapshots.

The installed app uses the existing EAS certificate
`3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`; local Gradle builds use
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. After comparing signers,
the existing project EAS key was retrieved securely and used only to re-sign the APKs for a
compatible update. APK payload equality, `apksigner` and `zipalign` checks passed. Remote
credentials and the local keystore were unchanged; no rotation, app reset, uninstall or data
wipe occurred. Temporary credential copies were removed.

Initial artifacts are retained under the ignored directory
`android/app/build/outputs/internal/in-flight-map-20260919T144030Z/`:

- Local APK: `FlightLogAlpha-1.0.0-in-flight-map-212fe08494a0.apk`, SHA-256
  `212fe08494a07c9ded9d2ab88783be3c5c5a54f3676c80c6a3ba1ef695fa466c`.
- Compatible APK used for the first phone test: `FlightLogAlpha-1.0.0-in-flight-map-f08183169f3e.apk`,
  SHA-256 `f08183169f3e132907585b1706072431935f3119990f361911867ed19c516167`.
- Source tree SHA-256: `461c20e7563bdb01a9456e1b10d1f5b6a38e330e08b7a2cef461e8c5045885db`.
- Embedded bundle SHA-256: `2f307c883c252e01c587a402ed2950faef4159bc371231869b8425437b1967ab`.
- Build completed at `2026-09-19T14:46:18Z` after 3m 56s. The installed compatible APK's hash
  was verified; the three pre-existing flights remained present.

The map layout correction is retained under
`android/app/build/outputs/internal/in-flight-map-layout-20260919T153606Z/`:

- Local APK: `FlightLogAlpha-1.0.0-in-flight-map-layout-f7592cac2e39.apk`, SHA-256
  `f7592cac2e39541225fc59653459441bd8d82437968e5c106ea366246dc108ce`.
- Installed compatible APK: `FlightLogAlpha-1.0.0-in-flight-map-c589ef022e30.apk`, SHA-256
  `c589ef022e30cc39f9310d1cfa4bbaaa92caf1b6eec7e8ebf56d4c4db08fdc2d`.
- Source tree SHA-256: `b2ad45a6344f4403eb034c8cda2f5a751b7fc1f39ab5e0ebc803d97baa4f7068`.
- Embedded bundle SHA-256: `67aca5e8154bbd6dc8655b7513d8575b468bef8cf4b6453bea040a4c255480a3`.
- Build completed at `2026-09-19T15:39:36Z` after 57s. In-place installation succeeded and
  the on-phone SHA-256 matched; all four flights (three original plus the first ground test)
  remained present.

Each directory contains `build-record.json`, `compatible-build-record.json`, source manifest,
source archive/patch and build/signature logs. Both candidates include the compiled Mapbox
error-subscription patch. Public map/cloud configuration was verified without logging its values.

### Initial named-device ground test

User-authorized testing followed wireless re-pairing. Device: Samsung **SM-S938B**, Android **16**,
API **36**, 1080×2340 display, density override 420, font scale 0.9, brightness setting 123 in
automatic mode, battery optimization on, precise and background location permissions granted.
These settings are observations, not controlled performance-test conditions.

The first test used compatible APK `f08183169f3e…` on 19 September 2026, approximately
**23:32–23:34 Asia/Singapore**:

- Session `d99e213b-e323-4062-80f2-19b0180615d0` saved as **completed (stopped)** on schema **8**.
- Saved integrity UI reported **23 valid GPS fixes**, median gap **5.1s**, p95 **9.7s**, longest
  **12.2s**; battery reported **43%** at both start and end. This short unchanged percentage
  is not a battery-cost measurement.
- Instruments was the initial view. Map loaded; pan selected manual framing and Recenter
  restored follow. Status and Stop remained reachable; a short press did not stop recording.
  Background/return continued capture, and deliberate hold-to-stop saved the test flight.
- Diagnostics opened the native share sheet. No diagnostics were sent or raw JSON retrieved,
  so raw-fix/session reconciliation remains unverified.
- The map frame exceeded the right viewport and the followed marker appeared off-centre.
  Investigation found NativeWind dropping `aspectRatio: undefined`, which left the preview
  aspect ratio active in fill mode. Separate preview/fill styles fix the constraint; a regression
  through the actual NativeWind pipeline and 23 focused tests passed. The corrected candidate
  above passed the on-device layout retest described below.

Screenshots, timestamps, memory snapshots and `observations.json` are under the initial
directory's `device-smoke/`. Two dynamic UI dumps failed the idle check and contained stale
content; they were renamed `invalid-stale` and excluded from evidence. Screenshots show the
observed state. No conclusion about steady-state memory, rendering cadence, pinch, forced tile
failure, screen-reader behavior or endurance follows from this short test.

### Corrected-build device retest

The second recording uses installed compatible APK `c589ef022e30…` under the same device
settings. A fresh session starts in Instruments. Map loads, pan selects manual framing and
Recenter restores follow. `device-smoke/layout-map-recentered.png` in the corrected-build
directory shows both the right edge contained within the viewport and the marker centred,
physically confirming the layout correction.

The retest completed ten Instruments/Map round trips followed by ten brief Home/return cycles
(scripted intervals of approximately two seconds in the background and three seconds in the
foreground). `device-smoke/view-cycles.json` and `background-cycles.json` retain their timestamps.
Afterward, Map still rendered within the frame with a centred marker, **REC**, fresh source/receipt
ages and reachable Stop. Instruments showed **24 fixes at 2:25**. The app-scoped ReactNativeJS
and AndroidRuntime error log captured **zero error lines** during those cycles; this does not
assert absence of every possible native/system warning.

Stop was completed from Map and saved session `6530bc6d-b6a3-4fef-aa4c-64bb00b3f2f1`, approximately
**23:40–23:43 Asia/Singapore**, as **completed (stopped)** on schema **8**. The saved integrity UI
reported **26 valid GPS fixes**, median gap **5.3s**, p95 **9.8s**, longest **12.1s**, **132 pressure
samples**, and **42% battery** at both start and end. The final logbook showed **five flights**:
the three original flights plus the two ground tests. The corrected-build test reopened
successfully from the logbook, showing its saved 23:40–23:43 interval; the app was then returned
to the logbook. Post-stop service inspection reported `startRequested=false` and no foreground
flag; `device-smoke/location-stop-evidence.txt` separately records the GPS provider turning
off at 23:43:03. The saved quality reports timing gaps, so these UI/service-backed short-run
observations do not establish loss-free capture. Raw diagnostics reconciliation has not
been completed.

Screenshots, `observations.json`, cycle/error logs and memory snapshots are retained in this
corrected build's `device-smoke/`.
The repeated cycles and two short recordings do not establish a matched battery/resource
comparison, steady-state memory behavior, one-hertz native refresh, pinch behavior, map fault
recovery, locked-screen continuity or endurance. PAR-37 and the owner's measured go/no-go
remain open.

Run with Node 24:

```sh
pnpm test
pnpm test:functions
pnpm exec expo export --platform android --output-dir /tmp/xc-in-flight-map-export
```

`pnpm test` includes types, lint/architecture, Jest, Deno function tests, then isolated Docker
database/pgTAP and generated cloud-schema verification. The functions runner pins Deno 2.5.6
via `pnpm dlx`; its first use requires registry access. Handler tests use local modules and no
runtime permissions or live credentials. A missing Docker daemon is a blocked database gate.

Automated coverage includes real SQLite bounds/index/migrations; invalid-only cursor progress;
oversized backlog, slow reads, visibility/session cleanup and late callbacks; live geometry and
camera behavior; saved replay regressions; the real record screen/cache/recovery integration;
save retry and obsolete hold/dialog callbacks; real-parent replay recovery; and account-deletion
pagination/auth/error behavior.

## PAR-37 Android acceptance still required

Use disposable recordings and a compatible in-place update. Preserve the owner's recordings,
app identity and signer. Record source commit plus any diff, APK SHA-256/package/version/signer,
device/OS, permission state, brightness, battery optimization and test start/end times.

1. Compare at least 30 minutes Instruments with 30 minutes Map in comparable conditions. Include
   screen-on and locked-screen portions, recording those durations separately. Reverse the order
   and repeat if battery/memory differences are ambiguous.
2. Perform ten Instruments/Map switches and ten background/return or open/close cycles. Verify
   pan/pinch/Recenter, same-session framing, new-session reset and foreground recovery. Confirm
   refresh cycles at most 1 Hz, at most 1,000 retained records and no hidden polling/native map.
3. Exercise waiting/stale/read-error states, missing/invalid token, cold-load timeout, cached and
   uncached offline areas, network loss and explicit Retry. Forced fixtures belong in an isolated
   test installation, not the owner's real logbook.
4. Check status, compact instruments, warnings and Stop on a small viewport, with enlarged text
   and screen reader. Map gestures must remain separate from hold-to-stop. Save/retry must work
   during degraded maps; a dismissed or obsolete accessibility dialog must not stop another session.
5. Stop/save/reopen after interruptions. Reconcile stored session IDs, fix counts/timestamps/gaps
   and exports: no lost/duplicate session, post-Stop extension or reproducible map-induced gap.
6. Record load time, query count, JS/native memory before/after settled cycles, battery change and
   thermal observations. Investigate sustained growth or repeatable regression. Obtain the owner's
   go/no-go on the measured tradeoff. Link relevant PAR-27/PAR-9 results; keep unrelated open cases
   and the two-/six-hour endurance trials separate.

PAR-37 and parent feature acceptance remain open until these named-device results exist.

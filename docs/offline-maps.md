# Offline map areas — PAR-28

Implemented locally on 20 September 2026 for Android. This document describes the code and
the remaining acceptance work for [PAR-28](https://linear.app/sentiment-hound/issue/PAR-28/add-downloadable-map-areas-for-offline-flying-and-replay).
Physical acceptance is incomplete. The initial APK downloaded Jugra and Singapore, retained
ready areas after restart and rendered the Jugra download preview with all connectivity off.
Its saved-flight offline replay failed. The replacement camera/font APK passed a cold offline
saved replay in Singapore, including labels, pilot marker, scrub, Play/Pause and pan/Fit.
An offline ground recording received no fresh GPS fixes and was saved as an empty partial;
live-map acceptance remains open. Terengganu subsequently completed after manual resumes
and provider retries. The final recovery-service APK is installed and passed cold offline
saved-replay rendering plus sampled Jugra rendering after deletion of an overlapping area.

## Pilot experience and defaults

Open **Account → Settings → Offline maps**. Submit a destination search, choose a result,
inspect the suggested named coverage, review the size estimate and download. Multiple areas
remain saved on the phone. The implementation connects them automatically to the optional
live map and saved replay; cold offline saved replay has passed the bounded check below.
There is no per-flight region selector, account requirement or cloud map sync.

- Search uses the existing configurable Photon/OSM service, with a separate broad destination
  parser. It accepts towns, administrative regions, countries and terrain landmarks; the
  existing launch-site picker keeps its terrain-only search behavior.
- Queries are submitted explicitly, accept two or more characters and cancel obsolete requests.
  **KKB** visibly expands to **Kuala Kubu Bharu**. **Bukit Bubos** offers an explicit alternative
  search for **Bukit Bubus, Terengganu**; it never selects a launch silently. Results retain full
  available town/region/country context so similarly named places remain distinguishable.
- Use a valid administrative/place extent when available. Point destinations and terrain
  landmarks get **Around {place}**, a rectangle extending approximately **25 km** in each
  cardinal direction. Its preview is the actual download geometry; panning does not edit it.
  A broader parent-region search is optional. Unsupported polar/dateline local rectangles
  produce an actionable message rather than silently clipping the promised area.
- Download **Mapbox Outdoors v12**, zooms **0–14**, with no download-detail selector or manual
  rectangle drawing. The native descriptor uses pixel ratio 2. The existing public `pk.` token
  remains the map credential; Photon does not need a new account or API key.
- Saved areas expose progress, Pause, manual Resume/Retry, Cancel, Update and confirmed Delete.
  A ready original remains available while its replacement downloads or is paused/failed.
  New downloads already covered by one or several saved areas reuse that coverage.
- The live/replay map reports partial or absent downloaded viewport coverage when offline.
  With ready downloads, offline camera zoom is capped at 14. A usable cached map may still
  render outside saved coverage; existing load-error/timeout Grid fallback remains available.
  Missing downloads never block recording or access to recorded fixes.
- Static Logbook/detail images retain their separate Expo Image cache and Grid fallback.
  Downloaded vector regions do not make the Static Images API work offline.
- Destination names retain linked OpenStreetMap attribution. Native map logo/attribution
  remain visible. iOS and other platforms show that downloads are currently Android-only.

No country blacklist, arbitrary area-size ceiling or app-wide byte quota was added. Local-area,
province and small-country download measurements below must inform any later product limits.
Provider tile limits and actual free space can still prevent a download.

## Architecture and persistence

| Layer | Responsibility |
| --- | --- |
| `src/features/offline-maps/` and `/offline-maps` | Search, coverage preview, estimate/consent and saved-region controls. |
| `src/offline-maps/service.ts` | Serializes transfer intent, owns logical regions and active/pending generations, persists state, reconciles native completion and rejects stale callbacks. |
| `src/offline-maps/runtime.tsx` | Connects foreground/network state and recorder activity/recovery to transfer policy; exposes coverage to map rendering. It adds no GPS watcher or recorder polling loop. |
| `src/offline-maps/registry.ts` | Versioned metadata in the separate `xc-offline-maps.db` key-value store. Recorded flight tables and cloud schemas are unchanged. |
| `src/offline-maps/backend.native.ts` | Typed bridge to the app-specific Android `XCOfflineMaps` module. Missing native support produces a rebuild message. |
| `patches/@rnmapbox__maps@10.3.5.patch` | Preserves the existing real map-error subscription fix and adds the Android style/tile download bridge. |

The bridge uses Mapbox SDK 11.23.1's `OfflineManager` for style packs and `TileStore` for tile
regions. A shared SDK loader sets the token and awaits storage preparation before constructing
live, replay or coverage-preview `MapView`s. All native consumers use the same tile store.

Map resources live under Android's app-private `noBackupFilesDir/offline-maps`: `resources`
contains style/map resources, `tiles` contains tile packs and `receipts` contains completion
records. `TileStoreUsageMode.READ_ONLY` lets map views read saved tile packs without automatically
creating region downloads. Ordinary map rendering/cache behavior is distinct from explicit
saved regions; an old ambient cache is not evidence that a region was downloaded.

The storage total measures allocated files under that shared root, including shared resources
and cache, and reports device free bytes separately. It does not add together per-region
estimates. Deleting a region releases its region reference and receipt; shared style resources
and SDK cache may remain, so the total need not drop by that area's displayed transfer size.
Progress bytes describe processed map resources, including reused resources; they are not
measured network traffic. For device measurements, record this counter separately from the
storage delta. Android app traffic counters, if available, also include other app requests.

The native change and `expo-network` require a new Android binary. Keep the Mapbox patch,
`pnpm-workspace.yaml` patch mapping and lockfile together when updating dependencies. Follow
the [existing build workflow](../README.md#build-install-and-iterate) and preserve signing identity
and recorded data; Fast Refresh cannot install this bridge. No hosted migration or deployment
is required for map downloads.

## Completion, updates and recovery

A resource counter reaching its current total is not completion: style resources can finish
before tile counts are known. The UI caps progress below 100% until a download is ready.
Readiness requires all of the following:

1. Successful terminal SDK callbacks for the style pack and tile region, with complete resources.
2. An atomically written native receipt for the native region, logical region, operation and
   exact style/zoom/bounds configuration.
3. Native readback verification before the JavaScript service promotes the pending generation.

Updates download a separate pending generation. Only after verified completion and durable
metadata promotion does cleanup release the previous generation. Pause, failure or Cancel
cannot promote partial resources or erase the last ready generation. Late callbacks from
superseded operations are ignored, including after a cancellation or runtime teardown.

On restart, metadata is reconciled with actual native resources and receipts. Interrupted work
becomes manually resumable; it does not restart its network transfer automatically. Native
owned regions can be rediscovered if metadata is absent. Corrupt or unsupported registry data
is surfaced without silently resetting downloads. A recovered region with no verified UI
completion time says **Update time unavailable**, rather than inventing a timestamp.

Deletion intent is durable. Cleanup waits while recorder recovery/capture is busy and runs
again after foreground/idle recovery. **Deletion pending** explains that saved map data remains
while it waits. A native removal failure keeps **Retry delete** available. Shared overlapping
coverage and flight evidence must survive deletion; physical proof is still required below.

## Transfer and storage policy

- Only one area transfers at a time. The app must be foregrounded and the recorder ready/idle.
  Recorder start/recovery revokes download and estimation work without awaiting it from the
  recorder. Native lifecycle/network monitoring also cancels unsuitable work.
- Wi-Fi is the default. Every Download, Resume or Update confirmation starts with mobile data
  disabled; the pilot must explicitly enable it for that attempt. An unknown/disconnected
  network cannot start a transfer. Network loss or a change away from the permitted connection
  pauses it. Returning to Wi-Fi or foreground never automatically resumes downloading.
  Metered Wi-Fi is allowed; native Wi-Fi checks and network callbacks enforce this policy rather
  than the SDK's broader restriction on expensive networks.
- Backgrounding or screen lock pauses the transfer. Keep the app open to download, then return
  to this screen and resume deliberately. Recording remains independent of map network work.
- The SDK estimates tile transfer/storage with a fractional error margin; the UI displays a
  range and notes that style resources can add bytes. Estimation does not download a style
  pack. A failed/timed-out estimate offers Retry or the explicit **Download without estimate**
  action. Resume and Update obtain a fresh estimate/confirmation.
- Preflight requires **512 MiB** free space plus estimated storage including its margin. Without
  an estimate, explicit consent is required and the reserve still applies. Free space is checked
  again during transfer; low space pauses work. This reserve is a recording safeguard, not a
  guarantee of enough space for an arbitrarily long flight.
- Download errors, provider limits and retry instructions remain visible. Deleting or cancelling
  a map must not delete recordings, sign the pilot out or depend on cloud availability.

## Android physical acceptance

Use a freshly built standalone APK on the owner's Samsung SM-S938B, preserving its logbook.
Record the APK hash/build identity, Android version, connectivity, available storage and actual
results. Cold-start checks must start in airplane mode, not merely disconnect a warm MapView.
Use an isolated test installation for forced storage/receipt corruption or destructive fixtures.
The initial phone observations below cover part of this matrix; full offline acceptance remains open.

| Scenario | Required observation | Observed evidence / remaining work |
| --- | --- | --- |
| Search and coverage | Find Bukit Jugra, KKB/Kuala Kubu Bharu, Bukit Bubus/Terengganu and Wonogiri. Distinguish the unrelated Bubus result by context, use the explicit Bubos alternative, and inspect local versus administrative coverage. | Jugra, Singapore, Terengganu and Kuala Langat searches/previews observed on device. KKB, Bubos, qualified Bubus and Wonogiri passed live API/parser checks below; their physical UI checks remain pending. |
| Local download | Download Around Bukit Jugra or another local flying area over Wi-Fi. Record estimate/range, elapsed time, transferred bytes, actual map-storage change and free-space change. Confirm resources remain usable after completion and app restart. | Jugra Ready, storage/free-space observations and cold offline preview passed. Exact network bytes and saved replay within Jugra remain unverified. |
| Province/region measurement | Download Terengganu or a comparable province, with the same measurements. Record any provider-limit failure honestly; do not infer a supported country-size ceiling from one sample. | Terengganu reached Ready on f917 after background pauses, HTTP 429/60-second retries and a second explicit Resume. Total shared map storage was 187.9 MB afterward. Exact active-transfer duration/traffic and province rendering remain unverified. |
| Small-country measurement | Download Singapore or another small country, with the same measurements. Compare actual storage and time before choosing later size limits. | Singapore Ready; estimate, time upper bound and storage observations recorded below. Cold offline saved replay in Bukit Batok passed on the replacement APK; wider country coverage remains untested. |
| Cold restart, offline replay | Force-stop/reopen in airplane mode after a completed download. Replay a saved route inside coverage: visible basemap/labels, correct route/marker, pan/Fit, pause/scrub, unchanged timing and attribution. Repeat after device reboot. | Initial APK failed. **f917 passed** cold radio-off replay, basemap/labels, endpoints/pilot, Play/Pause, scrub and pan/Fit. **Final eb799 APK passed** the cold replay rendering repeat. Device reboot and broader routes remain pending. |
| Cold restart, live recording | In airplane mode, start a short safe ground recording inside downloaded coverage, open the live map, then save/replay it. Check captured fixes remain continuous and the map adds no location permission/watcher. | **Not passed:** f917 ground attempt obtained zero fresh GPS fixes, entered recovery and interrupted at 36 seconds. Saved as partial with no usable track. Owner cannot reposition the phone for another GPS attempt now; live rendering with fresh fixes remains unverified, not an established offline-map failure. |
| Multiple areas | Keep several saved destinations, close/reopen and use each without switching a preferred region. Re-select already covered or jointly covered geometry and verify reuse instead of a duplicate transfer. | Jugra, Singapore and Terengganu reached Ready; Singapore replay used coverage automatically. Other-area replay and duplicate/union reuse on device pending. |
| Overlap and delete | Download overlapping A/B, record total storage, delete A, cold-restart offline and verify B throughout shared coverage. Delete B and record remaining cache/style bytes; do not expect summed estimates or immediate zero storage. | **Sampled preservation passed on final eb799 APK:** add Kuala Langat, delete it with confirmation, cold-start offline and render retained Jugra preview plus Banting detail. Shared storage remained 187.9 MB. Exhaustive shared coverage and deleting the final retained area remain untested. |
| Pause and interruption | Pause manually, Home/background, lock screen, disconnect Wi-Fi, kill/relaunch mid-transfer. Completed maps stay usable, incomplete maps do not become Ready, and all transfers wait for explicit Resume. | Terengganu background pause and no automatic foreground resume passed; explicit Resume obtained a fresh estimate with mobile disabled. Other interruptions pending. |
| Mobile consent | Lose Wi-Fi with mobile enabled on the phone. No continued default download is allowed. Explicitly opt into mobile data on Resume and verify the next operation uses that consent; new confirmations default back to Wi-Fi. | Mobile disabled in observed download/resume confirmations; network transition/override checks pending. |
| Update preservation | Update a ready area, then force failure, background/kill or Cancel. Cold-start offline and verify the old ready area remains usable. Complete an update and verify the replacement before old-generation cleanup. | Pending. |
| Recorder priority | Begin recording during a download or estimate. Confirm transfer pauses promptly, capture/save/recovery still work, and ending recording does not auto-resume the transfer. Exercise deferred deletion and Retry delete after a removal failure. | Pending. |
| Estimate and low storage | Exercise an estimate failure and explicit unknown-size choice; reject a start below reserve plus estimate. Simulate declining space only in an isolated fixture and verify a recoverable pause rather than damaged recordings. | Normal estimates observed; failure and low-space fixtures pending. |
| Coverage edge and fallback | Pan/replay outside saved coverage, inspect partial/missing coverage messaging and existing Grid fallback/Retry behavior. A missing map never blocks Start/Stop or saved-flight access. Verify offline zoom limits and online return. | Saved-flight detail and Grid fallback remained accessible after the offline replay failure. Coverage edges, zoom limits and recording checks pending. |
| UI/resource regression | Check small-screen scrolling, keyboard, Back, accessible controls, visible attribution, repeated open/close/retry and total storage updates. Compare map responsiveness and memory/battery behavior with existing recorder/map baselines. | Search, preview, attribution and storage changes observed; broader regression/resource measurements pending. |

## Verification and build artifact

The integrated 20 September run passed TypeScript, ESLint, **91 Jest suites / 734 tests** and
**28 function tests**. `pnpm test` then failed at the database stage because Docker was
unavailable; database verification was not skipped or passed. The run log is
`/tmp/par28-verify.log`. Native Kotlin compilation also passed. These are implementation/build
checks, not physical-device acceptance.

After the camera/font fixes, TypeScript, ESLint and all **91 Jest suites / 740 tests** passed.
The replacement release build passed in **35 seconds** and is installed; its bounded cold
offline replay retest passed as recorded below. These later checks do not change the
Docker-blocked database result above. The earlier 28 function tests passed and their source
was unchanged.

After the recovery-service fix, TypeScript, ESLint and **91 Jest suites / 742 tests** passed.
Its release build passed in **32 seconds** with no source changes during the build. Exact-APK
device retesting remains separate from those checks and the earlier f917 replay evidence.

### Initial download APK

Android export and the initial standalone release build passed. That build took 27 seconds
after the native rebuild. The APK contains the compiled `XCOfflineMapsModule`. Build evidence,
source archive/manifest/diff, test logs and APKs are retained in the ignored local directory
`android/app/build/outputs/internal/par28-offline-maps-20260920T1024Z/`.

- Branch: `feature/par-28-offline-maps`, base commit
  `b317af9aaddb6924a70befe8fb6c2e4252ab526e` plus the captured working tree.
- Source tree SHA-256: `ebfb75c9183281d7dba0c0b39436c1610082f4b52e2c28adcdd113ffc557fa8c`.
  The manifest contains 354 files; no source changed during that build. This artifact record
  predates the later camera/font fixes and documentation updates.
- Compatible APK: `FlightLogAlpha-1.0.0-offline-maps.apk`, SHA-256
  `b80db04a9af449369e840ad1a9ca587569712eecc2baf9c8905cd82c492ce022`.
- Package `com.xxvalhallacoderxx.xcmvp`, version `1.0.0`, version code `1`.
- Existing installed signing certificate:
  `3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`.
  Re-signing used the existing EAS key without changing remote credentials or the local key.
  Certificate, ZIP alignment and unchanged non-signature APK payload checks passed; temporary
  credential copies were removed.

In-place `adb install -r` succeeded on Samsung SM-S938B / Android 16 on 20 September 2026.
The installed APK checksum matches the compatible artifact. No uninstall or data reset was
performed. Opening `xcmvp:///offline-maps` returned a successful activity launch and no
React Native/Android runtime errors in the observed startup log. The device was initially
locked; the later unlocked observations below supersede that initial UI limitation. Installation
and the partial checks do not close PAR-28 acceptance.

### Replacement camera/font APK

The replacement build and installation evidence is retained separately in
`android/app/build/outputs/internal/par28-replay-fix-20260920T1141Z/`, including
`build-record.json`, `installation.json`, source archive/manifest/diff and verification logs.

- Same branch/base commit, package/version and existing signing certificate as the initial APK.
- Source tree SHA-256: `f99114770071bc9c4141429ff3cc6b7d4085b59bfe28267d76fadce9dbbd9489`,
  captured at **11:39:34 UTC** on 20 September, with 354 files. Only
  `docs/offline-maps.md` changed during the build; application source stayed unchanged.
- Compatible APK: `FlightLogAlpha-1.0.0-offline-maps.apk`, SHA-256
  `f917ecf802db24760a5d360314200f51fc622791df6948e181898344880ed461`.
- In-place `adb install -r` succeeded at **11:41:49 UTC** on Samsung serial `R5CY90K8EWP`.
  The installed APK checksum matches this replacement artifact. No uninstall/data reset was
  performed.

This APK contains the initial-camera and endpoint-font fixes. After the owner unlocked the
phone, the cold offline replay retest below passed. The later recovery-service fix is absent
from this APK; its build and evidence are recorded separately.

### Final recovery-service APK

The final artifact directory is
`android/app/build/outputs/internal/par28-final-20260920T1150Z/`. The recovery change retains
ownership of existing native areas whose readiness needs repair, preserves that ownership
when cancelling an update, and refreshes readiness before resuming. This extends the earlier
camera/font fixes; it does not retroactively change the artifact used for previous device checks.

- Same branch/base commit, package/version and existing signing certificate as above.
- Source tree SHA-256: `9c01e06d1cb623b584ffa1ff9bb2900e3340f2528ac8a1aa50fcbcd7f326f56b`,
  captured at **11:49:31 UTC** on 20 September, with 354 files. No source changed during the
  32-second build. This documentation update was made afterward.
- Compatible APK: `FlightLogAlpha-1.0.0-offline-maps.apk`, SHA-256
  `eb799bd957978deb47ad9d3b421d362feb55e5bbd3e1044ef50e512a733bc44e`.
- In-place installation succeeded at **11:51:49 UTC** on Samsung serial `R5CY90K8EWP`.
  `installation.json` confirms the installed APK checksum matches this artifact. All three
  completed areas remained Ready after installation. Exact-APK observations follow below;
  earlier f917 replay results remain separately attributed.

### Initial unlocked-phone checks

The owner unlocked the same Samsung for checks at approximately 11:19 UTC on 20 September.
On the installed `b80db04a9af4…` APK:

- **Passed:** Offline maps opens, reports storage, and displays the empty saved-area list.
- **Passed:** Searching `Bukit Jugra` returns the Malaysian terrain result with local context.
  Selecting it renders the actual shaded 25 km local rectangle with visible Mapbox attribution.
- **Passed:** The estimate completed at displayed **60.3 MB**, with mobile data disabled.
  The explicit download reached **Ready for offline use**, observed within **48.4 seconds**.
  This is an observation upper bound, not precise terminal download timing.
- **Observed:** Displayed total map storage rose from **310 KB** before preview/download to
  **79.7 MB** after completion; displayed device free space changed from **6.1 GB** to **6.0 GB**.
  These rounded values use the app's binary-unit formatter. The total includes preview cache,
  shared resources and allocation overhead; it is not isolated network traffic.
- **Passed:** A force-stop and cold launch while online retained the ready region, saved date,
  and displayed 79.7 MB map storage.
- **Passed:** Singapore's download reached **Ready for offline use** alongside Jugra. Its
  displayed estimate was **14.9 MB** transfer / **53.3 MB** map data, with mobile disabled.
  Ready was observed within **5.7 seconds** of the recorded start; this is an upper bound,
  not exact transfer duration. Shared map storage changed from **79.8 MB** before preview
  to **94.9 MB** after completion, while displayed free space remained **6.0 GB**.
- **Passed, preview only:** USB debugging was authorized; Windows ADB connected to serial
  `R5CY90K8EWP`. With airplane mode enabled, Wi-Fi off and no Android default network,
  a cold launch retained Jugra as Ready. The download-area preview and its zoomed detail
  rendered the downloaded basemap. This was not a saved-flight replay check.
- **Failed:** Actual saved-flight replay under those radio-off conditions displayed
  **Map couldn't load** and fell back to Grid. Saved-flight detail and replay controls remained
  accessible. Investigation found the initial camera requesting the default European view
  before route fitting, and endpoint labels requesting an unavailable Open Sans glyph font.
  Camera/font fixes are in `src/components/flight-map/index.native.tsx`; they are absent from
  the `b80db04a9af4…` APK. The installed `f917ecf802db…` replacement includes them and
  passed the cold offline replay retest recorded separately below.
- **Passed, background pause:** Terengganu started with an estimate of **59.7–145.7 MB**
  transfer / **131.1 MB** map data and mobile disabled. Returning after backgrounding showed
  **Paused while the app was away**, **42.4 MB of map resources · 6%**; it did not resume
  automatically. Explicit Resume opened a fresh preview with mobile disabled and obtained
  **83.6–92.6 MB** transfer / **130.7 MB** map-data estimates before the recorded restart at
  **11:38:48 UTC**.
- **Incomplete, provider retries:** Terengganu later displayed **99%** without becoming Ready.
  Native SDK logs at **11:38:56** and **11:39:57 UTC** show a tile request receiving
  **HTTP 429**, with **60-second** SDK retry delays. This explains the observed wait at that
  stage; it is not evidence of a completed province download. After subsequent phone locking
  and replacement installation, a fresh hierarchy confirmed that it remained paused at 99%.
  This was an intermediate state; a later explicit Resume completed the download as recorded
  below. The retry log is `/tmp/par28-terengganu-app-log.txt` (lines 1568 and 1581).

Screenshots, valid UI hierarchies and measurement notes are under the artifact's
`device-checks/` directory. UIAutomator could not capture an idle hierarchy during changing
download progress; that stale hierarchy was discarded, and no assertion relies on it.

Measurement notes include `jugra-start.json`, `jugra-result.json`, `singapore-start.json`,
`singapore-after-download.capture.json`, `terengganu-start.json` and
`terengganu-resume-start.json`. The cold preview and failed replay are recorded separately
as `airplane-jugra-preview` / `airplane-jugra-detail` and `airplane-replay-initial`; the
background pause has a fresh `terengganu-paused.xml`. A successful download preview or a
Ready row must not be treated as proof that live/replay rendering passed.

At **11:44 UTC**, the phone was still securely locked and the corrected-APK replay/live
checks were waiting for the owner to unlock it. Airplane mode was off; Wi-Fi, mobile data
and Bluetooth were on. The original five-minute screen timeout and charging wake setting
were restored and read back in the replacement artifact's `device-restoration.json`.
This was an interim state; the owner then unlocked the phone for the radio-off tests below.

### Corrected APK cold offline replay

These observations belong to installed APK `f917ecf802db…` and the replacement artifact's
`device-checks/` directory, at approximately **11:45–11:47 UTC** on 20 September.

- **Confirmed radio-off cold start:** Airplane mode was enabled, Wi-Fi was off, and Android
  reported **Active default network: none**. The app was force-stopped before launching the
  Logbook. All **six existing flights** remained listed.
- **Passed:** The existing multi-fix flight from **19 September, 23:40** opened in saved
  replay inside the Singapore download. After more than 15 seconds, the Bukit Batok basemap,
  local labels, Start/Stop markers and Mapbox attribution remained visible without Grid
  fallback. No MapLoadError or glyph failure appeared in the captured app-process log,
  `/tmp/par28-fixed-replay-log.txt`.
- **Passed:** Scrubbing to **80 seconds** displayed the blue pilot and **32 m / 0 km/h**
  telemetry. Play at **1×** advanced elapsed time to **81 seconds**, and Pause stopped it.
  Panning rendered a different nearby viewport; Fit restored the route viewport.
- **Confirmed intermediate province state:** `province-after-install.xml` shows Terengganu still
  **Paused while the app was away**, **130.2 MB of map resources · 99%**, with Resume/Cancel
  controls. At that point it was retained partial progress, not Ready coverage.

Screenshots are `airplane-fixed-replay-settled`, `airplane-replay-marker`,
`airplane-replay-panned`, `airplane-replay-fit`, `airplane-replay-scrubbed` and
`airplane-replay-paused`. This proves the tested saved-replay path on the camera/font APK;
live recording, reboot, wider coverage and the other matrix scenarios remain open.

### Corrected APK ground attempt and province completion

These later checks still used `f917ecf802db…`, before installation of the recovery-service APK.
Their evidence is in the same replacement artifact's `device-checks/` directory.

- **Offline live test not passed:** The ground attempt at **19:48 local / 11:48 UTC** obtained
  **zero fresh GPS fixes**. It entered recovery after the initial 15-second interval, then the
  persisted 20-second recovery deadline elapsed. The interrupted state showed **36 seconds**
  and **0 GPS fixes**. Saving it produced a partial flight explicitly labelled
  **No usable GPS track was recorded** and **NO TRACK RECORDED**. Screenshots
  `airplane-live-state` and `airplane-empty-ground-saved` establish the visible recovery and
  empty-partial outcome; they do not establish live-map rendering or continuous GPS capture.
  The owner cannot reposition the phone for another GPS attempt now. A further safe ground
  test with fresh fixes is required; this observation does not establish an offline-map defect.
- **Province download completed:** A second explicit Resume for Terengganu obtained a
  **64 KB** remaining-transfer estimate / **130.2 MB** map-data estimate. It reached
  **Ready for offline use**, captured at **11:50:43 UTC** in `province-second-result.xml` and
  its screenshot. This finished the original province download after interruption and
  HTTP 429 waits; the brief final resume is not the total download duration.
- **Storage observed after completion:** `province-complete-storage.xml`, captured at
  **11:51:07 UTC**, shows **187.9 MB** shared map storage and **5.7 GB** device free space.
  Shared map storage before the province attempt was **94.9 MB**. The roughly **93.0 MB**
  displayed increase includes shared resources/cache and intermediate previews; it is not
  measured network traffic. Phone free space also includes unrelated app/install storage.

Terengganu readiness and storage measurement now have direct evidence. Cold offline rendering
throughout that province, precise active transfer time/bytes and full live-recording acceptance
remain open.

### Final APK overlap deletion and cold replay checks

These observations used installed APK `eb799bd95797…`; evidence is under the final artifact's
`device-checks/` directory at approximately **11:53–11:55 UTC** on 20 September.

- **Passed:** Jugra, Singapore and Terengganu remained Ready after the in-place update.
  Searching Kuala Langat selected the administrative region in **Selangor, Malaysia**. Its
  estimate was **0 KB** transfer / **42.9 MB** map data, and saving it added a fourth Ready
  row (`overlap-added.xml`). A zero-transfer estimate reflects reused resources, not a
  measured network-traffic counter.
- **Passed:** Confirming **Delete Kuala Langat?** removed that area while keeping the other
  saved areas (`overlap-delete-confirmation` and `overlap-deleted`). Shared map storage was
  **187.9 MB** before deletion and remained **187.9 MB** after cold restart; device free space
  displayed **5.5 GB**. The surviving references/cache explain why deletion need not reduce
  the total immediately.
- **Passed for sampled coverage:** With airplane mode on, Wi-Fi off and Android reporting
  **Active default network: none**, the app was force-stopped and relaunched. Jugra remained
  Ready. Its coverage preview and a newly zoomed view around Banting rendered basemap and
  labels offline, with Mapbox attribution. Evidence: `airplane-jugra-after-delete`,
  `airplane-jugra-detail-after-delete` and `/tmp/par28-final-airplane-connectivity.txt`.
  This samples retained overlapping coverage; it does not prove every tile in the region.

- **Passed on the exact final APK:** The same saved **19 September, 23:40** flight rendered
  its Singapore basemap, local labels, Start/Stop markers and attribution after the radio-off
  cold launch. `final-cold-offline-replay-settled.png`, captured at **11:55:40 UTC**, shows the
  settled map; `final-cold-offline-replay.xml` records the replay UI. The final artifact's
  `replay-app-log-redacted.txt` for app process **22435**
  contains no observed map-load error, failed-tile/glyph message or fatal exception. This
  repeats cold rendering on `eb799bd95797…`; the detailed Play/Pause/scrub/pan/Fit evidence
  above was gathered on `f917ecf802db…`.

Cleanup and phone-settings restoration were confirmed at **11:57:37 UTC**. Only the empty
partial created by this ground test (**Sunday 20 September, 19:48**, zero GPS fixes) was
deleted through the app's confirmation flow. `cleanup-test-entry-deleted` and
`original-six-flights-preserved.xml` / its screenshot record the result: the original **six
flights** remain. Jugra, Singapore and Terengganu remain saved, with **187.9 MB** shared map
storage and **5.5 GB** device free space.

The final artifact's `device-restoration.json` confirms airplane mode **off**, Wi-Fi, mobile
data and Bluetooth **on**, screen timeout **300000 ms** (five minutes), and charging stay-awake
**off**. No more device checks are planned in this session. The owner cannot reposition the
phone for fresh GPS reception; live recording with fresh fixes, device reboot and the remaining
matrix scenarios stay open.

### Live destination API checks

Four requests on 20 September used the production query expansion, parser and coverage
calculation against `photon.komoot.io`. These are API/parser observations, not phone UI
acceptance or guaranteed future search rankings.

| Submitted query | Observed parsed result | Coverage/selection implication |
| --- | --- | --- |
| KKB | Expanded to Kuala Kubu Bharu; Hulu Selangor, Selangor, Malaysia. | No provider bounds; **Around Kuala Kubu Bharu**, approximately 25 km in each cardinal direction. |
| Bukit Bubos | Fuzzy unrelated results precede Bukit Bubus; another same-name place is in Kedah. | Explicit result selection/context remains necessary. |
| Bukit Bubus, Terengganu | Exactly one parsed result: Bukit Bubus; Besut, Terengganu, Malaysia. | Terrain without bounds; **Around Bukit Bubus**, approximately 25 km in each cardinal direction. |
| Wonogiri | First result: region; Central Java, Indonesia. Also a same-context settlement without bounds and other Indonesian places. | Region rectangle `[110.7556418, -8.211868, 111.3193054, -7.7121834]`; displayed result kind distinguishes the region from settlement. |

## References

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Mapbox Android offline maps](https://docs.mapbox.com/android/maps/guides/offline/)
- [Photon service and usage limits](https://github.com/komoot/photon)
- [Photon API and extent format](https://github.com/komoot/photon/blob/master/docs/api-v1.md)
- [OpenStreetMap attribution and data licence](https://www.openstreetmap.org/copyright)

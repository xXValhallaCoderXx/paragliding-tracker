# Illustrated flight postcards delivery record

Implementation date: 2026-09-05. Work remains in the working tree on `main`, alongside the
pre-existing journal/replay changes. No database migration, recorder-service change, cloud API,
photo-library permission or account requirement was added. Existing SDK patch upgrades remain
separate. No device data was cleared or app uninstalled.

## Delivered behavior

- Saved, completed-statistics flights offer **Share postcard** immediately below primary Replay.
  Completed and partial flights are eligible; open/interrupted/processing flights are excluded.
- A single full-screen native modal defaults to Square, Flying, an empty caption and a signature
  enabled only when the saved pilot name is available. Flying, Launch and Landing thumbnails,
  Square/Story controls, a 140-code-point caption field and a signature switch customize the image.
- Ivory, forest and orange use the existing local artwork, Archivo and IBM Plex Mono. Flight
  title (or site, or “A day in the sky”), distinct site, flight-local date, airtime, track distance
  and maximum GPS altitude appear with a restrained date treatment and Flight Log Alpha footer.
- The stored segmented route is projected with the existing proportional geometry helpers onto
  a plain surface, separate from the mountains. Partial/gap labels and sourced-site attribution
  are printed. No usable GPS shows an unavailable route and unavailable GPS metrics; a lone
  recorded position is labelled. No decorative substitute track is drawn.
- Flight/track/profile queries are unmounted after copying only the required source fields.
  Background metadata changes cannot alter a ready composition. Optional profile failures omit
  the signature; flight/track failures offer Retry. No replay-sample query is used.
- The mounted opaque, non-collapsible view is both preview and capture. Card typography scales
  with its composition; controls use system text sizing and wrap. Title, site, caption and
  signature truncation is visible in the preview. The caption never reads or writes flight notes.
- Capture requires loaded fonts, a loaded current illustration, current layout and two committed
  animation frames after edits. Late asset callbacks from a prior scene are ignored. Capture,
  cache, font, image and sharing failures remain within the composer with retry.
- Duplicate submissions and edits are locked during export. Close, background, Android blur or
  a changed composition cancels preparation; returning does not automatically share. Cancel and
  Android Back confirm discarding a nonempty caption. Share-sheet dismissal leaves the draft open
  and makes no claim that anything was posted.

## Capture and cache

`react-native-view-shot` is pinned to **5.1.0**. Android capture options specify output pixels;
iOS divides the target by `PixelRatio`, matching the installed native implementations. The
adapter reads the PNG IHDR header and refuses to share a file unless its actual dimensions equal
**1080 × 1080** or **1080 × 1920**.

Using SDK 57's `Directory`/`File` API, capture files are copied to the dedicated `postcards`
cache and the original capture is released. Failed copies and abandoned, unshared copies are
deleted immediately. Files passed to the OS are retained for 24 hours, including sheet dismissal
or a rejected native sharing promise, because another app may already hold a reader. Composer
entry and each export remove expired, owned postcard PNGs only. Sharing uses `image/png` and
`public.png`. Export errors do not touch recording health.

## Automated verification

| Check | Result |
| --- | --- |
| TypeScript | `pnpm typecheck` passed. |
| Expo lint | `pnpm lint` passed without warnings. |
| Full Jest suite | **661 tests in 61 suites passed**, including 55 new postcard tests. |
| Android/iOS exports | Both passed; final output `/tmp/xc-postcard-final-export`. |
| Dependency validation, installed map | `EXPO_OFFLINE=1 pnpm validate:deps` passed; offline guidance is limited to the installed SDK map. |
| Dependency validation, online | Reports the same 21 existing SDK patch mismatches recorded for journal/replay. The new view-shot dependency is not reported as a mismatch. No coordinated SDK upgrade was attempted. |
| Native Android rebuild | `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` passed. Generated package list includes `RNViewShotPackage`. |
| Android installation | `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` returned Success on Samsung SM-S938B. Existing SQLite files were present before installation; no reset/uninstall was run. |
| Whitespace | `git diff --check` passed. |

Tests cover eligibility; partial/gap/no-route/point states; flight-local dates; missing fields;
attribution; captions and signatures; frozen query data; font/image/layout/commit readiness;
format/scene changes; stale taps/callbacks; duplicate submissions; close/background/blur;
errors and retries; native file URI normalization; platform dimension options; actual PNG header
validation; copy failure cleanup; original-capture release; and 24-hour retention/cleanup.
The adapter tests use mocked native files and sharing. They do not prove device rendering.

## Physical acceptance

The Android device connected successfully and the new development APK installed while preserving
app data. Metro was already running and ADB reverse was established. The phone remained at its
lock screen; an unlock was requested. **No postcard rendering, native PNG dimensions or receiving-app
preview results are claimed.** No iOS device or simulator verification was performed.

Pending Android checks after unlocking:

- [ ] Inspect all three scenes in Square and Story; pull generated PNGs from the postcard cache
  and independently inspect their dimensions, fonts, route proportions, gaps and printed labels.
- [ ] Long title, 140-character caption, emoji, signature opt-out, missing name and sourced-site
  attribution; check visible truncation and the exact captured composition.
- [ ] Enlarged text, narrow screen, keyboard scrolling, Cancel and Android Back confirmation.
- [ ] Offline generation, no usable GPS, partial flight and timing gaps.
- [ ] Duplicate Share taps; background/close during preparation; return stays idle.
- [ ] Share-sheet cancellation and retry preserve draft. Preview the image attachment in a
  receiving app without sending a message, then discard that app's temporary draft.
- [ ] Confirm recent shared files remain and expired owned files are cleaned on next entry/export.

Pending iOS checks: actual PNG dimensions at device pixel ratio, image/font/SVG capture,
full-screen modal and keyboard, sharing/cancellation, and attachment preview without sending.

Photo uploads, Save to Photos, video, hosted links, feeds, account tags and XC scoring remain
outside this increment. Artwork and captions stay local until the pilot invokes native sharing.

## References

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [SDK 57 capture reference](https://docs.expo.dev/versions/v57.0.0/sdk/captureRef/)
- [SDK 57 FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/)
- [SDK 57 Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/)
- [SDK 57 Font](https://docs.expo.dev/versions/v57.0.0/sdk/font/)

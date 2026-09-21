# Screenshot audit coverage

This is a visual inventory of the current Android app, not a claim that every conditional
state or feature has passed acceptance. A **primary route captured** means at least one
usable layout from that route is represented. It does not cover every permission, account,
fixture, network, loading, error, recording or scrolling variant of that route.

The final manifest contains **108 captures in 20 groups**, including **15 earlier same-build
acceptance captures** labelled separately. **All 15 route files** have a primary-route
screenshot. The [manifest](captures.json), generated [gallery](index.html),
[validation report](validation-report.json) and root README provide the file-level inventory.
Route coverage is complete at this level; conditional-state coverage remains partial.

The [planned screen inventory](planned-screen-inventory.md) is a source-derived target list.
Its priorities and state combinations are capture opportunities, not a list of actions all
required or performed during this session. `_layout.tsx` and the tab layout are shared
navigation/startup shells, not two extra routes.

## Device, build and fixture boundaries

See [device-and-build.json](device-and-build.json) for the captured environment: Samsung
SM-S938B, Android 16, portrait **1080 × 2340** original PNGs. Long pages use separate complete
phone viewports with overlap; originals are not stitched or resized. Gallery thumbnails are
only a navigation aid and link to those originals.

- **Normal owner app:** Settings and the existing downloaded-map list were viewed without
  changing owner data. The installed APK is `b3939fbc…`, recorded in the linked build receipt.
- **Isolated QA app:** Current onboarding, account, recording, local/restored flight, editor,
  postcard and social captures use `com.xxvalhallacoderxx.xcmvp.socialqa`, APK `eb763eb1…`.
  Its application JavaScript/assets are byte-identical to the normal APK, while package,
  signature, ARM64 packaging and native optimization metadata differ. This is separate app
  data, not a claim that these positive flows ran in the exact owner binary.
- **Current data:** The populated QA journal includes two synthetic archives restored through
  the normal account flow plus two temporary actual-GPS ground recordings, one saved as
  partial after controlled recovery. Synthetic tracks
  demonstrate layouts and are not new recorded flights or evidence of flight reliability.
- **Earlier same-build evidence:** Fifteen captures are explicitly labelled
  `disposable QA — earlier acceptance` in the manifest. They cover selected profile, feed,
  search, relationship and accepted/denied-profile states from the earlier pilot-search
  session. Those accounts were removed. They are not new actions by the current audit
  accounts. Their [acceptance report](../docs/pilot-search-2026-09-21.md) retains the original
  scenario, API-counterparty and cleanup boundaries.

Every capture's `accountKind`, `sourceBuild`, timestamp and notes remain authoritative for
its provenance. A different source commit label after the build is not evidence of a new
binary; use the APK identity and application-source verification in the build receipts.

## All 15 routes

“Captured” below describes the primary layout only. Conditional coverage is intentionally
partial, including for routes with several screenshots.

| Route source / path | Capture groups | Primary coverage and visible variants | Remaining limits |
| --- | --- | --- | --- |
| [`(tabs)/index.tsx`](../src/app/(tabs)/index.tsx), `/` | `logbook` | Captured: empty journal, active/resumed and genuinely interrupted recording cards, populated restored/local cards and scrolling parts. | Every quality/processing/load-error variant is not represented. |
| [`(tabs)/friends.tsx`](../src/app/(tabs)/friends.tsx), `/friends` | `feed`, `friends-profile` | Captured: signed-out entry, earlier empty feed, current own/friend flight cards, Give/Remove kudos state and automatic-sharing consent. | All publication/pending/error states, multi-page feed and legacy-profile gate are not covered. |
| [`(tabs)/account.tsx`](../src/app/(tabs)/account.tsx), `/account` | `account` | Captured: signed-out/signed-in scrolling parts, pilot editor/keyboard, email form/keyboard, empty OTP entry, backup/restoration, different-journal-owner notice, logout and delete-account confirmations. | Invalid/expired OTP, server/auth failures, all restoration progress/error states and account deletion completion are not captured. |
| [`record.tsx`](../src/app/record.tsx), `/record` | `recorder`, `system-permissions` | Captured: missing/granted-permission readiness, battery-policy warning, ground instruments, loading and rendered live map, leave confirmation, genuine interrupted recovery, save-partial confirmation and return to idle preflight. | The rendered map is online QA evidence. Offline coverage, endurance and every recovery failure remain unproven. |
| [`flights/[id].tsx`](../src/app/flights/[id].tsx) | `flight-detail`, `flight-edit`, `postcard` | Captured: saved ground recording, recovered partial and synthetic restored archive, full scrolling parts, expanded integrity, diagnostics/export actions and unconfirmed deletion dialog. | Not every gap/no-track/processing/archive-download state, publication state or failure has an image. Dialog copy is recorded as displayed, not inferred from account state. |
| [`flights/[id]/replay.tsx`](../src/app/flights/[id]/replay.tsx) | `replay` | Captured: archived replay map, chart/timeline/controls and playing at 60×. | Original-recording speed/gap variants, error/fallback/denied states and all control configurations are not represented. |
| [`settings.tsx`](../src/app/settings.tsx), `/settings` | `settings` | Captured on normal owner app: upper settings, legal and app-information sections. | Alternate hardware/readiness states and external legal-browser pages are not covered. |
| [`offline-maps.tsx`](../src/app/offline-maps.tsx), `/offline-maps` | `offline-maps` | Captured: normal-owner saved-area list; isolated QA empty/search/results, suggested region and estimate, downloading, Ready, update preview and delete confirmation. | No paused transfer was captured: the attempted pause occurred after completion. Resume, update-in-progress, storage/network/error combinations remain gaps. |
| [`friends/manage.tsx`](../src/app/friends/manage.tsx), `/friends/manage` | `manage-friends`, `friends-profile` | Captured: current own profile/editor, discovery control/consent, pending, accepted and blocked connections; earlier conflict/hidden/unblocked examples are labelled. | Legacy completion, all request/empty/error combinations and action pending states are partial. |
| [`friends/search.tsx`](../src/app/friends/search.tsx), `/friends/search` | `pilot-search` | Represented by nine earlier same-build captures: instructions, results, outgoing/incoming/accepted, no results, block confirmation, offline and signed-out. | These are not newly repeated by the current audit accounts. Page 2, rate limits, overlong query and injected error/retry layouts are not captured. |
| [`friends/[id].tsx`](../src/app/friends/[id].tsx) | `friend-profile` | Captured: current accepted friend with a nonzero backed-up-flight count; earlier same-build zero-count and removed-profile denial are separately labelled. | Not every loading/offline/error variant is represented. |
| [`shared-flights/[id].tsx`](../src/app/shared-flights/[id].tsx) | `shared-flight` | Captured: current author's shared-flight view, route, statistics, kudos and provenance over two scrolling parts. | Friend/author action differences, every artifact/quality variant, replay-disabled and revoked/error states are not all captured. |
| [`shared-flights/[id]/kudos.tsx`](../src/app/shared-flights/[id]/kudos.tsx) | `kudos` | Captured: supporters-list layout. | Empty, >25 supporters, filtered/denied/error/pending and unsupported-server variants are not covered in this current capture group. |
| [`shared-flights/[id]/replay.tsx`](../src/app/shared-flights/[id]/replay.tsx) | `shared-replay` | Captured: shared replay map and chart/playback controls. | Recorder-priority, unavailable artifact, authorization/network failure and fallback variants are not covered. Cached map tiles do not make shared replay offline-capable. |
| [`+not-found.tsx`](../src/app/+not-found.tsx) | `navigation` | Captured: unknown-route notice and return-to-logbook action. | One current QA route-error layout; no universal deep-link compatibility claim. |

## Overlays and system surfaces

These belong to their parent routes rather than increasing the route count.

| Surface | Current evidence | Limit |
| --- | --- | --- |
| First-run/review setup | `onboarding`: welcome, pilot, glider, location/permissions and optional backup. | Not all skip/back/validation/denied/busy states or transient startup/splash frames. |
| Android permission UI | `system-permissions`: precise-location dialog and background-location settings for the QA package. | Notification/battery/approximate-location variations and other Android versions are not implied. |
| Metadata editing | `flight-edit`: form, site search with keyboard and discard confirmation. | All site suggestion/error/loading cases and long localized text remain separate. |
| Postcard composer | `postcard`: flying/launch/landing scenes, square/story formats, controls, caption keyboard and discard confirmation. | **Share image was observed disabled and remains unresolved.** The screenshots do not prove a successful image export or recipient delivery. |
| Android share chooser | A system share sheet was opened without sending. | Recipient suggestions can reveal personal data, so that sheet is intentionally excluded from the saved gallery. No receiver-side file/image hash or send is claimed. |
| Destructive/account confirmations | Local-flight deletion, account deletion, logout and draft-discard dialogs are pictured where listed. | Opening a dialog does not establish confirmed deletion or successful account/backend cleanup. |

## Capture labels and controlled recovery

- [Rendered live map](screens/recorder/live-map-ready.png) shows the online basemap during
  a short stationary QA recording with actual GPS. The earlier
  [map-loading frame](screens/recorder/live-map.png) remains labelled as loading.
- [Update preview](screens/offline-maps/update-preview.png) is **not a paused download**.
  The download completed before the pause action, so paused/resume layouts remain uncaptured.
- [Recording resumed after restart](screens/logbook/interrupted.png) retains its original
  filename, but its corrected title/notes identify an automatically resumed recording.
  The brief QA force-stop did not produce an interrupted state.
- Genuine interruption was then reached by revoking location permissions **only for the QA
  package** and declining its permission prompt. The normal owner app's permissions were
  unchanged. This produced [recorder recovery](screens/recorder/interrupted.png), the
  [interrupted logbook card](screens/logbook/interrupted-card.png),
  [save-partial confirmation](screens/recorder/partial-confirmation.png) and the
  [saved partial flight](screens/flight-detail/partial.png), followed by
  [idle preflight](screens/recorder/idle-final.png). This controlled scenario does not establish all termination/recovery or in-flight reliability cases.

## Conditional-state gaps

- Authentication/server error injection and synthetic network-error injection were not used.
  Normal sign-in/empty-code layouts and separately labelled offline notices are present; they
  do not cover invalid-code, expired-session, timeout, malformed-response or retry permutations.
- More than **20 pilot-search results**, **25 feed entries** or **25 kudos supporters** were not
  prepared. Screenshots therefore do not prove page controls or later-page layouts. SQL/unit
  pagination tests are separate evidence.
- Null-username legacy-profile completion is not captured. Existing profile/access invariants
  are tested separately; no owner's social identity was modified to manufacture that state.
- Low battery, a device without a barometer, unavailable hardware and every permission state
  are not represented. This handset's current sensors do not stand in for other hardware.
- No long-flight, endurance, field-GPS or safety/reliability claim follows from these images.
  Both ground sessions are temporary QA evidence. Controlled permission-loss recovery is
  captured; prolonged interruption, recovery/save errors and all termination modes are not.
- Downloaded-region **offline live-map coverage remains unproven** in this audit. The existing
  map list, download completion and an **online** rendered live map are not sufficient;
  cached basemaps/replay evidence
  from earlier feature acceptance must retain their original scenario boundaries.
- Storage exhaustion/reserve failures, paused/interrupted transfers, archive download
  corruption, interrupted saves and database/auth recovery failures were not captured in this
  visual pass. No owner database corruption or destructive reset is used to create them.
- Alternate font scaling, landscape, reduced-motion settings, dark appearance, iOS, web,
  other Android versions and other devices/ABIs were not audited. This is one portrait Samsung
  configuration, with occasional real keyboard/system overlays.
- Transient loading/spinner frames and all combinations of record/share/restore eligibility
  cannot be inferred from a stable primary-route screenshot.

Every route now has at least one image; the remaining conditional gaps stay explicit. Screenshot integrity validation checks files, dimensions and links; it does not close
behavioral acceptance, owner production review or the unresolved postcard export observation.

## Cleanup evidence

[Device cleanup](device-cleanup.json) passed: the isolated QA app was removed, the normal APK remained unchanged, and the six saved device preferences were restored. The controlled interrupted session was saved before cleanup.

[Hosted cleanup](hosted-cleanup.json) passed for all three disposable audit accounts and their verified Storage/public records. All pre-existing private flights (15), private profiles (1) and social profiles (0) retained their full-row fingerprints; this is not a full-database snapshot. Private fixture credentials were removed.

[Read-only owner verification](owner-preservation.json) confirmed the normal app remained signed in with **15 flights / 3:00 airtime**, precise/background location still granted, and the original **three Ready offline areas**. It was left on Logbook. The existing account and local journal were not reset.

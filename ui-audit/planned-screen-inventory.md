# Planned screen inventory

Source inventory for the design audit, checked on 21 September 2026. **All entries below are
capture targets, not claims that screenshots or behavioral acceptance are complete.** There
are 15 route files, plus first-run overlays, editor sheets, inline confirmations and Android
system surfaces. A screenshot of a route does not cover all its conditional states.

The current [normal installation receipt](../android/app/build/outputs/internal/pilot-search-20260921/installation.json)
records APK SHA-256 `b3939fbc8411bedbcf1ba8b9b2e4d8a976e1088c9a558ac50cf224122a5965ca`.
The [isolated QA installation](../android/app/build/outputs/internal/pilot-search-20260921/qa-installation.json)
records `eb763eb19e196d48d16d1d4472bcfdb34890ac8944e52f080ab3bf397015badf` for
`com.xxvalhallacoderxx.xcmvp.socialqa`. Label captures with their actual package/build. The QA
app uses the same application JavaScript but is a separate binary/data store; it does not
establish exact owner-APK coverage. Recheck installed identity before the capture session.

## Capture conventions

- **P0:** core layouts and common flows; capture first. **P1:** meaningful alternate, modal,
  offline or permission states that are practical to reach. **P2:** conditional/error states
  requiring a special fixture, transient failure, different hardware or another build. Keep
  P2 entries visible in the final gap list if they cannot be reached.
- Suggested folders below are logical groups. Keep original full-resolution phone images;
  number long-screen captures `01-top`, `02-middle`, `03-bottom` with slight overlap. Include
  the fixed navigation and bottom controls in their natural viewport. Do not present a crop or
  stitched image as an original full-screen capture.
- For forms, capture a clean resting state and one keyboard-open state with the focused field
  and primary action visible. Long text, disabled/pending buttons and error notices are separate
  states when they alter the layout. Capture dialogs above the underlying screen.
- Each capture group needs a short note: route/entrypoint, package/build, fixture, state,
  screenshot names, visible concerns and omissions. Pair PNGs with UI hierarchies where useful.
  Keep unmodified originals private if they contain owner data; use disposable pilot details
  for shareable design-review images. Never include entered OTPs or secret fixture files.
- Capture the real owner's existing journal/maps by viewing them. Use the isolated QA app for
  account switching, blank setup, draft changes, relationship actions and temporary recordings.
  Opening a destructive confirmation does not require confirming it. Do not rebind the owner's
  journal, delete owner data or manufacture recorder failures merely to obtain a screenshot.

## Route coverage map

| Route source | Visible entrypoint | Logical groups below |
| --- | --- | --- |
| [`(tabs)/index.tsx`](../src/app/(tabs)/index.tsx) | Logbook tab, `/` | 02 |
| [`(tabs)/friends.tsx`](../src/app/(tabs)/friends.tsx) | Friends tab, `/friends` | 11, 12 |
| [`(tabs)/account.tsx`](../src/app/(tabs)/account.tsx) | Account tab, `/account` | 08 |
| [`record.tsx`](../src/app/record.tsx) | Record button, `/record` | 03 |
| [`flights/[id].tsx`](../src/app/flights/[id].tsx) | Logbook flight card | 04, 05, 07, 11 |
| [`flights/[id]/replay.tsx`](../src/app/flights/[id]/replay.tsx) | Saved flight → Replay | 06 |
| [`settings.tsx`](../src/app/settings.tsx) | Account → Settings | 09 |
| [`offline-maps.tsx`](../src/app/offline-maps.tsx) | Settings → Offline maps | 10 |
| [`friends/manage.tsx`](../src/app/friends/manage.tsx) | Friends → Manage friends | 12 |
| [`friends/search.tsx`](../src/app/friends/search.tsx) | Friends → Find pilots | 13 |
| [`friends/[id].tsx`](../src/app/friends/[id].tsx) | Accepted friend's profile action | 14 |
| [`shared-flights/[id].tsx`](../src/app/shared-flights/[id].tsx) | Shared feed card | 15 |
| [`shared-flights/[id]/kudos.tsx`](../src/app/shared-flights/[id]/kudos.tsx) | View kudos count | 16 |
| [`shared-flights/[id]/replay.tsx`](../src/app/shared-flights/[id]/replay.tsx) | Shared detail → Replay shared flight | 17 |
| [`+not-found.tsx`](../src/app/+not-found.tsx) | Unknown route | 00 |

`_layout.tsx` and `(tabs)/_layout.tsx` supply the stack, tabs, splash/font gate and first-run
overlay; they are not additional navigable pages. Native tabs are visible only on Logbook,
Friends and Account. Record/detail/replay/settings routes sit above those tabs.

## 00 — Startup and navigation

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P1 | `00-startup/splash` — cold app launch | Native branded splash; first-run **Opening your logbook…** loading screen if observable | Cold launch; transient frames may require a short recording, reported separately from screenshots |
| P0 | `00-startup/tab-shell` — each tab | Logbook/Friends/Account selected states, icon/label hierarchy, safe areas and bottom inset | Any usable app state; covered alongside each tab's primary screenshot |
| P1 | `00-startup/not-found` — unknown route | **That screen does not exist**, explanation, Back to logbook | Explicitly target the intended package when opening a test route |

## 01 — First-run setup and permission education

Source: [onboarding overlay](../src/features/onboarding/components/onboarding-overlay.tsx).
Entrypoint: fresh QA installation or Settings → Review setup; review does not reset data.

| Priority | Target | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `01-onboarding/welcome` | Illustration, disclaimer, unacknowledged disabled setup action, acknowledged state, skip action | Fresh/review setup; no recording in progress |
| P0 | `01-onboarding/pilot` | Step 1/4, blank and filled pilot name/optional registration, field hints, keyboard | Disposable profile for edits; capture Skip/Continue/back chrome |
| P0 | `01-onboarding/glider` | Step 2/4, empty field, typed matching suggestion chips, selected glider | Disposable text; long name can be a secondary layout case |
| P0 | `01-onboarding/location` | Step 3/4, precise/background/notification rows; not-yet-granted and granted layouts | QA permissions in appropriate states |
| P1 | `01-onboarding/location-denied` | Permission not granted, Open Android settings, Not now | Denied permission state; restore original settings after capture |
| P0 | `01-onboarding/backup` | Step 4/4, optional-backup explanation, local/cloud comparison, email form, skip/Done | Signed-out QA; signed-in variant after optional OTP |
| P1 | `01-onboarding/backup-code` | Code entry, resend countdown, change email, verification error/busy where reachable | Disposable account and OTP flow; capture with code field empty |
| P2 | `01-onboarding/setup-errors` | Save/setup error and cloud-unconfigured variant | Naturally observed failure or dedicated build; do not claim current production availability |

## 02 — Logbook

Source: [Logbook route](../src/app/(tabs)/index.tsx), [logbook components](../src/features/logbook/components/).

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `02-logbook/populated` — Logbook tab | Greeting, season totals, month groups, flight illustrations/maps, metadata, Record floating action; top and lower list parts | Existing saved flights; view owner data without edits |
| P0 | `02-logbook/empty` | Empty-journal illustration/CTA; incomplete setup and completed-setup copy | Fresh QA journal; setup skipped/completed variants |
| P1 | `02-logbook/checklist` | Location/name/glider checklist, incomplete and completed entries | QA with selected setup items missing |
| P1 | `02-logbook/card-variants` | Healthy, partial, gaps, no-track, processing and restored archive cards; map and Grid thumbnails; long title/site | Appropriate completed fixtures; absence of a variant remains a gap |
| P1 | `02-logbook/open-recording` | Pinned **Recording in progress** card and Open recorder | Temporary QA recording; distinguish this neutral card from verified healthy GPS |
| P2 | `02-logbook/interrupted` | Pinned interruption card, Resume/Save partial and earlier flights | Naturally interrupted or separately prepared QA session |
| P2 | `02-logbook/loading-error` | Opening logbook, checking recorder health, recovery error, load failure/retry, pull-to-refresh | Observable loading/failure; no corruption of owner database |

## 03 — Pre-flight, recording and recovery

Source: [record route](../src/app/record.tsx), [recorder views](../src/features/record/components/).
Entrypoint: Record or the open-flight logbook card.

| Priority | Target | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `03-recorder/preflight` | Ready/degraded/blocked readiness summary, permission/sensor/battery rows, Start recording/Start anyway/settings actions, disclaimer | Idle recorder; capture current truthful capabilities |
| P1 | `03-recorder/preflight-permissions` | Ask again, location-services disabled, missing background permission, settings links | QA permissions/system-location states; separate Android dialogs in group 18 |
| P1 | `03-recorder/starting` | Starting GPS pill, unavailable telemetry, disabled/busy actions | Start a temporary ground QA recording; label it as a test |
| P0 | `03-recorder/instruments` | Healthy REC, elapsed/altitude/ground speed, battery, fix evidence, Instruments/Map switch, hold-to-stop | Temporary recording receiving actual fixes; a static image is not field validation |
| P0 | `03-recorder/live-map` | Map tab, compact instruments, recent trail/current pilot, follow caption, moved map/Recenter | Same temporary recording with usable GPS and map coverage |
| P1 | `03-recorder/map-fallback` | Grid overview, map retry, waiting/last-known position, disabled stale Recenter | Uncached offline area or naturally failed map; do not mislabel cached tiles as offline-region coverage |
| P1 | `03-recorder/leave-and-stop` | **Recording continues** back dialog; hold-progress state; accessible Stop recording? confirmation | Active QA recording; capture dialogs before deciding the next test action |
| P1 | `03-recorder/saving-saved` | SAVING/stopped telemetry, local finalization busy; saved-flight navigation and last-flight link on preflight | Stop the temporary QA recording normally |
| P2 | `03-recorder/health-warnings` | GPS stale, restarting GPS, inactive capture, low battery, no-barometer tag, error notices; compact readout layout | Genuine capability/failure or controlled QA fixture; not all variants exist on this handset |
| P2 | `03-recorder/interrupted` | Needs attention, last fix/stats, Resume and Save as partial; **Save as a partial flight?** confirmation | Recoverable QA session; no forced owner interruption |
| P2 | `03-recorder/recovery-errors` | Opening/checking recovery; recovery failed; stopped save failure and Retry saving stopped flight | Dedicated recovery/error fixture or observed failure |

## 04–07 — Saved flight, editing, replay and export

Sources: [detail](../src/app/flights/[id].tsx), [metadata editor](../src/features/flights/components/metadata-sheet.tsx),
[site suggestions](../src/features/flights/components/site-suggestions.tsx),
[replay player](../src/features/flights/replay/replay-player.tsx),
[postcard composer](../src/features/postcard/postcard-composer.tsx).

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `04-flight/detail` — logbook card | Hero/title/date/status, map/route plate, stats, personal insight if present, site/source, notes, edit, sharing, integrity and delete footer; capture full scroll | Completed original flight with a route |
| P1 | `04-flight/detail-variants` | Partial/gaps/no-track/processing/open-flight notices and disabled actions; long/empty metadata | Matching original flight fixtures |
| P0 | `04-flight/archive` | Restored badge, archive provenance, original IGC sharing, absence of raw recording diagnostics | Downloaded archive fixture |
| P1 | `04-flight/archive-waiting` | Summary-only/missing route, download error/retry, update waiting while previous route remains available, restoration-settings link | Archive summaries and pending/failed/update states |
| P0 | `04-flight/integrity` — expand evidence | Collapsed versus expanded recording-integrity rows, diagnostics action; archive provenance equivalent | Original flight; archive for comparison |
| P1 | `04-flight/delete-confirmation` | Permanent local deletion copy versus delete-everywhere copy | Local-only and account-backed fixture; cancel dialog for screenshot-only audit |
| P1 | `04-flight/unavailable` | Loading, Flight not found, load failure with retry | Missing fixture ID; load failure only if safely available |
| P0 | `05-flight-edit/form` — Edit flight | Full-screen title/site/notes editor, clean/dirty Save state, keyboard and multiline notes | Disposable completed original or archive |
| P0 | `05-flight-edit/site-picker` | Nearby launches, typed search, launch/place results and provider attribution; selected result | Usable flight start position and network; supplied launch/place queries |
| P1 | `05-flight-edit/site-picker-variants` | No start position → Use my current location; locating; no results; unavailable/offline/loading; dismiss | No-position fixture or controlled connectivity; permission prompt is external |
| P1 | `05-flight-edit/confirm-error` | **Discard unsaved details?** overlay; save failure, saving-disabled controls | Dirty disposable draft; failure only when naturally/safely reachable |
| P0 | `06-replay/original` — Replay | Map and Fit flight; telemetry/chart/timeline; paused/playing/end Play again; 1×/10×/60× selections, ±10s | Saved route with sufficient original fixes; top and controls parts |
| P0 | `06-replay/archive` | Restored/IGC notice, IGC precision, unavailable per-point ground speed | Downloaded original IGC archive |
| P1 | `06-replay/fallback-and-gaps` | Map loading/Grid fallback/retry; gap telemetry unavailable, missing altitude, partial badge | Offline uncovered region, map failure or matching gap/partial fixture |
| P1 | `06-replay/unavailable` | Missing/insufficient fixes, archive pending/invalid plus restoration link, load error/retry, recorder recovery/loading | Matching ID/fixture; retain reason-specific gaps |
| P0 | `07-postcard/composer` — Share postcard | Full-screen preview, Flying/Launch/Landing scenes, Square/Story formats, optional caption/counter, pilot-signature switch, Share image | Eligible completed flight; capture all three scenes and both formats, not necessarily every combination |
| P1 | `07-postcard/overlays` | Caption keyboard, **Discard postcard caption?**, preparation busy, share error/retry, preview/font error | Disposable draft; errors require an actual observable failure |
| P0 | `07-export/share-sheets` — IGC/diagnostics/postcard | Android share menu for unsigned original IGC, unchanged archived IGC, diagnostics JSON and image; returned success message | Eligible original/archive; stop before selecting an external recipient |

## 08–09 — Account, authentication and settings

Sources: [Account](../src/app/(tabs)/account.tsx), [account components](../src/features/account/components/),
[Settings](../src/app/settings.tsx).

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `08-account/signed-out` — Account tab | Identity card/totals, missing pilot fields, local-backup explanation, collapsed Sign in, legal footer | Signed-out QA; owner does not need signing out |
| P0 | `08-account/email` — Sign in | Expanded email form, keyboard, valid/invalid input, sending/error | Disposable email; no actual OTP visible in image |
| P0 | `08-account/otp` | Empty eight-digit code input, Verify button, resend cooldown/new code, use another email; error/pending variants if reachable | Normal QA OTP flow |
| P0 | `08-account/signed-in` | Pilot page, signed-in identity, backup status/pending counts, restoration card, legal and danger-zone footer | Disposable account; top/middle/bottom |
| P0 | `08-account/pilot-details` — name/ID/glider row | Sheet, three fields, IGC-header preview, Cancel/Save, keyboard and saving state | Disposable local pilot details; this is separate from the Friends profile |
| P1 | `08-account/sync-states` | Never/syncing/up-to-date/pending changes/deletions; paused for recording/recovery; failure and Sync now | Fixtures with eligible changes and normal sync lifecycle |
| P1 | `08-account/restoration` | Active progress/title/bytes, paused, waiting Wi-Fi, mobile consent, resume/retry, downloaded totals | Disposable cloud archive with route downloads; no new archive is implied by search-only fixtures |
| P2 | `08-account/account-mismatch` | Different-account warning and **Back up to this account instead** | QA journal bound to another disposable account; capture without rebinding real owner data |
| P1 | `08-account/confirmations` | **Log out?** and **Delete your account?** native dialogs; pending/error copies | Disposable signed-in account; capture/cancel unless cleanup explicitly requires deletion |
| P2 | `08-account/unavailable` | Restoring session/checking identity, cloud-unconfigured build, storage/auth/delete failures | Transient state or separate configuration/fixture |
| P0 | `09-settings/full-page` — Account → Settings | Recorder readiness, phone storage/totals, Metric-only units, Offline maps, Review setup, legal attribution, app/runtime/schema and disclaimer | Idle current app; top/middle/bottom |
| P1 | `09-settings/external-links` | Recorder/settings links, privacy-policy browser, account-deletion page when configured | Actual configured URL/system screen; external content identified as such |

## 10 — Offline maps

Source: [offline-map screens](../src/features/offline-maps/). All stages share `/offline-maps`;
the download preview is an inline page state, not a separate route or modal.

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `10-offline-maps/saved` — Settings → Offline maps | Storage used/free, multiple Ready areas, date/context/attribution, update/delete actions | Existing ready regions, viewed without deletion |
| P1 | `10-offline-maps/empty` | No saved areas and destination search | Fresh QA map store |
| P0 | `10-offline-maps/search` | Keyboard, submitted results with full administrative context, KKB expansion, explicit Bubos/Bubus alternative | Online Photon search; local town, province and country examples |
| P1 | `10-offline-maps/search-errors` | Too-short/no matches, loading, unavailable/retry and offline notice | Safe invalid/no-match query or disconnected QA |
| P0 | `10-offline-maps/preview` | Named bbox versus **Around …** 25 km coverage, shaded map/Fit coverage, broader-region link, estimate range, mobile consent, download action | Select local place and bounded region/country; no download required just to capture preview |
| P1 | `10-offline-maps/estimate-error` | Size estimate unavailable, Retry estimate, explicit Download without estimate; map preview failure/retry | Actual provider failure or dedicated test fixture |
| P1 | `10-offline-maps/transfer` | Downloading/updating progress, Pause/Cancel, one-transfer notice | Small temporary QA area; do not download large regions solely for screenshots |
| P1 | `10-offline-maps/resume-update` | Paused/error card and Retry/Resume; fresh confirmation/estimate with Resume or Update heading | Paused temporary area or existing ready region |
| P1 | `10-offline-maps/guards` | Offline, recorder recovery/recording paused notices; duplicate coverage notice; start/storage error | QA network/recorder/duplicate selection; storage failure only if naturally available |
| P1 | `10-offline-maps/delete-dialog` | Delete area confirmation explaining retained flights/shared resources | Temporary QA area; cancel for a design-only capture |
| P2 | `10-offline-maps/deletion-recovery` | Deletion pending, deferred until recorder idle, Retry delete after failure; missing update timestamp | Matching durable recovery state; no forced corruption |
| P2 | `10-offline-maps/unsupported` | Available on Android / Grid explanation | Non-Android build; not capturable as an Android-native screen |

## 11–14 — Friends feed, profiles and pilot discovery

Sources: [feed](../src/features/feed/feed-screen.tsx), [sharing controls](../src/features/feed/flight-sharing-section.tsx),
[Friends management](../src/features/friends/friends-screen.tsx), [search](../src/features/friends/pilot-search-screen.tsx),
[friend profile](../src/features/friends/friend-profile-screen.tsx). Invite-code controls are removed
from this build and must not be represented as current UI.

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `11-feed/empty-populated` — Friends tab | Empty feed; own and friend cards with map/summary, Find pilots/Manage friends, refresh and automatic-sharing card | Signed-in profile; accepted friendship plus published fixture for populated state |
| P1 | `11-feed/availability` | Signed-out/setup gate, offline/cleared data, loading/error/retry, legacy Complete profile notice | QA auth/network and legacy fixture where available |
| P1 | `11-feed/automatic-consent` | Future private/shared states, expanded full-route/audience consent, Turn on/Keep private, Stop sharing future flights, busy/error | Disposable owner with profile; capture consent before changing it |
| P1 | `11-feed/pagination` | Load more flights, loading and later page | More than one feed page; three search-only pilots provide no flight fixtures |
| P0 | `11-sharing/own-flight` — saved detail → Share with friends | Sign-in/profile gates; private/pending/shared/hidden/error states; Preview and Retry | Disposable eligible backed-up original/archive flight |
| P1 | `11-sharing/confirmations` | Inline Share consent and Hide confirmation; offline **Hide awaiting confirmation**, Retry hide, explicit Share again | Disposable shared flight; screenshots of pending are not server confirmation |
| P0 | `12-friends/setup` — Friends first visit / Manage friends | Initials preview, display name, username, discovery switch off/on, audience copy, create action; keyboard | B with no profile; valid/invalid form inputs |
| P0 | `12-friends/manage-profile` | Current name/@username and visible/hidden status; edit/complete form, Save/Cancel | Complete QA profile; unique-username conflict captured with draft retained |
| P1 | `12-friends/legacy` | Null-username profile with Complete profile while existing friends/feed remain | Legacy migrated disposable profile; separate fixture if not currently present |
| P0 | `12-friends/connections` | Incoming, accepted, outgoing and blocked sections; empty friends; username/legacy name rows and actions | A/B/C fixture relationships at each stage |
| P1 | `12-friends/dialogs-errors` | Block/remove native confirmation; unavailable/loading/action failure; offline disabled controls | Disposable relationships and safe connectivity changes |
| P0 | `13-pilot-search/entry` — Find pilots | Empty/short-query instruction, name versus @username search, keyboard, searching and empty results | Complete signed-in profile; visible fixture pilots |
| P0 | `13-pilot-search/results` | Name/initials/@username; none/Add friend, outgoing/Cancel, incoming/Accept/Decline, accepted/View profile | A/B/C visible profiles and staged relationships; no flight count in search |
| P1 | `13-pilot-search/actions` | Block confirmation, updating connection, sent/unavailable/rate-limited request notice; hide/rename disappearance after refresh | Authenticated fixture counterpart actions; do not use real pilots as test targets |
| P1 | `13-pilot-search/gates-errors` | Signed-out, incomplete profile, offline with retained query, overlong query, failure/retry | QA lifecycle/profile/network states |
| P2 | `13-pilot-search/pagination-rate-limit` | Load more at 20 results, later-page/loading state; search quota notice | At least 21 matching discoverable fixtures for pagination; genuine quota response for rate limit |
| P0 | `14-friend-profile/accepted` | Avatar, name/@username, aggregate backed-up flight count and explanation, Refresh | Accepted A/B relationship; zero and nonzero count examples if available |
| P1 | `14-friend-profile/denied` | Signed-out, offline, loading, inaccessible/nonfriend/removed/blocked error and Retry | Disposable nonfriend or revoked relation; do not infer access from seeing a name in search/kudos |

## 15–17 — Shared detail, kudos and replay

Sources: [shared detail](../src/features/feed/shared-detail-screen.tsx),
[kudos list](../src/features/feed/kudos-screen.tsx), [shared replay](../src/features/feed/shared-replay-screen.tsx).

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P0 | `15-shared-detail/friend` — feed card | Hero/map/stats, author profile action, replay, kudos, provenance and privacy exclusions; complete scroll | Visible synthetic published flight and accepted viewer |
| P0 | `15-shared-detail/own` | Your shared flight, own Friends-profile action, count/list with no self-kudos Give/Remove | Author signed in to QA |
| P1 | `15-shared-detail/variants` | Partial/gaps/no-track/replay-unavailable, recorded versus IGC provenance, source attribution | Matching publication artifacts and metrics |
| P1 | `15-shared-detail/gates` | Sign-in/connection notices, loading, invalid/missing/hidden/removed flight denial/retry; recorder disables replay | QA auth/connectivity/revocation and temporary recording |
| P0 | `16-kudos/card-detail` — Give/Remove | Count and desired action before/after confirmed Give/Remove, pending state, audience text; own post count-only | Published fixture, author and viewer sessions |
| P0 | `16-kudos/supporters` — View kudos | Empty list and populated names/initials, count, disclosure, Refresh; no profile links | Zero and two-supporter fixture states |
| P1 | `16-kudos/filtered-denied` | Viewer-specific block filtering; hidden/removed denied, offline/signed-out names cleared; error/retry; recorder-disabled mutation | A/B/C with reactions and accepted relationships |
| P2 | `16-kudos/pagination-unsupported` | Load more beyond 25, loading/error; endpoint-unavailable disabled controls | At least 26 supporters or separate older-backend fixture; current three pilots are insufficient |
| P0 | `17-shared-replay/available` — Replay shared flight | Map, fit, chart, telemetry, playback/speed/seek/timeline; recorded/IGC provenance framing | Authorized viewer plus usable shared artifact; capture top and controls |
| P1 | `17-shared-replay/gates` | Connect notice, recorder priority, recovery/loading, unavailable points, denied/retry/back | Auth/network/relationship changes or matching fixture |
| P1 | `17-shared-replay/map-fallback` | Shared replay remains online-only even if map tiles are cached; map error/Grid/retry while replay is authorized | Online shared artifact plus actual map error; no claim of offline social replay |

## 18 — Android and external overlays

| Priority | Target / entrypoint | Meaningful states and overlays | Prerequisites |
| --- | --- | --- | --- |
| P1 | `18-system/location` — onboarding/record | Android precise/approximate and foreground permission prompt; background-location Settings screen | QA permission state permitting prompt; system UI varies by Android version |
| P1 | `18-system/notifications-battery` | Notification prompt, app/location/battery settings opened from readiness; recording foreground notification if present | Real current OS screens; record values and restore temporary changes |
| P0 | `18-system/share` | Android image/file share sheet, destination chooser | Reuse group 07 captures; do not send to another person |
| P1 | `18-system/browser-map` | Configured legal browser sheet/page; map attribution dialog/links if exposed by SDK | Real external UI, clearly labeled separately from app-designed screens |
| P1 | `18-system/keyboard-dialogs` | Email/code/numeric/text keyboards and all app confirmation dialogs listed above | Reuse flow captures; keyboard/window insets are part of layout review |

## Fixture and coverage gaps to keep explicit

The current pilot-search helper supplies three disposable identities, A/C discoverable profiles
and B with no profile. It seeds **no flights**. It can support discovery and relationship
screens, but cannot by itself populate a journal, feed, replay, archive, postcard or kudos list.
Any earlier social artifacts must be checked for current availability; cleaned fixture IDs are
not usable capture prerequisites.

Additional groups therefore need a preserved existing flight or a separately prepared disposable
fixture: an original healthy track, an IGC archive, a visible shared publication, and (if covered)
partial/gap/no-track/open/interrupted sessions. Page controls require more than 20 pilot hits,
25 feed items or 25 supporters as appropriate. Three pilots do not prove pagination coverage.

Do not force low storage, corrupt a database, kill an owner recording, delete a real account,
rebind its journal or disable hardware permanently to make error UI appear. Unreachable
hardware/configuration, transient or destructive states stay **not captured**, with the reason.
Likewise, reduced-motion rendering, large system text, landscape, other Android versions/ABIs,
iOS and web are additional device/configuration passes, not implied by one portrait audit.

The final coverage ledger should mark each target **captured**, **partially captured** or
**not captured**, with filenames and the precise missing variants. A prior feature's acceptance
screenshot can be linked as historical evidence with its build/date, but must not silently stand
in for a current-build design capture. This inventory covers the source surfaces found above;
it does not promise every possible combination of permissions, data, network, errors and state.

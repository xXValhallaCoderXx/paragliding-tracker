# Flights shared with friends

Implemented and deployed on 21 September 2026, extending [Friends v1](./friends.md). This guide
describes the current code and separates focused checks from release and device acceptance.
[Kudos and supporter lists](./kudos.md) extend this release in PAR-39 and have a separate ledger.

## Experience and consent

**Friends** opens the feed after social-profile setup. **Manage friends** keeps the existing
profile, invite-code, request, removal and block controls. Cards include your own published
flights for preview and flights from current accepted friends, newest publication first.
Tap a card for its detail and replay, or its author for their profile. Feed pagination uses
publication time plus a stable activity identifier; editing a title or site does not reorder it.

Automatic sharing is **off by default**. Enabling it requires explicit consent to the fields
and audience below. Only new recordings begun with known consent are eligible after they are
saved and backed up. Existing flights and restored archives are not posted retrospectively.
An eligible completed or saved-partial flight can also be shared manually from its own detail.
Private backup, signing in and creating a Friends profile are not publication consent.

Current accepted friends can see all still-published history, including friends added later.
There is no per-flight recipient picker. Turning automatic sharing off cancels obsolete pending
automatic posts and stops future ones; already-published flights remain visible until hidden.
Re-enabling cannot revive an older consent generation. Sharing a hidden flight again requires
a fresh explicit action; Retry cannot undo Hide.

Own flight details show private, pending, shared, hidden or error state, with Preview, Hide and
Retry where applicable. An initial status read is busy; an unavailable read is unknown/error,
not proof that the flight is private. Hide can be queued offline. **Waiting to hide from friends**
means that the flight may still be visible until the server confirms the change.

## What friends receive

| Included | Excluded |
| --- | --- |
| Social display name and initials | Email, private pilot profile, glider/registration details and IGC headers |
| Flight title, site and attribution, date and start/end times | Private notes |
| Full route, including first/last locations; GPS altitude and available ground speed | Raw recorder files, pressure samples, sensor diagnostics and recording-integrity evidence |
| Saved duration, distance, altitude/speed summary, fix count, quality and partial/gap labels | Personal milestones, journal totals, edit/delete actions, postcard/IGC/JSON export |
| Full saved-route 2D replay with explicit recorded/IGC provenance | A local recorder session or imported entry in the viewer's journal |

There is no route trimming or start/end privacy zone in this version. The consent text says
that the full route is shared. Private title/site edits appear on an existing post after backup
sync without changing publication time; notes remain excluded. Existing external postcard and
file sharing keep their separate flows. Hiding cannot recall information someone already saw
or captured outside the app.

## Replay and lifecycle

The shared detail reuses the flight hero, statistics and map presentation through an explicit
safe projection. Replay reuses the existing Map/Grid player, time controls, altitude chart,
pan/zoom and Fit flight. Missing measurements, timing gaps and partial recordings stay visible.
Summaries without enough usable points remain viewable with replay unavailable.

Recorded replay is projected from usable saved GPS fixes. Archive replay is parsed from the
owner's verified IGC: it keeps IGC time/coordinate precision, bounds playback to its valid
points and leaves per-point speed unavailable. Its summary retains the backed-up metrics;
those metrics are not reconstructed from the rounded IGC. An archived route awaiting download
is not silently published as an empty track.

Friend feed, detail and replay require an online signed-in account and are held only in memory.
Backgrounding, losing connectivity or changing accounts clears visible shared data and rejects
late responses. Leaving a detail/replay releases its data; reopening checks permission again.
Shared static map images use no image cache; ordinary map tiles can reuse the common geographic
cache/downloads, but those tiles do not make a friend's flight available offline.

Recorder activity synchronously aborts in-flight social reads and publication work. Shared replay
cannot open during capture, and route transfers wait for recovery to finish and the recorder to
be idle. Recording starts from a synchronous consent snapshot and never waits for a social
network request. Failures leave the saved private flight intact.

Refresh, focus and reconnect obtain current server authorization; there is no push revocation or
polling. A remote Hide, removal or block closes future server reads, but an already-open view
on another phone changes only when it reauthorizes. A denied read also fences older responses.

## Durable publication and server access

Account-scoped SQLite preferences, capture stamps and publication intents survive restart.
Finalization queues automatic intent alongside the saved flight. A single foreground worker
waits for its private summary to back up, then prepares and uploads the approved replay artifact.
It runs on an available internet connection, including mobile data; this is separate from
the [private archive download](./private-flight-restoration.md) Wi-Fi preference.

Retries retain the same operation, consent generation and expected publication revision.
Transient errors back off from 30 seconds up to 30 minutes; explicit Retry advances a pending
attempt. Backgrounding, account changes, recorder arming and recovery stop work until eligible.
The server rechecks consent and visibility before activation so delayed uploads cannot undo a
newer Hide, delete, block or consent change. A failed attempt is not displayed as shared.

Private flight rows and the original IGC bucket remain owner-only. Narrow authenticated RPCs
return the approved summary to its owner or current accepted friends. Replay artifacts live in
a separate private bucket, `shared-flight-replays`; clients receive neither direct bucket access
nor reusable download URLs. The `shared-flight` function authenticates every request, verifies
the manifest/hash/size and checks authorization again after reading bytes. Responses use
`Cache-Control: no-store`. Artifact v1 accepts at most 100,000 points and 8 MiB; larger routes
fail visibly rather than being silently truncated.

Hide and individual-flight deletion revoke access separately from eventual artifact cleanup.
Cleanup work persists and retries; a cleanup failure must not reopen access or erase the private
flight. Account deletion first prevents new publication and waits for active upload leases,
then drains both private storage buckets before deleting the account. This remains distinct
from deleting an individual flight; the existing account-deletion flow retains local copies.

## Backend and app release order

1. Keep the private-archive migration `20260921120000_private_archive_restore.sql` and Friends
   migration `20260921130000_friends.sql` applied.
2. Validate and apply additive `20260921140000_shared_flights.sql`, including its private bucket,
   permissions, publication state, upload leases and cleanup queue; regenerate database types.
3. Deploy `shared-flight` and the updated `delete-account` functions. The deletion function now
   depends on the shared-flight migration, so deploy schema before functions.
4. Validate the matching app, export/build and install a compatible signed APK in place. Preserve
   the owner's journal, account and downloaded maps; do not uninstall or reset to test this feature.

Existing APKs continue their existing private backup/Friends behavior and do not publish flights
automatically. The new UI handles an unavailable feed backend without blocking the local journal.
No new native package is required, but a standalone APK must include the new JavaScript and local
database migration. Hosted rollout, installed hash and phone behavior need their own evidence.

## Acceptance ledger

This ledger concerns shared flights, not the earlier Friends v1 release. Do not carry forward
that build's server or device evidence as proof of this feature.

| Gate | Current evidence |
| --- | --- |
| Focused UI/lifecycle | 8 Jest suites / 59 tests passed for feed/presentation/consent/shared screens, provider/publication hook and touched flight detail/map preview. This includes 20 provider/hook tests for auth, focus, connectivity, recorder priority, stale responses and offline Hide. Owned-test ESLint and `git diff --check` passed. |
| Full app checks | TypeScript, ESLint and three architecture checks passed; 120 Jest suites / 1,066 tests passed, including three integrated setup regressions. |
| SQL and edge functions | 304 SQL assertions and 71 edge-function tests passed, including permissions, consent/revision races, pagination, artifact validation/cleanup and account deletion. |
| Auth/PostgREST/Storage/Edge | 44 checks passed both locally and on the hosted project using three disposable accounts. Recorded and restored IGC replay, exact bytes/hash, privacy, consent, Hide, removal/blocking, deletion and actual object cleanup were exercised. Fixtures were removed; all 15 existing private flight identities/update timestamps were unchanged. Repeat locally with `node scripts/test-shared-flights-http.mjs`. |
| Hosted deployment | Only `20260921140000_shared_flights.sql` applied; subsequent dry run is up to date. `shared-flight` v1 and `delete-account` v2 are ACTIVE with JWT verification enabled on the linked Paragliding Tracking project. |
| Android artifact/install | Corrected Android export and standalone release build passed. Existing signer, 16 KB alignment and unchanged non-signature payload verified. Compatible in-place Samsung install passed; installed SHA-256 matches the artifact. No uninstall or data reset. |
| Physical/shared-account acceptance | Corrected final APK passed Samsung setup/navigation smoke: stable no-profile setup, draft/initials retention across refresh/background/offline/reconnect, offline controls, existing 15-flight/3:00 journal and unavailable shared-detail/replay routes. Full two-account publication and successful shared playback remain pending. |

The Android build uses source snapshot SHA-256
`2e00ca595c95b2869e73f83f241870d4f06ee902526c10d220e46e76aa2a1976`,
base commit `f5517ec` plus the captured working tree. Artifact directory:
`android/app/build/outputs/internal/shared-feed-v1-20260921-fixed/` (ignored).
APK SHA-256: `0a1335d5fbb35a1824d03083ca91b2cac76bc75eea7b3e9d250f77894cd71a9c`.
Installed on Samsung SM-S938B at 20 September 2026 17:45:06 UTC (21 September in Singapore).
Existing certificate SHA-256: `3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`.
Application source remained unchanged through the build. Dependency versions are unchanged;
the existing SDK 57 patch-version recommendations remain open.
Documentation may be completed after the source snapshot without changing the built application.

The first installed preview exposed a refresh loop when no Friends profile existed. The setup
screen now remains mounted through loading, errors and offline/reconnect. Three tests use the
real Friends provider/controller and setup screen to cover that transition and explicit profile
creation. The original preview and finding remain in the sibling `shared-feed-v1-20260921/`
artifact directory; it is superseded by the corrected build above.

On the corrected APK, the unsaved test name was cleared, the owner's profile and flights were
not published, and original Wi-Fi/mobile/Bluetooth/airplane/timeout settings were verified
restored. Screenshots, UI hierarchies, assertions and the install receipt are retained in the
artifact directory. This smoke checks installed setup/lifecycle and denied-route presentation;
it does not establish successful two-account feed/replay acceptance. PAR-38 and PAR-16 remain
In Progress for that work. PAR-14's relationship acceptance and the independently deferred
PAR-22 production/PAR-28 live-GPS checks also remain open.

Remaining physical two-account cases (the server paths have the separate automated/API evidence above):

- Owner A, accepted friend B and unrelated C: publish/preview/read; C, pending, removed and blocked
  accounts cannot read detail or replay. B added later sees published history. Exercise pagination.
- Default off; enable then record/save/sync once; no old-flight backfill or duplicate on restart.
  Disable/re-enable while a post is pending. Manually share an old local flight and restored IGC.
- Verify title/site changes without feed reordering and private fields absent from responses/UI.
  Compare recorded and IGC playback, partial/no-track/gaps, unavailable speed and large-route errors.
- Interrupt upload and retry; Hide offline and restart, reconnect and confirm server removal.
  Race Hide/delete/consent changes with upload; a late response must not resurrect a post.
- Background, reconnect and switch accounts during feed/detail/replay reads. Revoke access from a
  second account while open and verify the next check clears it. Arm the recorder during transfer.
- Delete only disposable fixtures, verify artifact cleanup and original journal/maps unchanged;
  test account deletion only with disposable accounts. Restore any changed device settings.

Kudos, comments, notifications, public/share links, live viewing, route privacy zones, social
offline downloads and iOS physical acceptance remain outside this delivery.

## Additional three-pilot acceptance — 21 September 2026

The later [isolated Samsung run](./social-qa-2026-09-21.md) supplies positive native evidence
for the feed, accepted-friend detail, IGC replay with play/pause/speed/seek/scrub, explicit
manual publication of a restored archive, author preview, and Hide/re-share. An offline Hide
survived force-stop/cold launch, remained honestly pending while friends could still read it,
then revoked server access on reconnect. Refresh kept it hidden; only explicit re-share
restored access. Friendship removal and sequential account switching cleared access correctly.

This used an isolated QA package with identical application JavaScript, separate app data and
a different signer/package/ABI boundary. Native and API counterparty steps are identified in
the report. All test identities/objects and the QA package were removed; original settings,
owner sign-in, 15 flights / 3:00 airtime and three Ready offline areas were preserved.

PAR-38/PAR-16 remain In Progress for their broader matrix: automatic publication of a newly
recorded flight, consent changes during pending work, recorded-fix/partial/gapped and large
routes, interrupted transfers, recorder priority, native pagination and exact normal-APK
acceptance. The newly passed restored-IGC/manual-sharing checks are no longer wholly pending;
they do not establish those unexercised recording or field cases.

## Source map

| Responsibility | Source |
| --- | --- |
| Feed, consent, shared detail/replay and own-flight controls | `src/features/feed/`, `src/app/shared-flights/` |
| Narrow social contracts, validation, transport and lifecycle controller | `src/social/feed-*` |
| Durable worker, safe artifact projection and backup integration | `src/cloud/publication-*` |
| Capture consent and transactional publication intent | `src/recorder/sharing-preference-cache.ts`, `src/recorder/publication-repository-core.ts` |
| Authorization and immutable artifact delivery | `supabase/migrations/20260921140000_shared_flights.sql`, `supabase/functions/shared-flight/` |

# PAR-22: private flight restoration

Implementation and acceptance record, 20 September 2026. The feature is implemented in this
checkout. Hosted deployment, a matching installed APK, and physical restoration acceptance are
separate gates; the status table below records only observed checks.

**The repaired `988bfdc7…` APK passed focused recovery, offline replay, fixture deletion and
post-deletion cold restart on the Samsung.** Its installed hash matches the verified artifact.
The intermediate `7d4d635f…` cold-launch failure and its repair remain documented below. No
database reset was used. Broader fresh-instance, two-device and other acceptance gates remain
open in the checklist.

Signing in restores the account's saved flight summaries into the normal logbook automatically.
There is no per-flight import step. Archived IGC routes download over Wi-Fi by default. Restored
flights contribute their backed-up summary metrics to totals and support metadata editing,
replay, postcards, and sharing the original IGC when the required data is available. Recording
continues to work without an account or network.

## Local data and account boundaries

- SQLite schema **9** adds account-scoped archive summaries, verified IGC bytes, derived thumbnail
  geometry, download state, edit/deletion queues, restoration settings, and catalogue cursors.
  The existing recorded-flight and sensor tables retain their evidence. Archives do not create
  synthetic recorder sessions, raw GPS samples, pressure samples, or capture events.
- `src/journal/` combines recorded flights with the visible account's archive rows. The original
  recording wins when both sources have the same flight ID, avoiding duplicate logbook entries
  and double-counted totals. The original recording/session identity is retained.
- Signed-out use retains the last account's already downloaded archives and the local recordings.
  Signing into another account changes archive visibility and resets account-sensitive query
  caches; old asynchronous responses cannot populate the new account's visible journal. Local
  recordings remain on this device. Uploading a logbook linked to a different account still
  requires the existing explicit account-link action.
- Summaries remain usable when no archived route was backed up or its download fails. The UI
  distinguishes a route waiting to download from a flight whose original summary reported no GPS.
- Catalogue pages use `(updated_at, id)` ordering with a 200-row page size. A cursor advances only
  after its row has been persisted. Foreground synchronization also reconciles the full catalogue;
  an absent row is never interpreted as an instruction to erase local evidence.

The archive repository stores a verified file and its derived geometry atomically. A changed
manifest queues a replacement while retaining the previous verified file for replay/export.
Only a completed replacement supersedes it. The logbook reads cached thumbnail geometry rather
than reparsing every full IGC whenever the list refreshes.

## Restoration policy and controls

The Account screen shows restoration progress and **Pause**, **Resume**, or **Retry** as relevant.
It downloads one IGC at a time while the app is foregrounded and the recorder is ready and idle.
Backgrounding, lock, loss of usable connectivity, recorder arming/capture, and recorder recovery
revoke transfer eligibility. A late response cannot commit after the operation is revoked.
The recorder is observed through its passive activity subscription; restoration does not add a
GPS watcher, poll recorder state, or delay Start behind a download.

Wi-Fi is the default for IGC transfers. Summary synchronization may use mobile data. The
**Allow mobile data for this restore** switch starts off and applies only when the user invokes
Resume/Retry. Permission is cleared when the restore run finishes or the account changes.
A user-requested pause is persisted per account and requires Resume; temporary policy pauses
can continue when the foreground/network/recorder checks are eligible again.

Downloads check the owner-specific object path, expected size and SHA-256 before durable use.
The maximum IGC size is **25 MiB**, matching the private bucket. Storage preflight preserves a
**512 MiB** free-space reserve and allows for temporary/SQLite copies. Low-space failures leave
summaries intact and offer Retry after space is freed. Temporary download files are cleaned up;
an interrupted transfer restarts that file rather than claiming byte-range resume. Independent
flights may continue after one failed artifact, while the error remains visible.

## Replay and export provenance

Restored flights carry a **Restored** badge and an archive provenance explanation. Cloud start,
end, duration, metrics, title, site, notes, and recorded timezone remain the summary source for
the logbook and totals. They are not recomputed from a lower-precision IGC.

Replay parses the app's own archived IGC format. It validates the UTC date and century against
the cloud flight interval, ordered timestamps and midnight rollover, coordinate ranges, fix
validity, and fixed-column records. Second-resolution samples are compared with the cloud
interval rounded down to seconds, matching the existing writer. It rejects ambiguous whole-day
gaps rather than guessing dates. Third-party IGC import is outside this feature.

Replay starts at the first validated archived position and ends at the last, which can differ
from the summary's complete recording interval. GPS altitude and coordinates retain IGC precision;
ground speed is unavailable. No pressure, battery, diagnostics, sub-second positions, or missing
samples are reconstructed. Fewer than two usable timestamps yields an unavailable replay, while
the summary and any verified original export remain available. Gaps over 15 seconds retain the
existing replay behavior.

The existing replay player, map, Grid fallback, and completed offline map areas are reused.
Downloading an IGC does **not** download a basemap; use [Offline maps](./offline-maps.md) for that.
**Share original archived IGC** shares the stored bytes unchanged, including original pilot/glider
headers. Editing today's profile or the restored flight's title does not rewrite the archive.
Recorder diagnostics are available only for a genuine local recording.

## Edits and deletion

Title, site, site attribution, and notes remain editable, including while offline or signed out.
Archive edits queue against their original account. The metadata-only server RPC cannot modify
flight facts, metrics, or IGC references. A newer client edit timestamp wins; an equal or older
timestamp retains the server's accepted metadata. The canonical response is merged before the
exact uploaded dirty revision is acknowledged, so an edit made during sync is not accidentally
cleared. This is whole-metadata last-write-wins behavior; device clock skew can affect the winner.

Deleting an individual saved flight requires the **Delete this flight permanently?** confirmation.
It removes this phone's copy immediately and queues deletion from the account and other linked
phones when they synchronize. That includes the original raw recording on a phone that has it,
but only when its account/flight/session identity is verified and the recording is finished.
Active or recoverable capture is not silently erased.

The server stores a durable deletion marker before Storage cleanup. Local deletion receipts stop
a stale catalogue row from restoring the flight. Database triggers and Storage policies also
block an older client from recreating the deleted identity or re-uploading its IGC. Storage cleanup
uses the Storage API; failure keeps a retryable marker rather than reporting the object removed.
Downloads of a marked object remain denied while cleanup is pending. These markers are explicit
authority for deletion; a failed/empty list, missing cloud row, or an account switch is not.

**Delete cloud account** is a separate action. It removes the hosted account and its private
backups and signs out, while retaining the phone's local logbook and downloaded files. The auth
cascade does not emit individual-flight deletion instructions to other phones. Reinstalling after
account deletion cannot recover files that existed only in that deleted cloud account.

## Deployment order and older APKs

1. Verify the existing hosted migration history, then apply
   `supabase/migrations/20260921120000_private_archive_restore.sql`. It adds site attribution,
   owner-only deletion markers, canonical write/deletion/cleanup RPCs, and deletion-aware Storage
   policies. Review the migration dry run before applying it.
2. Verify owner isolation, RPC behavior, and actual Storage download/removal on disposable data.
   Local pgTAP tests do not replace a hosted Storage API check.
3. Build a standalone APK from the verified source, record its source snapshot and SHA-256, and
   install with the existing compatible signing key using an in-place update. Preserve the owner
   logbook and map downloads; do not uninstall or clear app data to test restoration.
4. Complete the physical scenarios below on that exact APK. Upgrade every phone participating in
   cross-device acceptance before asserting that all copies were removed.

The new app depends on the new RPCs and schema; installing it before the server migration can
leave sync in an actionable error state. Local capture is still independent. The server migration
protects legacy direct writes/deletes, but an old APK does not gain restoration, archive provenance,
or remote deletion of its local recordings. It may show a backup error when trying to resend a
deleted flight. Upgrade it to apply the new policy locally. After local schema 9 is opened, an APK
that supports only schema 8 refuses the newer database; downgrading is not a rollback procedure.

## Automated evidence

The application-source run for the initial `d43909ed…` APK passed **100 Jest suites / 878 tests**,
TypeScript, ESLint (including three architecture checks), and **28 function tests**. Logs and its
source snapshot are retained with the APK below. Phone checks subsequently exposed sync status
and scheduling issues. The intermediate sync-fix source passed **100 Jest suites /
885 tests**, TypeScript, ESLint and its **three architecture checks**. Focused engine/policy checks
passed **58 tests**, and the independent archive review passed **44 tests**. The previously passing
**116 database tests** and **28 function tests** cover unchanged backend/function code; they were
not rerun for those client-only sync fixes. The subsequent cold-launch failure requires additional
local deletion and startup-repair changes. **32 migration tests**, including **five new repair
cases**, passed for that repair. The repaired source subsequently passed **100 Jest suites /
896 tests**, TypeScript, ESLint with **three architecture checks**, Android export, and a
standalone release build. Its in-place installation and installed hash are verified. Focused
repaired-APK phone results are recorded below, separately from the remaining physical gates.

| Check | Observed status |
| --- | --- |
| IGC parser | 18 tests passed: writer round-trip, rounding, malformed records, date/year/midnight rollover, unambiguous >24-hour flight, six-hour track and real gaps |
| Account/flight/logbook/postcard integration | 24 focused suites passed, 201 tests at that checkpoint; subsequent changed parser/detail/provenance suites passed 30 tests |
| Provider lifecycle | Tests cover passive recorder priority, fast recovery, stale overlapping network reads, account cache reset, controls, and listener cleanup |
| Archive catalogue/deletion integration | 23 cases passed: 501 catalogue rows, equal-timestamp paging, 201 deletion markers, durable checkpoints, stale owner replies, canonical edits, and verified cleanup acknowledgements |
| Native download boundary | 19 focused tests passed: storage preflight, path/owner/size validation, authenticated request without logging credentials, original bytes, cancellation/late response, and temporary-file cleanup |
| Local PostgreSQL, RLS, Storage-policy and concurrency checks | 116 tests passed across four files; generated database types matched (`/tmp/par22-backend-db-final.log`) |
| Intermediate sync-fix client checks | 100 Jest suites / 885 tests passed on frozen source; focused engine/policy 58 tests and archive review 44 tests also passed; subsequent device cold launch failed |
| Startup repair | 32 migration tests passed, including five new repair cases; four deletion entry paths reproduced the missing child cleanup before the fix |
| Repaired client checks | 100 Jest suites / 896 tests passed; Android export and standalone release build passed |
| TypeScript / lint | Repaired source passed, including all three architecture checks |
| Local Auth/PostgREST/Storage HTTP | 24 checks passed with two independent sessions for the same owner and a second owner. Exact IGC bytes, metadata conflicts, RLS, deletion/anti-resurrection, and actual Storage removal passed. The isolated stack was removed (`/tmp/par22-backend-http-root.log`). Repeat with `node scripts/test-private-archive-http.mjs`. |
| Hosted migration | Applied only `20260921120000_private_archive_restore.sql` to linked project `dqbmbkalksunxbjldxdo`; subsequent dry run reports up to date (`/tmp/par22-hosted-deploy.log`, `/tmp/par22-hosted-readback.log`). No edge function was deployed. |
| Hosted Auth/PostgREST/Storage HTTP | 29 checks passed using two disposable accounts and two independent sessions for owner A. Includes exact original bytes, foreign-owner/anonymous denials, stale/equal metadata conflicts, explicit deletion, late upload/write rejection, physical Storage removal and retained deletion marker. All registered test accounts and artifacts were removed (`/tmp/par22-hosted-http.log`). This is API evidence, not two Android installations. |
| PAR-22 APK / installation / physical restoration | Intermediate `7d4d635f…` failed cold launch and must not be handed off. Repaired `988bfdc7…` installed with matching hash and passed focused startup recovery, cold-offline replay, fixture deletion and post-deletion cold restart. Earlier `d43909ed…` observations remain separately attributed. |

The separate Expo dependency check reports newer SDK 57 patch versions. Dependencies and the
lockfile were left unchanged; that advisory check did not pass. Compilation and the tests above
ran against the existing pinned versions.

## Initial standalone Android artifact

- Branch: `feature/par-22-flight-restoration`; base commit `8c84d51d9da67b5fb640b0bf3153c4ca8032551d`
  plus the captured working tree.
- Artifact directory: `android/app/build/outputs/internal/par22-restoration-20260920/` (ignored).
- APK: `FlightLogAlpha-1.0.0-flight-restoration.apk`.
- APK SHA-256: `d43909ed70d19b22b8c6b2b607a41db0df593c1048bd6f860e7f6a4ca5f665f4`.
- Source snapshot SHA-256: `2e34b302d5f72d1ba74aabe17700aeeca0458b61fe436c70611127685ffab40a`.
- Existing signing certificate SHA-256:
  `3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`.
- Gradle release build succeeded in 1 minute 15 seconds. Signature, alignment, and unchanged
  non-signature APK payload verification passed. No application source changed during the build.
- Installed on the Samsung SM-S938B using `adb install -r`; `installation.json` records the
  matching installed hash at **14:01:58 UTC on 20 September 2026**. No uninstall or database reset
  was performed. Phone acceptance and temporary-fixture cleanup are recorded below.

## Initial APK physical observations

All results in this section belong to **`d43909ed…665f4`**, not a later replacement build.
Evidence is in the initial artifact's `device-checks/` directory. Account identities and unrelated
notification captures are private and are not reproduced here.

### Automatic restoration and retained data

Before the update, Account and Settings showed **6 local flights / 0:05 airtime**. On launch after
the compatible update, **9 pre-existing cloud archives** restored automatically. Account showed
**15 flights / 3:00 airtime**, and restoration reported **9 of 9 archived routes saved on this
phone**. The existing profile remained present. This proves restoration of existing cloud-only
flights onto the owner's installation; the installation was not a clean second instance.

Evidence: `baseline-account`, `baseline-settings`, `updated-account`, `updated-restoration` and
`updated-restoration-bottom` XML/PNGs. An original local flight still showed **How this was
recorded** and original recording provenance in `preserved-original-evidence`. Final Settings
readback showed **15 flights / 3:00** (`final-settings`) and **Recorder schema v9**
(`final-settings-bottom`). `final-offline-maps` and `final-offline-maps-bottom` showed
all **three saved map areas Ready for offline use**, with **187.9 MB** shared map storage retained.

### Cold-offline fixture, replay and share sheet

A temporary **PAR-22 restoration check (temporary)** flight was inserted into the exact current
owner's cloud archive without modifying the 15 pre-existing flight rows. It became the **16th
flight**, with **10 of 10 archived routes saved on this phone**. The fixture has **61 IGC positions**,
a **2-minute** summary duration and **321.25 m** summary distance. Its original IGC is **2,849 bytes**,
SHA-256 `3e3bacb9ea25403642fb347191e61548e8589ea04194779b0f011630417bab4c`.
The private `fixture-state.json` records the baseline and exact identities for bounded cleanup.

After force-stop and relaunch, **airplane mode was on, Wi-Fi was off, and the active default network
was none** (`offline-network.json`). The restored fixture's summary, route and map background
loaded from disk. Its archived replay rendered the basemap, first/last positions and archive
provenance; ground speed displayed **—**. Play/Pause and scrubbing worked; at **0:01:00**, the GPS
altitude readout was **110 m**, with a total replay extent of **0:02:00**. These checks sample the
fixture inside existing downloaded map coverage; they do not exhaustively validate coverage,
long-flight gaps, or every replay interaction.

Evidence: `fixture-cold-offline-detail`, `fixture-offline-replay`, `fixture-offline-controls`,
`fixture-offline-playing`, `fixture-offline-paused` and `fixture-offline-scrubbed` XML/PNGs.
**Share original archived IGC** opened the Android chooser offline at **14:09:01 UTC**
(`offline-share.json`). No recipient was selected, and no received/exported file was retained
for a SHA-256 comparison. The chooser observation therefore does not prove receiving-app handoff
or exported-byte equality, although the source artifact's hash is recorded above.

### Offline edit, deletion and restoration of device settings

An edit to the temporary fixture persisted while offline and survived app restart. After the
network returned, the edited metadata reached the hosted row. Evidence includes
`fixture-offline-saved`, `fixture-offline-edit-restarted`, `fixture-edit-online`, and
`/tmp/par22-device-online-recheck.log`. The server readback also confirmed that all **15 original
owner flights were unchanged**, excluding the server's `updated_at` field. This is one-phone
offline-edit synchronization, not a physical two-phone conflict test.

Only that temporary fixture was deleted through the app's permanent-delete confirmation.
`fixture-delete-confirmation` and `fixture-deleted-logbook` record the UI. The independent
`/tmp/par22-device-delete-recheck.log` readback confirmed:

- Fixture manifest absent; durable deletion receipt present.
- Fixture Storage object absent; cleanup pending **false**, with a recorded cleanup completion.
- Owner flight count back to **15**; all 15 pre-existing rows unchanged apart from server
  `updated_at`.

No original owner flight or account was deleted. This proves the app-to-hosted deletion path and
actual fixture Storage cleanup; it does not prove another Android installation has applied that
deletion to its original raw recording. A subsequent cold restart exposed an orphan local archive
artifact left by this deletion. The server cleanup observations remain valid, but local deletion
and cold-start acceptance did not pass; see the failure and repair record below.

`radio-restored.json` and `final-radio.json` confirm all four recorded radio settings match the baseline: airplane mode
**off**, Wi-Fi **on**, mobile data **on**, and Bluetooth **on**. Final Settings/map evidence is
described above. No power-setting restoration claim is made beyond the recorded checks.
The app-PID-filtered `final-app-runtime-errors.log` is empty. The unfiltered capture includes an
earlier UI Automator utility crash, which is not an application crash. This log window preceded
the later cold-launch integrity failure and must not be cited as evidence against that failure.

### Sync fixes and intermediate build — cold-launch failure

The phone run exposed sync presentation/scheduling gaps: archive edits and deletions were missing
from pending counts, and post-save work could wait behind throttling or an already running sync.
The successful eventual edit/delete readbacks above do not establish prompt, correct pending-state
behavior. The corrected source now includes archive edits/deletions in pending counts even during
retry backoff, lets post-save work bypass the routine sync interval without bypassing error backoff,
coalesces mutations arriving during an active sync into follow-up work, and guards retries at their
backoff deadline. The corrected Account copy distinguishes pending flight changes and deletions
and uses neutral completed wording.

The intermediate artifact directory is
`android/app/build/outputs/internal/par22-restoration-20260920-final/`. Its frozen source snapshot
SHA-256 is `b77cad788a7a87869404422c8a1194a6dbb9208d3d19c752b88fd340f528acd0`.
APK SHA-256 is `7d4d635f44ce13a2f9f0f3618da124ebcc18f79e3cb1b45500a62d5612bfa33f`.
It was installed at **14:21:56 UTC**, but cold launch **failed** with **one violation from
`foreign_key_check`**. This APK is not a handoff candidate.

The fixture deletion left an orphan `archive_artifacts` row. The failure was reproduced: Expo's
exclusive write transaction uses a new connection that does not inherit `foreign_keys=ON`, so
the expected parent-delete cascade did not remove the child. Regression tests reproduced the
problem through all four deletion entry paths. Cleanup is now explicit in the three implementation
paths, without depending on that connection's cascade setting.

### Repaired build — focused physical checks passed

- Artifact directory: `android/app/build/outputs/internal/par22-restoration-20260920-repaired/`.
- APK SHA-256: `988bfdc7cc6bc4eb1e5c6399ffd767790279d492bc0134a6a24a735a9e6a823a`.
- Source snapshot SHA-256: `8d0b522830dbcf25225f8efc712704b2ce45464699c0aed34a8831a4454e39cb`.
- Android export passed. The standalone release build passed in **1 minute 9 seconds**.
- Signature, alignment and unchanged non-signature payload verification passed. No application
  source changed after the captured snapshot.
- Installed in place at **14:27:25.632506 UTC on 20 September 2026**. The repaired artifact's root
  `installation.json` confirms its installed hash matches `988bfdc7…`. No uninstall/reset was used.
- After owner unlock, startup recovery, cold-offline replay, temporary-fixture deletion, and
  another cold launch passed on this exact installed APK, as recorded below.

The startup repair is deliberately narrow: it removes an orphan artifact only when the same
owner and flight have a matching durable deletion receipt. A database backup is retained.
Unexpected corruption is not silently discarded: integrity failures roll the repair back and
leave the database protected. No uninstall, app-data reset, or recreation of the owner's logbook
was used. The migration tests cover the repair boundaries; the successful phone startup and
post-deletion restart below provide the focused device evidence.

All following files are in the repaired artifact's `device-checks/` directory unless stated
otherwise. These observations belong to **`988bfdc7…e6a823a`**.

1. **Recovery and restoration:** `unlocked-recovery` and `recovered-profile` show the app opened
   successfully with the existing profile and **16 flights / 3:02 airtime**: the original 15 plus
   a new bounded temporary fixture. `recovered-restore-status` shows **10 of 10 archived routes
   saved**. The former integrity error did not prevent startup.
2. **Cold offline replay:** the app was force-stopped and relaunched with **airplane mode on,
   Wi-Fi off and no active default network** (`offline-network.json`, 14:52:23 UTC). The fixture's
   replay rendered its basemap, first/last route positions and archive provenance, with initial
   **90 m** GPS altitude and **—** ground speed. `cold-offline-replay` records this state. After
   scrubbing to **1:00** and playing at **1×**, `offline-scrub-play-pause` shows playback paused
   at **1:03**, **110 m** altitude, and the **Play** button. This samples the fixture within
   existing downloaded map coverage.
3. **Only the temporary fixture deleted:** the app's confirmation is captured in
   `temporary-delete-confirmation`; `deleted-logbook` returns to **15 flights / 3:00**. The first
   immediate server sample still found the Storage object. A later independent readback in
   `par22-repaired-deleted-recheck.log` confirmed the fixture manifest and Storage object absent,
   its durable deletion receipt present, cleanup pending **false**, and all **15 original owner
   flights unchanged**, excluding server `updated_at`. This demonstrates completed cleanup
   after a later readback, not instantaneous remote object removal.
4. **Post-deletion cold restart:** `post-delete-cold-account` shows a fresh app launch with
   **15 flights / 3:00 airtime** and the retained profile, without the previous database integrity
   failure. This directly retests the failure caused by deleting a restored archive.
5. **Radios restored:** `radio-restored.json` at **14:53:18 UTC** confirms airplane mode off,
   Wi-Fi on, mobile data on and Bluetooth on, all matching their baseline.
6. **Settled data and maps:** `final-restoration-status` shows **9 of 9 archived routes saved**,
   **Last backup: Just now**, and no eligible pending work. `final-map-regions` and
   `final-map-regions-bottom` show **Jugra, Singapore and Terengganu all Ready**. Shared map storage
   is now **188.2 MB**, compared with 187.9 MB in the initial readback. This total includes shared
   resources and cache, so the area-retention result is not a claim of unchanged byte usage.
7. **Final preservation and device readback:** `final-settings-schema` shows **Recorder schema v9**;
   `final-settings` shows **15 flights / 3:00**. `preserved-original-evidence` shows a genuine
   original recording with **2 GPS fixes**, **12 s / 34 m**, **Recording integrity**, and unsigned
   IGC export, preserving its recorded provenance. The app-PID-filtered
   `final-app-runtime-errors.log` is empty. `final-radio.json` again confirms all four radio
   settings match baseline, and the installed APK hash was reread as **`988bfdc7…e6a823a`**.
   The phone was left on **Logbook**, using Back to return there.

The observed **Sync now** tap at **14:53:41.710 UTC** preceded deletion confirmation at
**14:54:22.400 UTC** by **40.69 seconds**. This session therefore does **not** establish a physical
post-save bypass within the 30-second routine sync interval; the dedicated automated tests cover
that boundary. There was no account switch or second Android instance, and no receiving-app IGC
hash comparison in this repaired-build retest.

The retained `d43909ed…` artifact remains the reference for the initial offline edit and share-sheet
observations. The distinct repaired-build observations above establish only the checks actually
repeated on `988bfdc7…`.

Relevant tests are under `src/archives/__tests__/`, `src/cloud/__tests__/archive-sync.test.ts`,
`src/cloud/__tests__/restore-transfer.test.ts`, the account/flight UI tests, recorder SQLite tests,
and `supabase/tests/private-archive*.test.sql`. Previous PAR-28 map acceptance does not establish
PAR-22 new-device restoration or deletion acceptance.

## Physical acceptance checklist — partial

Use disposable account/flight fixtures for destructive and account-switch tests. Record APK hash,
installed hash, source snapshot, device/OS, account alias, network state, timestamps, screenshots,
and redacted logs. Retain the owner's existing flights and downloaded map regions. A second app
instance/device or isolated test profile is required for genuine new-device/cross-device proof.

| Scenario | Required observable result | Status |
| --- | --- | --- |
| Compatible upgrade | Original recordings, replay, profile, and offline map areas remain intact after schema 9 migration | Repaired APK recovered and cold-restarted after deletion with original 15 flights/3h and profile; final 9/9 archives and all three map regions Ready |
| Existing-install archive restoration | Cloud-only summaries/IGCs appear automatically alongside recorded flights without duplicate counting | Initial APK: nine existing archives restored; 9/9 ready and 6 → 15 flights |
| Fresh account restoration | A clean test instance signs in, restores all summaries and IGCs automatically, and matches cloud counts/totals without duplicates; include >200 flights | Pending |
| Wi-Fi and explicit mobile permission | Cellular alone restores summaries but waits for IGC consent; Resume with consent transfers files and completion clears permission | Pending |
| Interruption and manual pause | Background/lock/network loss cancels transfer safely; foreground resumes when eligible; explicit Pause survives cold restart until Resume | Pending |
| Capture priority | Start/arm and recovery interrupt restoration promptly, recording starts normally, and late download callbacks cannot commit during capture | Pending |
| Low space / malformed artifact | Storage, size/hash, missing-object and invalid-IGC cases preserve the summary, show useful retry/unavailable states, and do not claim usable replay | Pending |
| Cold offline use | Force-stop and relaunch without a usable network; restored summary, totals, detail, cached route, replay and original IGC sharing work from disk | Repaired APK cold-offline replay passed; post-deletion cold restart passed. Initial detail/chooser observations remain on d439; receiver-file hash comparison pending |
| Replay and offline basemap | Archived first/last bounds, null speed, gaps, Play/Pause/seek/scrub and Fit behave correctly; completed downloaded coverage renders with Grid fallback outside it | Repaired APK sampled offline basemap, first/last, null speed and scrub/1× Play/Pause passed; broader interactions/gaps/coverage pending |
| Original export | Shared IGC SHA-256 matches the original backup; editing profile/title does not rewrite headers or bytes; diagnostics are unavailable for archives | Chooser opened offline; no receiver selected or receiver-file hash compared — pending |
| Metadata conflict | Offline edits synchronize across two instances; newer edit wins, equal/stale edit retains canonical metadata, and a mid-sync local edit stays queued | One-phone offline edit persisted restart and synced; physical two-instance conflicts pending |
| Sign-out/account switch | Signed-out cached archive remains usable; switching A→B hides A's archive and replay/query data without erasing the device's own recordings | Pending |
| Delete every copy | Confirm a disposable restored flight deletion; all upgraded instances remove that identity, including its original finished raw recording; stale offline clients cannot resurrect it | Repaired APK deleted only its fixture, hosted manifest/Storage cleanup completed, and cold restart passed with original 15 retained; second Android/raw-original propagation pending |
| Cleanup failure | Simulated Storage failure leaves deletion effective and cleanup visibly retryable; retry removes the remote object without restoring the flight | Pending |
| Delete cloud account | Disposable account deletion removes hosted data while keeping local recordings/downloads, and does not issue remote raw-recording deletion instructions | Pending |

After device checks, remove only test-created fixtures where appropriate, confirm the original
logbook/map counts, restore radio/power settings, and record that restoration. Physical acceptance
does not replace the separate locked-screen/endurance flight-recording reliability gates.

# Friends v1: profiles and flight counts

Selected 21 September 2026. PAR-12 records the scope decisions; PAR-13 owns server
permissions and PAR-14 owns the app experience. Validation and delivery evidence are
recorded separately below.

This is the historical foundation and its v1 acceptance record. The subsequent
[shared-flight feed](./shared-flights.md) adds opt-in publication and remote detail/replay;
its release evidence is tracked separately. Current Friends navigation opens that feed after
setup, with these connection controls under **Manage friends**.

## First experience

Open **Friends**, sign in through Account if needed, and choose a social display name.
The initials avatar and name are separate from the private pilot/export profile. Saving
this name enables invitations; sign-in alone does not publish a social profile.

Send your private invite code through the phone's share sheet. A recipient enters it in
Friends and sends a request, which you can accept or decline. Accepted friends can open
each other's profile to see the display name, initials and **Backed-up flights** count.
Pending requests show names only. There is no public pilot directory.

Requests can be cancelled, friends removed, and pilots blocked or unblocked. Removing or
blocking closes future server access. Unblocking does not restore a previous friendship.
Regenerating an invite code invalidates the old code without changing existing connections.

The v1 build described here has no individual flight list, activity feed, kudos, route sharing, photos,
notifications or shared replay. Postcard and file sharing continue through the existing
external share menus.

## Count and privacy boundaries

The count is derived by the server from completed or saved-partial backed-up summaries with
complete metrics, using the archive reader's completeness rules. Zero-fix/no-track flights
with metrics count; an IGC upload or download is not required. Unfinished flights and rows
without complete metrics do not count. Pending uploads and deletions can make this differ
from the owner's local logbook. A failed read is an error, never a zero count.

Social profiles, invitation codes, relationships and blocks are separate from private
profiles, flights and IGC storage. Narrow authenticated RPCs return only the approved social
fields. Clients cannot submit a flight count or read another pilot's private backup rows.
Account deletion cascades social records after the existing private storage cleanup.

Social data is held only in memory and follows the currently signed-in account, not the
journal's retained owner. Sign-out, account changes, backgrounding and loss of connectivity
clear visible social data. Late requests cannot populate another account's view. Focus,
reconnect and explicit Refresh obtain current authorization; there is no background polling
or real-time delivery. Remote removal becomes visible on the next successful authorization
check, not as a push notification.

## Backend and release order

Apply `20260921130000_friends.sql` after the existing private-archive migration. It is
additive and leaves private backup access policies unchanged. It introduces explicit
social-profile setup, random rotatable codes, canonical requests, blocking, and constrained
profile/count reads. Requests and relationship changes serialize per pair; current request
identities protect newer requests from delayed cancellation/removal.

Invalid code attempts are bounded server-side. Exact-code requests do not provide a search
or enumeration API. A code grants the ability to request a connection, not profile access.

Verify the migration locally before hosted rollout, then build a matching Android preview.
An older APK can continue private backup; it does not gain Friends. A new APK against a
server without the migration must report social unavailability without blocking recording
or the local journal. No new native dependency is required.

## Acceptance record

The first stage is implemented, the additive migration is deployed, and the standalone
preview is installed on the Samsung. Device interaction acceptance remains separate.

| Evidence | Result on 21 September 2026 |
| --- | --- |
| App checks | TypeScript, ESLint and three architecture checks passed; 106 Jest suites / 956 tests passed. The final generic confirmation-title change also passed the 12 Friends UI tests. |
| Database | All seven SQL files / 236 assertions passed, including permission matrices, rate limits, cascades and two-connection races. Generated types match the applied schema. |
| Edge functions | Existing 28 tests passed. No new edge function is required. |
| Local Auth/PostgREST | 30 checks passed with three disposable accounts; fixtures were removed. Repeat with `node scripts/test-friends-http.mjs`. |
| Hosted Auth/PostgREST | The same 30 checks passed on the linked Paragliding Tracking project. Disposable accounts were removed; all 15 existing private flight identities and update timestamps were unchanged. |
| Hosted migration | Only `20260921130000_friends.sql` was applied. Subsequent dry run reports up to date. |
| Android | Export and standalone release build passed. Signature, 16 KB alignment, unchanged non-signature APK payload and installed hash verified. Compatible in-place install; no app uninstall or data reset. |
| Dependency check | Existing SDK 57 patch-version recommendations remain; package versions were not changed for Friends. |
| Physical acceptance | Samsung setup smoke passed: name/initials preview, empty-name validation, refresh, tab navigation, background/resume and offline/reconnect with draft retention. The logbook still renders 15 flights and 3:00 airtime. Profile publication, invitation/relationship actions and two-account device acceptance remain pending. |

Preview artifact directory: `android/app/build/outputs/internal/friends-v1-20260921/` (ignored).
The directory retains source, logs, build metadata and installation evidence.

- APK: `FlightLogAlpha-1.0.0-friends.apk`.
- APK SHA-256: `b3734f3ae5a1ad4d8988044fd97d9bc97a75785b29418c511913af5e0b58cc47`.
- Source snapshot SHA-256: `c34ddc05b72461707b7b98398ce94d50f407a6dbe3928182468c1eb88b058c3d`.
- Base commit: `f5517ec22454f4d9be39800caf7dc1db1fe23d00` plus the captured working tree.
- Certificate SHA-256: `3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`.
- Installed on Samsung SM-S938B at 20 September 2026 16:17:33 UTC (21 September in Singapore).

The Gradle input used its local debug certificate; the final preview was signed with the
existing installed-app certificate. No signing key was created or rotated. Every non-signature
APK entry was verified unchanged. Application source remained unchanged through the build;
this acceptance record was completed afterwards.

### Samsung setup smoke — 21 September 2026

The owner unlocked the installed preview for a bounded setup check. Friends rendered the
explicit profile setup and consent text. An unsaved `Test Pilot` draft showed `TP` initials
and enabled Create; empty and spaces-only names disabled it. The draft survived manual refresh, switching
to Logbook and back, and background/resume. Logbook rendered its existing 15 flights and
3:00 season airtime.

With both Wi-Fi and mobile data disabled over USB, Friends showed its connection notice,
kept the draft and disabled editing/creation. Restoring connectivity cleared the error and
re-enabled the form without manual refresh. Wi-Fi, mobile data, Bluetooth and airplane-mode
settings were verified back at their original values. Screenshots, UI hierarchies and radio
state evidence are retained under `device-checks/owner-smoke/` in the artifact directory.

The temporary name was cleared afterwards. No social profile was published and no
invitations or relationship changes were submitted.
This checks initial setup and recovery on the installed build; it does not complete the
two-account device flow. PAR-14 remains In Progress.

Remaining end-to-end/device scenarios (server behavior already has the separate proof above):

- Two independent accounts set up names, exchange a code, accept and view profiles; a third
  account and an anonymous caller cannot read their profiles or counts.
- Invalid/self/duplicate/crossed requests, rotation, stale requests, concurrent accept,
  removal and blocking obey server permissions. Unblocking requires a fresh request.
- Count changes reflect finished backup and deletion, including partial/no-track summaries;
  private notes, registration, email, coordinates and IGCs remain inaccessible.
- Sign-out/account switch during reads and writes, offline failure, focus/reconnect refresh,
  and account deletion do not expose stale social data or erase local flights.
- The existing recorder, restoration and external sharing retain their behavior.

PAR-22 production testing and PAR-28 live GPS acceptance remain deferred independently.

### Additional three-pilot acceptance — 21 September 2026

The later [isolated Samsung run](./social-qa-2026-09-21.md) adds positive native evidence to
the historical setup-only record above: profile creation, sending a code-based request,
accepting a counterparty request, accepted-profile count, unrelated-profile denial,
block/unblock, removal, sign-out and sequential account switching all passed. Counterparty
requests/acceptance were performed through authenticated fixture APIs where specified.

The QA package used the current kudos JavaScript bundle with separate app data. It was removed
afterward, along with all three disposable accounts and their files; the original owner app,
15-flight journal and downloaded maps were preserved. PAR-14 stays In Progress: code sharing/
rotation, decline/cancel/error and concurrent-request device cases, plus exact normal-APK
acceptance, were not covered by this run. See the linked report for precise evidence boundaries.

# Pilot search acceptance — 21 September 2026

PAR-14 now replaces invitation codes with **Find pilots** and explicit mutual requests.
Implementation, automated checks, Android export, release build and final signing have passed.
The hosted migration and HTTP regression checks have passed with existing private rows
preserved. The exact signed APK is installed in place. The bounded native discovery and
friendship checks below passed in an isolated QA installation. The QA package and
fixtures were removed afterward, with owner data, installation and device settings preserved.
Owner production review remains separate from these bounded checks.
Earlier [social QA acceptance](./social-qa-2026-09-21.md) remains evidence for the
previous code-based version; it does not validate the new discovery flow.

## Delivered scope

**Friends → Find pilots** opens a dedicated search screen beside **Manage friends**. Pilots
choose a display name and an editable unique `@username` containing 3–24 lowercase ASCII
letters, numbers or underscores. New profiles visibly default **Show me in search** on;
signing in alone creates no profile. Profile edits save explicitly, and username conflicts,
refresh and temporary disconnection preserve the draft for the same account.

Existing profiles without a username offer **Complete profile** before discovery or new
requests. Their accepted friends, pending requests and shared-flight access remain available.
Turning visibility off prevents discovery and new incoming requests without removing existing
connections or pending requests. Hidden pilots may still search and request visible pilots.

Search requires at least two characters after an optional `@`, waits 350 ms after typing,
and provides pages of 20 with **Load more pilots**. Names use literal substring matching;
usernames use prefix matching, with exact handles first. Leading `@` restricts the search to
usernames. The screen explains short/overlong queries, loading, no matches, retry and rate
limits. Results contain names, usernames, initials and relationship state; no flight counts,
routes, private fields or stranger-profile links are included.

Result actions follow the server relationship: Add friend, cancel an outgoing request,
accept/decline an incoming request, or open an accepted friend's profile. Stranger blocking
requires native confirmation. Crossed requests remain pending until one side explicitly
accepts. Invitation-code entry, sharing and rotation have been removed.

Search results are held only in memory while online and foregrounded. Query changes, blur,
backgrounding, connectivity loss, auth changes and relationship revisions cancel or reject
stale reads; pending mutations suspend searches. Query drafts survive transient failures for
the same account. Actions have no offline queue. Server authorization and rate limits remain
authoritative. See [the current Friends contract](./friends.md#current-discovery-contract--21-september-2026)
for privacy and deletion boundaries.

## Source and build evidence

Artifacts are retained under
[`android/app/build/outputs/internal/pilot-search-20260921/`](../android/app/build/outputs/internal/pilot-search-20260921/)
(ignored). The [build record](../android/app/build/outputs/internal/pilot-search-20260921/build-record.json),
source archive, manifest and working-tree diff identify the build inputs.

| Item | Recorded state |
| --- | --- |
| Source base | `572d49d5dc2907d862cf2325ac64f09389550c63` plus the captured working tree |
| Source snapshot | `58577f252a5e28d42f3ca2fadf5eedd9a39bb3c67d11d7464061e99be5b8195c` |
| Snapshot captured | 20 September 2026, 20:29:47 UTC / 21 September, 04:29:47 Singapore |
| Android export | Passed |
| Android release build | Passed in 2 minutes 3 seconds |
| Signed APK SHA-256 | `b3939fbc8411bedbcf1ba8b9b2e4d8a976e1088c9a558ac50cf224122a5965ca` |
| Signing certificate SHA-256 | `3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`, matching the existing installation |
| Signature / alignment / signing payload | Verified signature, 16 KB alignment and unchanged non-signature payload |
| Application source after build | All 251 application files match the captured snapshot |
| Installed APK hash / in-place installation | Exact signed hash matched on Samsung SM-S938B; `adb install -r` at 20 September 2026, 20:58:41 UTC / 21 September, 04:58:41 Singapore; no uninstall or reset |

No native dependency or permission was added. The dependency check retains the previously
known Expo SDK 57 patch-version recommendations; package versions were unchanged for this
feature. Those warnings are separate from export/build success.

## Acceptance ledger

| Check | Current evidence |
| --- | --- |
| SQL permissions, search, relationship transitions and races | Passed: 13 files / 469 assertions |
| Local authenticated Friends HTTP checks | Passed: 46 checks |
| Local authenticated shared-feed HTTP checks | Passed: 44 checks |
| Local authenticated kudos HTTP checks | Passed: 31 checks |
| Focused Friends/search/feed UI | Passed: 6 suites / 32 tests |
| Focused social domain/provider | Passed: 4 suites / 100 tests |
| Final full app Jest run | Passed: 125 suites / 1,195 tests, superseding the initial 1,191-test run |
| TypeScript, ESLint and architecture checks | Passed |
| Edge functions | Passed: 71 tests |
| Regression verifier | Passed |
| Hosted migration | Applied only `20260921160000_pilot_search.sql`; subsequent dry run is up to date |
| Hosted existing-data preservation | All 15 baseline private flight rows and one private profile unchanged; zero owner social profiles before and after |
| Hosted post-cutover HTTP regression checks | Passed: Friends 46, shared feed 44, kudos 31; all disposable HTTP accounts and files cleaned |
| Exact signed APK installation | Passed: installed hash matches the signed artifact, with no reset |
| On-device existing-data preservation | Final readback passed: owner still signed in, 15 flights / 3:00 airtime, and all three map areas Ready |
| Native pilot-search/profile/request acceptance | Bounded isolated-QA checks passed below; 26 saved-capture assertions across 28 XML captures passed; exact normal-APK positive flows and listed unrun scenarios remain separate |
| Final QA cleanup | Three test accounts, QA package and private fixture credentials removed; device settings restored |

The UI tests cover username validation and conflict draft retention; explicit default
visibility; legacy-profile feed access; setup refresh without remount loops; debounce,
pagination and late-result rejection; query retention across temporary failure/offline;
account isolation; relationship-specific actions; native block confirmation; mutation-busy
search suspension; and ignored late results after blur or relationship revisions. These are
automated component tests, not physical phone evidence.

The local Friends HTTP fixtures were cleaned successfully. Stopping the local test stack
left an empty Docker network, which was explicitly removed afterward. The hosted HTTP
fixture accounts and files were also cleaned after all three regression runs passed. New
native QA fixtures were subsequently removed at the final phone-session cleanup below.

## Coordinated pre-release cutover

The matching app was built before applying `20260921160000_pilot_search.sql`. Only that
migration was applied to the hosted project, and a subsequent dry run reports up to date.
Full baseline readback confirms 15 private flight rows and one private profile unchanged.
The matching signed APK was then installed in place and its installed hash verified. The migration preserves account/profile/relationship IDs,
blocks, publications, kudos and private flights; private backup policies are unchanged. It
adds username/discovery fields and ID-based search/request/block APIs, and removes the old
invitation-code tables/functions and one-field profile-save API.

Old social APKs are unsupported after this cutover. There is no data wipe, account recreation
or automatic publication of an existing profile. Hosted migration readback, disposable-account
HTTP checks and preservation evidence must be recorded independently of the local test results.

## Installed packages and current native progress

The [normal installation receipt](../android/app/build/outputs/internal/pilot-search-20260921/installation.json)
confirms the installed hash equals
[`FlightLogAlpha-1.0.0-pilot-search.apk`](../android/app/build/outputs/internal/pilot-search-20260921/FlightLogAlpha-1.0.0-pilot-search.apk).
No owner app uninstall or data reset occurred. The owner app renders the new display-name,
username and search-visibility setup fields in
[installed-owner-setup](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/installed-owner-setup.png).
The captured baseline has [15 flights and 3:00 airtime](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/before-logbook-corrected.xml)
and [three Ready map areas](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/before-offline-maps.xml)
([lower rows](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/before-offline-maps-lower.xml)).
Final post-test preservation readback is recorded below, separately from these baseline captures.

The isolated native session uses
[`FlightLog-QA-pilot-search-arm64.apk`](../android/app/build/outputs/internal/pilot-search-20260921/FlightLog-QA-pilot-search-arm64.apk),
SHA-256 `eb763eb19e196d48d16d1d4472bcfdb34890ac8944e52f080ab3bf397015badf`,
package `com.xxvalhallacoderxx.xcmvp.socialqa`. This is a non-debuggable ARM64 release build
with a separate package, signing certificate and app data. Its JavaScript bundle and
application assets are byte-identical to the normal build; the native dex optimization
profile differs as expected. The [QA build verification](../android/app/build/outputs/internal/pilot-search-20260921/qa-build-verification.json)
and [QA installation receipt](../android/app/build/outputs/internal/pilot-search-20260921/qa-installation.json)
record those boundaries and confirm the owner APK stayed unchanged. QA installation completed
at 20 September 2026, 20:59:52 UTC / 21 September, 04:59:52 Singapore.

## Native discovery and friendship checks

The checks used one Samsung with sequential disposable native accounts: **Asha Search QA**
(A), **Ben Search QA** (B), and **Cora Search QA** (C). Ben and then Asha signed in through
the native app. Counterparty requests and A/C visibility changes identified below used the
authenticated fixture API. These are not three simultaneous phones. No fixture flight was
created in this run; accepted-profile counts of **0** are true fixture counts, not error
fallbacks. Normal owner-app evidence covers setup rendering only; the positive flows below
used the separate QA package with verified identical application JavaScript/assets.

Each linked filename identifies a capture under `qa-device/` in the artifact directory;
same-named PNG and JSON companions provide its screenshot and capture receipt. The independent
[device-evidence verification](../android/app/build/outputs/internal/pilot-search-20260921/device-acceptance.json)
passed 26 assertions across 28 saved XML captures. Those read-only assertions establish
displayed states and before/after ordering; the runner supplied tap, radio, lifecycle and
fixture-API context. The verifier did not independently perform those operations.

| Check | Observed result and boundary | Capture |
| --- | --- | --- |
| Setup and username conflict | Ben attempted Asha's username; the native error retained his name/username draft and the enabled default **Show me in search** switch. A unique username then created his profile and opened the empty feed. | [username-conflict-draft.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/username-conflict-draft.xml), [profile-created-feed.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/profile-created-feed.xml) |
| Name and exact-handle search | `Asha` and `@qa_164ef2ad_a` found Asha with initials, name, username and relationship actions; stranger results exposed no count or profile link. | [name-search.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/name-search.xml), [incoming-request.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/incoming-request.xml) |
| Outgoing request/cancel | Ben sent Asha a native request and cancelled it; the result returned from **Cancel request** to **Add friend**. | [outgoing-request.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/outgoing-request.xml), [request-cancelled.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/request-cancelled.xml) |
| Incoming decline/accept | Asha requested Ben through the fixture API. Ben declined natively. A new API request was then accepted natively, enabling Asha's profile with **0 Backed-up flights**. | [request-declined.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/request-declined.xml), [request-incoming-again.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/request-incoming-again.xml), [request-accepted.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/request-accepted.xml), [accepted-profile.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/accepted-profile.xml) |
| Hidden accepted friend | Asha disabled discovery through the fixture API. Ben's exact-handle search then returned no results, but their accepted friendship and Asha's profile/count remained available. | [hidden-friend-search-empty.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/hidden-friend-search-empty.xml), [hidden-friend-profile-retained.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/hidden-friend-profile-retained.xml) |
| Native username/visibility edit | Ben saved `qa_164ef2ad_ben` and disabled discovery natively. Manage friends showed the new handle, **Hidden from pilot search**, and accepted Asha retained. Cora's fixture-API attempt to request hidden Ben returned unavailable; that inbound denial is API evidence. | [renamed-hidden-profile.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/renamed-hidden-profile.xml) |
| Hidden pilot requests outward | While hidden, Ben natively searched for Cora, sent a request and cancelled it. | [hidden-pilot-searches-outward.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/hidden-pilot-searches-outward.xml), [hidden-pilot-requests-outward.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/hidden-pilot-requests-outward.xml) |
| Unrelated profile denial | Opening Cora's profile by deep link showed **Profile unavailable**, with no count. | [unrelated-profile-denied.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/unrelated-profile-denied.xml) |
| Stranger block/unblock | Native confirmation blocked Cora and removed her search result. Native unblock restored discovery without creating a friendship. | [confirm-stranger-block.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/confirm-stranger-block.xml), [blocked-stranger-absent.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/blocked-stranger-absent.xml), [unblocked-no-friendship.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/unblocked-no-friendship.xml), [unblocked-discovery-restored.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/unblocked-discovery-restored.xml) |
| Offline and reconnect | Disabling radios cleared result identities while retaining query `Cora` and showing the connection notice. Reconnect reloaded the authorized result. | [offline-search-cleared.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/offline-search-cleared.xml), [reconnected-search.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/reconnected-search.xml) |
| Foreground reauthorization | Cora became hidden through the fixture API while the app was backgrounded. Returning to the app refreshed `Cora` to **No pilots found**. | [foreground-refresh-honours-hidden.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/foreground-refresh-honours-hidden.xml) |
| Sign-out/account isolation | Ben's native sign-out cleared search to its sign-in gate. Native Asha sign-in opened a blank search draft and her own profile, with Ben's updated handle in the accepted-friend list. Ben's accepted profile showed his renamed handle and true zero count. | [signed-out-search-cleared.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/signed-out-search-cleared.xml), [switched-account-empty-search.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/switched-account-empty-search.xml), [switched-account-profile.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/switched-account-profile.xml), [renamed-friend-profile-from-other-account.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/renamed-friend-profile-from-other-account.xml) |
| Friend removal and revoked profile | Asha confirmed native removal of Ben. Her accepted-friend list became empty, and opening Ben's former profile showed only **Profile unavailable**, without stale name/count. | [friend-removed.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/friend-removed.xml), [removed-profile-denied.xml](../android/app/build/outputs/internal/pilot-search-20260921/qa-device/removed-profile-denied.xml) |

## Final cleanup and owner preservation

The [cleanup and preservation receipt](../android/app/build/outputs/internal/pilot-search-20260921/cleanup-and-preservation.json)
was verified at 20 September 2026, 21:15:15 UTC / 21 September, 05:15:15 Singapore. All three
native QA accounts were deleted, the isolated QA package was uninstalled, and the private
fixture-credential directory was removed. The normal owner APK still matched signed hash
`b3939fbc8411bedbcf1ba8b9b2e4d8a976e1088c9a558ac50cf224122a5965ca`.

The owner remained signed in. Final [logbook screenshot](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/final-logbook.png)
and [XML](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/final-logbook.xml)
show **15 flights / 3:00 airtime**. The final [offline maps screenshot](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/final-offline-maps.png)
and [lower rows](../android/app/build/outputs/internal/pilot-search-20260921/owner-device/final-offline-maps-lower.png)
show **Around bukit jugra, Singapore and Terengganu** all **Ready**. Full cloud baseline
readback also preserved all 15 private flight rows and the one private profile.

Wi-Fi, mobile data and Bluetooth were restored on; airplane mode and USB stay-awake were off.
The screen timeout returned to 300,000 ms. These were verified against the original settings,
not inferred from the visible connectivity icon.

## Remaining checks and evidence limits

- Physical pagination beyond 20 results, legacy-profile completion, concurrent request races
  and in-flight stale network responses were not executed on the phone. Their applicable
  server/component behavior has SQL and unit coverage; that is separate evidence.
- Native shared-flight replay and kudos were not rerun in this session. The 121 hosted HTTP
  checks comprise Friends 46, shared feed 44 and kudos 31; they do not replace native replay
  or reaction acceptance. Earlier [social QA](./social-qa-2026-09-21.md) remains historical.
- The exact normally signed owner APK has installation/setup-rendering evidence. Positive
  discovery/request flows used the isolated same-JavaScript ARM64 QA build. Other ABIs, iOS,
  real-mailbox delivery and recorder field reliability are outside this phone run.

Owner production review remains outstanding; the delivery checks above do not close that
separate acceptance step.

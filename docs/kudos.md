# Kudos on shared flights

PAR-39 extends the [Friends feed and shared replay](./shared-flights.md) with one reversible
kudos per pilot and publication. This guide separates implementation, backend rollout and
installed-device acceptance; earlier feed evidence does not prove kudos behavior.

## Experience and visibility

Feed cards and shared-flight detail offer **Give kudos**, **Remove kudos** and a count that opens
the supporter list. Your own posts show the count and list without a self-kudos action. Giving
or removing reacts immediately with a pending state; the displayed count changes only after
server confirmation. A failed request can be retried with the same desired state.

The list shows current social display names and initials, newest first, in pages of 25. These
names are visible to everyone authorized to view that flight, including pilots outside the
supporter's own friend list. The give control and Friends profile setup explain this audience.
Names do not link to profiles. No email, private profile information or reactor account ID is
returned; list keys and cursors use random reaction IDs.

The viewer must still be the author or a current accepted friend of the author. The same live
predicate filters the count and supporter rows. Either-direction viewer/supporter blocks
exclude that supporter from both. Account deletion in progress also excludes affected rows.
This does not broaden existing friend-profile access.

## Lifecycle

| Event | Result |
| --- | --- |
| Give repeatedly or retry a completed Give | One reaction; no duplicate count |
| Remove repeatedly or retry a completed Remove | No reaction; no negative count |
| Hide, then deliberately re-share the same flight | Access closes while hidden; reactions return on re-share |
| Remove or block the author/supporter friendship | Reactions between those pilots are deleted permanently |
| Re-accept that friendship later | Previous reactions do not return |
| Viewer B blocks supporter C on author A's flight | C disappears from B's list/count; C's reaction on A remains for other authorized viewers |
| Delete the flight or the reacting account | Related reactions cascade away |

Kudos is online and foreground-only. It has no durable outbox, background retries, notifications,
comments, emoji picker or feed ranking. Account changes, backgrounding, lost connectivity,
relationship changes and recorder priority abort requests and clear in-memory social state.
Mutations serialize per activity; older feed, detail and list responses cannot overwrite a
newer confirmed reaction. Counts update across card/detail without bumping the feed revision
or restarting replay. Focus, refresh and reconnect reauthorize; there is no push revocation.

## Storage and deployment

`20260921150000_flight_kudos.sql` adds a private, RLS-enabled table with one row per publication
and reactor. Each row references the exact accepted friendship, so existing removal/block RPCs
also delete its reactions through a foreign-key cascade. New authenticated RPCs return only
the approved summary and supporter projection:

- `social_set_kudos(activity, given)` sets an explicit desired state and returns count/state.
- `social_list_kudos(activity, cursor, limit)` authorizes the publication, then produces names,
  count and cursor from one visibility snapshot. The maximum page size is 25.

Mutation authorization follows the existing pair-lock then flight-lock order. Count/list
projection takes no extra pair locks after a flight lock. Direct table access remains denied.
The existing feed/detail summary gains an additive `kudos` property. Installed older clients
ignore it; the exact-key replay artifact is unchanged. A new client against an older backend
keeps flights usable and leaves kudos unavailable rather than showing an invented zero count.

Apply the additive migration after local validation, then build/install the matching app.
No new native dependency or Edge function deployment is required. Preserve the installed
account, journal and map downloads with an in-place signed update.

## Acceptance ledger

| Gate | Evidence on 21 September 2026 |
| --- | --- |
| App validation | TypeScript, ESLint and three architecture checks passed. 123 Jest suites / 1,129 tests passed, covering confirmed state, double taps, retry, stale reads, revocation, account/background/offline boundaries, pagination, owner controls and recorder priority. |
| SQL and Edge functions | 11 SQL suites / 363 assertions passed, including dblink races with duplicate Give, removal, Hide, block and flight deletion. Generated database types match the migrations. All 71 existing Edge-function tests passed. |
| Real authenticated API | 31 checks passed locally and 31 on the hosted project using three disposable accounts, covering both directions of removal/blocking, names without expanded profile access, viewer-specific counts, rename/cursor deletion, Hide/re-share, private metadata and account/flight deletion. Fixtures and objects were removed. All 15 existing private flight identities/update timestamps remained unchanged. Repeat locally with `node scripts/test-kudos-http.mjs`. |
| Hosted deployment | Only `20260921150000_flight_kudos.sql` applied to the linked Paragliding Tracking project. A subsequent dry run reported up to date. No Edge functions changed. |
| Android artifact/install | Explicit Android export and standalone release build passed. Existing signer, 16 KB alignment and unchanged non-signature APK payload verified. Compatible in-place Samsung install passed; installed hash matches the artifact. No uninstall or reset. |
| Bounded Samsung smoke | The new name-audience disclosure renders on Friends setup. The new kudos route handles unavailable activity, offline and reconnect states. The journal remains 15 flights / 3:00 airtime; visible saved map regions remain Ready. Original network/settings values restored; owner account, profile and flights were not changed. |
| Physical social acceptance | Subsequent three-pilot QA passed card Give, detail Remove/Give, supporter names, own-flight controls, viewer blocking/unblocking, Hide/re-share, friendship removal/re-acceptance, offline/reconnect and account switching. This used an isolated Android package with the identical JavaScript bundle; full positive acceptance on the exact normally signed owner APK remains separate. See the [device report](./social-qa-2026-09-21.md). |

Application source was frozen from base commit `efd69c85d0a80c677fdff8139ee225108906c6b1`
plus the captured working tree, with source manifest SHA-256
`ae8a1c50157453a948066c7b8dbd4613fc23d03ed30f11d5cfc24dd5a83ff640`.
Artifact/evidence directory: `android/app/build/outputs/internal/kudos-v1-20260921/` (ignored).
APK SHA-256: `1ac975ace98ad7d65eff696c9608b83498de72eb3cdc9425c510e2b9382781c6`.
Installed on Samsung SM-S938B at 20 September 2026 18:52:23 UTC (21 September in Singapore).
Certificate SHA-256: `3bb66ecbfff452037cfb801958c946a0b7e9b9a09502a90a3f2ba207af5395c8`.
Application-source readback matched the frozen snapshot after the build. The capture prefixed
`previous-build-during-install` is prior-build context and is excluded from kudos acceptance.
Documentation may be completed after the snapshot without changing the application build.
Dependencies are unchanged. `expo install --check` still reports the pre-existing SDK 57
patch-version recommendations; no dependency upgrade was included in this feature.

### Three-pilot device run — 21 September 2026

The [isolated Samsung acceptance report](./social-qa-2026-09-21.md) records native steps,
API counterparties, screenshots, viewer-specific readbacks and the exact QA build boundary.
No app-code correction was required. Native manual publication and offline Hide across a
cold restart also passed; explicit re-share preserved the reaction, while friendship removal
deleted it permanently. Native supporter pagination beyond two entries was not exercised.

All three disposable accounts and their private/shared storage objects were deleted. The QA
package and private credentials were removed, device settings restored, and the real owner
app stayed signed in with 15 flights / 3:00 airtime and all three offline areas Ready.
PAR-39 remains In Progress for the exact normally signed owner-APK acceptance boundary;
broader automatic-posting and field checks remain separate.

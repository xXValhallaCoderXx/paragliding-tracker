# Stage 4 verification and acceptance

Contract: [personal Home and journal filters](../../new-design/stage-4.md). Tickets: PAR-42, PAR-50/51 and the personal Home slice of PAR-44. Mixed Home source queries and publication badges remain in [PAR-71](https://linear.app/sentiment-hound/issue/PAR-71).

## Automated coverage

- `journal-query.test.ts`: filter composition, historical and explicit-none equipment, normalized sites, calendar boundaries, overlapping quality, partial records without metrics, metric coverage/unknowns, deterministic date/metric ordering, duplicate aircraft labels, retained empty selections and a 12,000-flight catalogue.
- `journal-filter-sheet.test.ts`: explicit Apply (including zero results), draft Reset/Cancel/reopen, keyboard-first Back, single year/sort selections, catalogue refresh, current-year availability and bounded site/aircraft paging with search/selection persistence.
- `journal-view-state.test.ts`, `journal-identity-bridge.test.ts`: navigation memory, fresh-store defaults, actual provider authentication/owner events, same-account refresh, synchronous archive boundaries, dismissed drafts and stale Apply rejection.
- `logbook-screen.test.ts`: pinned recovery, visible/focused map previews, no repository refetch/sync during filter changes, summary/list agreement, empty/no-match/error distinctions, remount persistence and stale callbacks that must not close a newer sheet.
- `journal-cards.test.ts`: complete, partial/gaps, no-track, processing and restored cards; metrics independent of file availability; explicit labels, coverage and unavailable versus measured-zero values.

The existing cloud-sync provider suite retains recovery, foreground/network and subscription cleanup coverage. Its test environment now uses the same Node export conditions as the other Redux tests. No production dependency changed.

## Build and physical acceptance

The named **Flight Log Stage 4 QA** installation is isolated at `com.xxvalhallacoderxx.xcmvp.stage4qa`, retaining INTERNET and disabling Android app backup. Logs and APKs are local ignored artifacts under `.artifacts/stage4/`; evidence receipts belong here.

Physical checks remain separate from automated/build evidence. Pending device matrix:

- Populated/all-history Home, each card state, empty and no-match results, active/interrupted recorder entry.
- Apply, Reset, Cancel, clear-one/clear-all, all sorts, search and option paging; confirm navigation retains state and a fresh launch resets it.
- Offline saved history/filters, restore-file unavailable states, account-boundary reset and error/retry.
- Keyboard/search, Android Back, scrolling, enlarged text, TalkBack labels and control reachability.

Use dedicated QA identities and synthetic flight data. Do not reset or replace the normal application or existing Stage 1–3 data. No new hosted deployment/migration is part of Stage 4. PAR-50/51 remain In Progress until screen acceptance; broader accessibility, recorder field reliability and earlier outstanding gates retain their owners.

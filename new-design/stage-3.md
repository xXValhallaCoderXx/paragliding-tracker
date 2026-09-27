# Stage 3: Pilot and aircraft

Contract agreed 27 September 2026. Design source: the 75-page **Flight Log — social pass.pdf**, pages 13–18 / HTML batch 1 boards 13–18. Follow Stage 1's shared theme and native controls. The mock's reversed IGC examples and “rating” terminology are corrected below.

## Ownership and delivery

- **PAR-41** records this contract; **PAR-69** implements local equipment and recording snapshots; **PAR-70** implements private backup/restoration.
- **PAR-48/49** deliver Pilot and aircraft management. Only the private editor portion of **PAR-66** and aircraft selector portion of **PAR-61** belong to this stage.
- Historical flight correction stays with **PAR-53**. Public equipment stays with **PAR-43**. Home/filter, broader recorder/account/settings redesign and existing hosted/device acceptance owners remain separate.
- Android is the acceptance target. No SDK upgrade. This stage requires additive SQLite and Supabase migrations, unlike Stage 2.

## Screens and fields

Pilot shows private identity, existing visible-journal totals, empty or sport-grouped aircraft, Current indication, and an Archived section. Captured duration is labelled **Recorded time**, not detected airtime. Sign-in, backup/restoration, Settings and account actions remain reachable.

Aircraft support **Paraglider / Hang glider / Speedwing** (`paragliding`, `hang_gliding`, `speedflying`). Model is required (60 characters). Size (20) and aircraft registration/ID (30) are optional. Trim values; optional blanks become null. Duplicate model names are valid. Reuse the existing optional paraglider suggestions; other sports accept manual text initially. No catalogue service or qualification validation is introduced.

Each sport has one optional **Pilot identifier** (30 characters), for an APPI, FAI or club reference. It belongs to the sport, not the aircraft. Changing sport never copies another sport's identifier. The existing general pilot reference remains separate in private pilot details; do not reinterpret it automatically.

One aircraft is current across all sports. The first Add form initially enables Use for new flights when there is no current aircraft, but the user can turn it off. Changing current affects future starts. Archive confirms removal from active choices and clears current atomically when necessary; it never selects a replacement. Restore leaves current unchanged.

Forms use component-local drafts, native inputs, safe areas, scrolling and keyboard avoidance. Save commits locally before closing, excludes duplicate submissions, and keeps the draft on failure. Android Back first dismisses the keyboard, then offers Keep editing / Discard for changed drafts. A closed/reopened form starts from saved values; a temporary app switch preserves its mounted draft. Profile/inventory read failures show Retry rather than indefinite loading.

## Capture and historical information

Preflight displays the local current aircraft with Change. Selection there is for that flight only, with an explicit No aircraft selected option. Selection does not depend on network restoration and equipment is not a recorder readiness requirement.

`CaptureService.arm` accepts owner, selected aircraft ID and expected local generation, or explicit none. Session creation validates current owner/active aircraft/generation and stores an immutable versioned equipment snapshot in the same transaction as session/flight insertion. A stale or archived choice asks the pilot to review it; it does not silently substitute another aircraft. Resume/finalize retain the original snapshot.

The snapshot captures aircraft ID, sport, model, size and registration. It has no dependency on the continued existence of a live aircraft row. An explicit no-aircraft snapshot differs from a legacy missing snapshot. Later aircraft edits, current changes and archive/restore do not change captured equipment.

Development-era history is deliberately simple: no historical backfill or guessed aircraft. Preserve old profile fields; they can prefill the first Add draft only, requiring an explicit sport and Save. Do not reset existing flights or fabricate migration-origin history.

## Private synchronization

Aircraft, sport identities and current selection have independent owner-scoped records. SQLite is authoritative for immediate offline use and retains durable pending operations, base server revisions, local generations and conflicts. Server writes use expected revisions and operation IDs; retries return the same receipt. Stale responses cannot acknowledge newer local edits. Edits to different aircraft merge independently; same-record conflicts retain local data for Use other device's version or Review and keep this device's changes.

Before first binding, the inventory is guest-owned. Existing first account binding claims guest equipment. Pull existing account entities before resolving conflicting sport identifiers/defaults; a failed pull is never treated as an empty account. Signed-out use retains the bound inventory. Signing into a different account leaves the mismatch gate in place. Explicit rebinding activates the target inventory without copying the previous account's owned aircraft. New account deletion data follows existing deletion guards and server cascade; local data is retained under its original owner.

Private flight snapshots survive summary backup/restoration. Older clients omitting the new field preserve it. Ordinary metadata writes cannot alter captured snapshots. Equipment pending, error and conflict state contribute to backup presentation; reuse foreground-only synchronization, recorder priority and existing retry triggers. No public/Friends fields, profile creation, discoverability or sharing consent changes.

## IGC and compatibility

Use one equipment-header resolver for new manual exports, diagnostic hashes and cloud generation. `HFGTY` means model/type and `HFGID` means aircraft registration. Size remains separate. The sport identifier/general pilot reference is not a competition ID and is not exported. New pilot names retain the existing private editor/export-time behavior; equipment comes from the flight snapshot.

For legacy flights reuse an existing verified IGC when available; otherwise generate unspecified equipment. Preserve restored original bytes and old exports. New generated artifacts use a new format version and content-addressed filename, so changing a name cannot overwrite earlier files. Ordinary metadata sync preserves an existing verified cloud IGC instead of rebuilding its headers from current details. Missing/incomplete historical backup references produce a recovery error instead of silent replacement.

## Acceptance

See `ui-audit/stage3/README.md` for implementation, build, hosted and physical-device evidence. These are distinct gates. Use dedicated QA accounts and synthetic aircraft/flights. A named `FLIGHT_LOG_QA=stage3` build uses its own app package and retains INTERNET. No normal-app data reset is part of this work.

Required checks cover form failure/discard/keyboard behavior; sport identity reuse; current/archive/restore; offline capture and start/edit races; resume preservation; correct exports and original byte/hash preservation; populated SQLite upgrade; first binding/mismatch/rebind; two-device revision conflicts/idempotent retries; snapshot round-trip and older-client omissions; and Stage 1/2 regressions. Full Node 24 `pnpm test`, Android bundle/release, enlarged text, TalkBack and physical-device flows are required before screen acceptance.

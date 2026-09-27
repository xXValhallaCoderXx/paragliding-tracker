# Stage 6 physical acceptance — pending

This checklist is preparation, not completed device evidence. The user instructed Stage 6 to wait until the separate Sheetless QA run releases the Samsung. Do not interact with the phone until that handoff. Do not change Android text/display settings, reset the normal app, or replace earlier QA installations.

## Build and identities

1. Record the current device model/OS and read-only display settings. Install the exact named Stage 6 release, verify installed APK hash and isolated package/label/INTERNET/disabled backup against the build receipt. No changes to device-wide settings.
2. Use three disposable Stage 6 identities: author A, accepted viewer B and supporter C, with A–B/A–C accepted and B–C initially unrelated. Keep the normal installed account untouched. Use explicit normal sign-in, not an app auth bypass. Do not publish real flights.
3. Prepare clearly labelled synthetic recorded and archived flights: complete route, partial/gaps, one fix, no track, missing altitude/speed, long metadata, own published post and enough entries for pagination. Keep notes/registration markers private. Use existing authenticated backup/publication APIs and verify replay hashes/provenance. Never modify archived originals.
4. Use the repository's isolated HTTP scripts for disposable server fixtures/contract checks. Those scripts clean up their accounts automatically and are not persistent device identities. Phone QA requires its own independently tracked disposable identities; create them only when that run can start. Record public IDs and cleanup receipts, never OTPs, tokens or admin keys.

## Required interactions

| Area | Checks still to perform |
| --- | --- |
| Feed | No friends; friends with no posts; loading/error/Retry; auto on/off/unknown copy; own posts; long names/titles; publication chronology versus recording date; scroll, refresh and multiple pages; separate author/card/kudos/count targets. |
| Shared detail | Real Start/Stop geometry and gaps; four primary stats; More/Fewer stats, timestamps/timezone and unavailable measurements; zero/negative GPS altitude; archived provenance; own view without self-kudos; no private markers/equipment/original-file actions. |
| Replay entry/return | Navigate from shared detail, preserve recorded versus archived speed availability, Back to detail, prevent replay while recorder/recovery is busy. Player redesign remains out of scope. |
| Consent | Open selected-flight manual preview; scroll full audience/coordinates/privacy disclosure; Back/backdrop/Not now; separate automatic on/off consent; no publishing on cancellation; unsaved own-summary handoff retains Stage 5 behavior. |
| Publication | Private → pending → shared; shared preview; Hide sheet Cancel/Back; pending Hide after loss of connectivity; cold restart preserves queued request; independent viewer still has access until server confirmation; reconnect → hidden; explicit re-share; service failure/unknown status and Retry. |
| Automatic sharing | Cancel versus confirm; eligibility belongs to recordings started after known opt-in; existing flights remain private; auto-off cancels future/pending automatic work, with published history retained. Use only controlled synthetic recordings. |
| Lifecycle | Duplicate submit; busy dismissal disabled with visible progress; background/navigation while requests are pending; foreground return; account A→B→A; late requests cannot update a replacement sheet. |
| Kudos | Give/remove confirmed counts; duplicate pending taps; own flight cannot react; list header matches flight; unrelated supporter C's name/initials visible to authorized B without profile/friendship actions; zero/unavailable/error/Retry and multi-page behavior. |
| Authorization | Viewer/supporter block filters both count and names; author friendship removal/block and Hide/deletion deny subsequent reads; old title/route/names clear on discovered revocation, sign-out, offline and account change. Re-accepting/unblocking does not restore removed reactions. No claim of realtime revocation. |
| Layout/accessibility | Native safe areas, scrolling, touch targets and Back at the user's existing settings. Install the separately labelled application-only large-text/size variant for long text and action reachability; capture its actual viewport/font values. Spoken accessibility remains a separately recorded PAR-6 gate. |

## Evidence and cleanup

Capture action/result, screenshot and hierarchy, source commit, APK hash, device and fixture identity for each check. Verify publication/access with authenticated counterpart reads where relevant. Label API-only, component-fixture and device observations separately. Preserve pending/failing cases and logs; do not mark a ticket Done based on build proof.

At the end, delete only the verified disposable QA accounts and their storage prefixes, verify cleanup and unchanged real-owner rows/app identity, remove any temporary helper, and compare read-only settings against baseline. Do not delete another QA stage's data. Earlier Stage 1–5 checks and broader hosted/accessibility/field gates remain on their existing tickets.

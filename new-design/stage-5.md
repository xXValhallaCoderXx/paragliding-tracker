# Stage 5 — saved flights, detail and editing

Implements PAR-52/53 against the 27 September design pages 26, 34 and 36–39 (B1-26 and B2-08/10–13). Existing URLs and `saved=stopped|partial` remain compatible. The public detail, replay, postcard, recorder, backup protocol and database schema keep their existing contracts.

## Delivered behavior

- One-time post-save presentation inside `/flights/[id]`, after the locally stored flight/session confirms completion. The route parameter is consumed on presentation; ordinary Home reopening is detail. Optional title/site drafts are component-local. Done persists changes first; Close/Android Back protects dirty details without deleting the flight. Sharing saves dirty details only after an explicit handoff and still requires separate sharing consent. Saved on phone is separate from backup, with a Pilot link.
- Own-flight header, title/date/site, track-distance headline, actual route, supported statistics, Replay, sharing state, immutable captured aircraft, private notes and recording evidence. Public `FlightHero` is unchanged. Diagnostics remain inside evidence; the overflow contains social Share/Hide, Edit, Replay, postcard, unsigned/original IGC and Delete, with unavailable reasons.
- Primary statistics: Recorded time, Track distance, Maximum GPS altitude, Maximum ground speed. Expanded: Minimum GPS altitude, start-to-stop straight-line distance, fix count, timestamps and recorded timezone (legacy device-timezone fallback explicitly labelled). Missing measurements are em dashes. A one-fix route has no distance/straight-line measurement. Recorded time describes Start to Stop, including interruptions. No climb, above-launch, furthest-out or inferred airborne measurement. Personal comparisons require complete supporting measurements in the locally available journal.
- Captured sport/model/size/aircraft registration are read-only. Legacy unknown and explicit no-aircraft are distinct. Pilot inventory never replaces historical snapshots. No equipment or private identifiers added to public sharing.
- The editor owns title/site/private-note drafts and existing length/normalization rules. Its nested native site sheet uses existing ParaglidingEarth/OSM providers and attribution, recording coordinates, debounced search, manual naming, Clear, loading/no-results/offline/error/Retry. Current location is explicit and only offered without stored coordinates. Dismissal aborts lookup/location work; Cancel retains the parent's previous selection. Android Back dismisses the keyboard first.

## Persistence and action safety

`FlightMetadataPatch` remains metadata only. Internal requests carry original stored metadata, an immutable target (source, flight/session IDs, original owner/start/creation) and captured auth/journal scope. Synchronous scope revisions invalidate actions even after A→B→A. Transactions validate target, finished state and no deletion; compare only edited fields, treating site/provenance as a pair. Untouched newer fields survive.

Same-field conflicts show saved versus draft values. Use saved details reloads the editor; Keep my edits rebases only edited fields and requires another explicit save. This covers changes received locally; server synchronization rules are unchanged.

Save results are captured inside the committing transaction. Post-commit artifact cleanup, notification or sync scheduling failures cannot turn persistence into a failed save/delete. Export cleanup remains queued. Immediate locks block duplicate/conflicting actions; dismissed/obsolete callbacks are ignored. Deletion explains immediate local removal and remote propagation only after server confirmation. Offline deletion/Hide never claims immediate remote invisibility. Home navigation preserves the Stage 4 filter state.

## Verification and acceptance

Focused tests cover SQL transactions, conflicts/rebase, source/owner/session validation, identity transitions, cancellation, summary handoff/Back, action duplication, archived originals and metric/equipment variants. Full Node 24 tests, Android export and a named isolated **Flight Log Stage 5 QA** release are required. Device evidence belongs in `ui-audit/stage5/`; APKs and transient QA material belong in ignored `.artifacts/stage5/`.

Retain INTERNET. Use synthetic flights and dedicated QA identities. Do not reset or replace the normal app or earlier QA installations. Do not change the user's Android display settings. Any larger-text/size variant must be separately labelled; spoken accessibility remains its own acceptance gate. Record source commit, APK hash, device, screenshots and results before closing PAR-52/53. Earlier Stage 1–4, public-data PAR-43, cross-app PAR-6 and broader PAR-44 acceptance stay separate. Historical aircraft corrections are deferred to a separate ticket linked to PAR-53.

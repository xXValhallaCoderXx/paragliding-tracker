# Final UI/UX design coverage

**Current implementation direction:** [Stage 1 shared foundation and setup](stage-1.md) uses pages 1–8 of the 27 September PAR-40 pack. Its agreed Bricolage/palette and Home/Friends/Pilot labels supersede the original font/navigation guidance below. The rest of this document preserves the earlier coverage inventory.

Reviewed 22 September 2026. Planning only; application code was not changed for this ticket-creation task.

[PAR-40 — Finalize Flight Log UI/UX](https://linear.app/sentiment-hound/issue/PAR-40/finalize-flight-log-uiux-screen-designs-flows-and-implementation) contains the original HTML attachment, **25 screen/flow subtasks** and **3 product/data prerequisites**. All 28 children were read back from Linear with the expected parent, Design label, Backlog status and blocking relations. No cycle, assignee or deadline was set.

Use [onboarding-social-logbook.html](onboarding-social-logbook.html) for layout/flow direction. Its 17 static boards are design references, not evidence of working interactions or available data. Keep the app's existing theme tokens, Archivo/IBM Plex Mono, components and structure. The `:Zone.Identifier` sidecar is not a design asset.

## Existing work to retain

- [PAR-14](https://linear.app/sentiment-hound/issue/PAR-14): original 108-screenshot design audit and pilot-search work; known UX findings are distributed into the relevant screen tasks.
- [PAR-31](https://linear.app/sentiment-hound/issue/PAR-31): completed Account/Settings navigation and spacing polish; left Done.
- [PAR-6](https://linear.app/sentiment-hound/issue/PAR-6): cross-app Android accessibility/navigation acceptance; retained as the acceptance owner.
- [Social layout implementation and validation](../ui-audit/social-pass/README.md): current working-tree feed/profile/detail/sharing changes and scoped Android QA. Final social tasks reconcile differences against this baseline.
- [Current screen inventory](../ui-audit/planned-screen-inventory.md) and [audit notes](../ui-audit/design-review-notes.md). Current source/social-pass evidence supersede the older inventory's inline-sharing wording.

## Product/data prerequisites

- [PAR-41: Define aircraft, sport identity and historical equipment contracts](https://linear.app/sentiment-hound/issue/PAR-41/define-aircraft-sport-identity-and-historical-equipment-contracts)
- [PAR-42: Define combined Home, journal filtering and totals behavior](https://linear.app/sentiment-hound/issue/PAR-42/define-combined-home-journal-filtering-and-totals-behavior)
- [PAR-43: Define shared profile statistics, public equipment and metric scope](https://linear.app/sentiment-hound/issue/PAR-43/define-shared-profile-statistics-public-equipment-and-metric-scope)

These resolve genuinely new behavior: aircraft/sport identity/defaults and historical equipment; combined local/social Home and complete filtered totals; public profile aggregates/equipment/metrics. Do not infer API support, new public exposure or migration approval from mock values.

## Screen and flow tickets

| Ticket | Design coverage | Additional designs needed |
| --- | --- | --- |
| [PAR-44: finalize navigation, theme reuse and shared screen states](https://linear.app/sentiment-hound/issue/PAR-44/uiux-finalize-navigation-theme-reuse-and-shared-screen-states) | Partial — tab/header examples throughout the mock; full navigation/state map needed. | Navigation map, startup/not-found, common empty/loading/error/offline patterns and responsive/keyboard rules. |
| [PAR-45: onboarding welcome and pilot-name step](https://linear.app/sentiment-hound/issue/PAR-45/uiux-onboarding-welcome-and-pilot-name-step) | Partial — Setup 1 board supplied; welcome acknowledgement and variants needed. | Welcome/acknowledgement, focused keyboard, invalid/save-error and skipped/resumed setup variants. |
| [PAR-46: onboarding permissions and Android settings return](https://linear.app/sentiment-hound/issue/PAR-46/uiux-onboarding-permissions-and-android-settings-return) | Partial — permission step supplied; granted/denied and settings-return states needed. | Permission state variants, Android settings return and skip/blocked-recording explanation. |
| [PAR-47: optional backup and Friends onboarding](https://linear.app/sentiment-hound/issue/PAR-47/uiux-optional-backup-and-friends-onboarding) | Partial — Setup 3 board supplied; OTP, errors and completion missing. | OTP/resend/error, signed-in completion and explicit handoff to social-profile setup. |
| [PAR-48: Pilot page with empty and sport-grouped aircraft](https://linear.app/sentiment-hound/issue/PAR-48/uiux-pilot-page-with-empty-and-sport-grouped-aircraft) | Supplied main layouts — secondary account/equipment states needed. | Pilot edit, sport identity edit, aircraft switching/edit/archive, loading/save failure and populated account controls. |
| [PAR-49: add, edit and manage aircraft](https://linear.app/sentiment-hound/issue/PAR-49/uiux-add-edit-and-manage-aircraft) | Partial — two add-aircraft variants supplied; edit/archive/default flows missing. | Edit/archive/delete, switch default/sport, suggestions/no matches, dirty draft, errors and historical unknown-equipment states. |
| [PAR-50: Home and logbook with mixed ownership and recording states](https://linear.app/sentiment-hound/issue/PAR-50/uiux-home-and-logbook-with-mixed-ownership-and-recording-states) | Supplied populated boards — first-flight, recorder and offline states needed. | First-flight empty, processing/open/interrupted recorder cards, offline mixed feed, remote loading/error/pagination and no matches. |
| [PAR-51: journal filters, sorting and result summaries](https://linear.app/sentiment-hound/issue/PAR-51/uiux-journal-filters-sorting-and-result-summaries) | Partial — applied filters and sheet supplied; interaction/empty variants needed. | Sort and expanded-option sheets, no-results, unknown values, draft/apply/reset/cancel and loading/offline variants. |
| [PAR-52: own flight detail, equipment and evidence hierarchy](https://linear.app/sentiment-hound/issue/PAR-52/uiux-own-flight-detail-equipment-and-evidence-hierarchy) | Supplied main board — provenance/quality/availability variants needed. | Recorded/restored/partial/no-track, missing equipment/metric, loading/deleted/error and active-recording restrictions. |
| [PAR-53: own-flight actions, metadata editor and delete confirmations](https://linear.app/sentiment-hound/issue/PAR-53/uiux-own-flight-actions-metadata-editor-and-delete-confirmations) | Partial — actions sheet supplied; editor/site picker and confirmations missing. | Metadata and site picker, dirty-draft confirmation, delete/cancel/pending/error and export failure/handoff. |
| [PAR-54: reconcile Friends feed and empty states with final design](https://linear.app/sentiment-hound/issue/PAR-54/uiux-reconcile-friends-feed-and-empty-states-with-final-design) | Supplied — extend the completed local social layout pass, not a new rewrite. | Loading/error/offline, friends-with-no-posts, long/partial/no-track cards and multi-page variants. |
| [PAR-55: friend profile and shared-flight history](https://linear.app/sentiment-hound/issue/PAR-55/uiux-friend-profile-and-shared-flight-history) | Supplied — new statistics/history require contract; current profile is the baseline. | Empty/shared-history pagination, private/denied/offline/error and unavailable optional fields. |
| [PAR-56: shared flight detail with safe public fields](https://linear.app/sentiment-hound/issue/PAR-56/uiux-shared-flight-detail-with-safe-public-fields) | Supplied — reconcile with existing social-pass implementation. | Access denied/revoked, offline, missing replay/metrics, partial/restored and own-published variants. |
| [PAR-57: manual sharing, automatic sharing and visibility states](https://linear.app/sentiment-hound/issue/PAR-57/uiux-manual-sharing-automatic-sharing-and-visibility-states) | Partial — manual share board supplied; retain separate existing confirmation sheets. | Automatic on/off confirmation, publication/pending/error/hidden/offline and sign-in/profile gates. |
| [PAR-58: Friends profile setup and connection management](https://linear.app/sentiment-hound/issue/PAR-58/uiux-friends-profile-setup-and-connection-management) | Needed — not included in new mock. | Full setup/edit/manage layouts, username conflict, legacy completion, request groups, confirmations and offline/error states. |
| [PAR-59: Find pilots and request actions](https://linear.app/sentiment-hound/issue/PAR-59/uiux-find-pilots-and-request-actions) | Needed — not included in new mock. | Search entry/results and each relationship action, keyboard, no matches/loading/offline/error/rate-limit/pagination. |
| [PAR-60: kudos supporter list and feedback states](https://linear.app/sentiment-hound/issue/PAR-60/uiux-kudos-supporter-list-and-feedback-states) | Needed — card reactions shown, dedicated people list absent. | Dedicated supporters screen, empty/pending/error/paged/offline/revoked variants. |
| [PAR-61: preflight readiness and starting a recording](https://linear.app/sentiment-hound/issue/PAR-61/uiux-preflight-readiness-and-starting-a-recording) | Needed — onboarding permission board is not the preflight screen. | Ready/degraded/blocked, settings return, acquiring/starting and start-error layouts. |
| [PAR-62: recording instruments, live map and Stop](https://linear.app/sentiment-hound/issue/PAR-62/uiux-recording-instruments-live-map-and-stop) | Needed — no active recording screen supplied. | Instruments, map/follow/recenter, stale/no GPS/Grid/error and leave/stop interaction states. |
| [PAR-63: interrupted recording, partial save and save recovery](https://linear.app/sentiment-hound/issue/PAR-63/uiux-interrupted-recording-partial-save-and-save-recovery) | Needed — no recovery/failed-save screens supplied. | Interrupted/recovery, Resume, partial confirmation, saving/failure/retry and settled result. |
| [PAR-64: personal and shared replay player](https://linear.app/sentiment-hound/issue/PAR-64/uiux-personal-and-shared-replay-player) | Needed — replay entry buttons supplied but player absent. | Main/controls, playing/paused, Grid/retry, missing telemetry/track, archive and shared-access states. |
| [PAR-65: postcard composer, preparation and export](https://linear.app/sentiment-hound/issue/PAR-65/uiux-postcard-composer-preparation-and-export) | Needed — postcard action exists but composer absent. | Composer and six format/scene treatments, preparing/error/retry, keyboard/discard and export return/cancel. |
| [PAR-66: account sign-in, backup, restoration and deletion](https://linear.app/sentiment-hound/issue/PAR-66/uiux-account-sign-in-backup-restoration-and-deletion) | Partial — Pilot page and onboarding introduce account features; detailed account flows absent. | Auth/OTP, backup/restoration states, account mismatch, pilot editor, logout/delete dialogs and failures. |
| [PAR-67: Settings, storage and app information](https://linear.app/sentiment-hound/issue/PAR-67/uiux-settings-storage-and-app-information) | Needed — Settings entry exists; screen absent. | Settings main sections, unavailable links/configuration, storage and large-text layout. |
| [PAR-68: offline map search, coverage and download management](https://linear.app/sentiment-hound/issue/PAR-68/uiux-offline-map-search-coverage-and-download-management) | Needed — no offline-map flow supplied. | Saved/empty, search/results, coverage/estimate, transfer/Ready/pause/retry/update/delete and offline/guard states. |

## Supplied board ownership

| HTML board | Task |
| --- | --- |
| Hi-fi · Setup 1 — your name | [PAR-45](https://linear.app/sentiment-hound/issue/PAR-45/uiux-onboarding-welcome-and-pilot-name-step) |
| Hi-fi · Setup 2 — permissions | [PAR-46](https://linear.app/sentiment-hound/issue/PAR-46/uiux-onboarding-permissions-and-android-settings-return) |
| Hi-fi · Setup 3 — backup and friends | [PAR-47](https://linear.app/sentiment-hound/issue/PAR-47/uiux-optional-backup-and-friends-onboarding), [PAR-66](https://linear.app/sentiment-hound/issue/PAR-66/uiux-account-sign-in-backup-restoration-and-deletion) |
| Hi-fi · Pilot page — nothing added | [PAR-48](https://linear.app/sentiment-hound/issue/PAR-48/uiux-pilot-page-with-empty-and-sport-grouped-aircraft), [PAR-66](https://linear.app/sentiment-hound/issue/PAR-66/uiux-account-sign-in-backup-restoration-and-deletion) |
| Hi-fi · Pilot page — grouped by sport | [PAR-48](https://linear.app/sentiment-hound/issue/PAR-48/uiux-pilot-page-with-empty-and-sport-grouped-aircraft) |
| Hi-fi · Add aircraft — first of a sport | [PAR-49](https://linear.app/sentiment-hound/issue/PAR-49/uiux-add-edit-and-manage-aircraft) |
| Hi-fi · Add aircraft — rating on file | [PAR-49](https://linear.app/sentiment-hound/issue/PAR-49/uiux-add-edit-and-manage-aircraft) |
| Hi-fi · Home | [PAR-50](https://linear.app/sentiment-hound/issue/PAR-50/uiux-home-and-logbook-with-mixed-ownership-and-recording-states) |
| Hi-fi · Logbook — filters applied | [PAR-50](https://linear.app/sentiment-hound/issue/PAR-50/uiux-home-and-logbook-with-mixed-ownership-and-recording-states), [PAR-51](https://linear.app/sentiment-hound/issue/PAR-51/uiux-journal-filters-sorting-and-result-summaries) |
| Hi-fi · Filters | [PAR-51](https://linear.app/sentiment-hound/issue/PAR-51/uiux-journal-filters-sorting-and-result-summaries) |
| Hi-fi · Your flight — detail | [PAR-52](https://linear.app/sentiment-hound/issue/PAR-52/uiux-own-flight-detail-equipment-and-evidence-hierarchy) |
| Hi-fi · Own flight — actions | [PAR-53](https://linear.app/sentiment-hound/issue/PAR-53/uiux-own-flight-actions-metadata-editor-and-delete-confirmations) |
| Hi-fi · Friends feed | [PAR-54](https://linear.app/sentiment-hound/issue/PAR-54/uiux-reconcile-friends-feed-and-empty-states-with-final-design) |
| Hi-fi · Feed — nobody yet | [PAR-54](https://linear.app/sentiment-hound/issue/PAR-54/uiux-reconcile-friends-feed-and-empty-states-with-final-design) |
| Hi-fi · Pilot profile | [PAR-55](https://linear.app/sentiment-hound/issue/PAR-55/uiux-friend-profile-and-shared-flight-history) |
| Hi-fi · Their flight — detail | [PAR-56](https://linear.app/sentiment-hound/issue/PAR-56/uiux-shared-flight-detail-with-safe-public-fields) |
| Hi-fi · Share a flight | [PAR-57](https://linear.app/sentiment-hound/issue/PAR-57/uiux-manual-sharing-automatic-sharing-and-visibility-states) |

## Suggested next design batches

1. **Recorder:** preflight/start; instruments/live map/Stop; interrupted recording, partial-save and save recovery — PAR-61–63.
2. **Replay and flight completion:** personal/shared player; metadata/site editor and confirmations; postcard composer/preparation/export — PAR-64, PAR-53, PAR-65.
3. **Account and onboarding variants:** welcome acknowledgement, OTP/error/completion, backup/restoration, account mismatch and logout/delete — PAR-45, PAR-47, PAR-66.
4. **Social management:** explicit profile setup/edit, requests/circle/blocking, Find pilots and kudos list — PAR-58–60.
5. **Settings and offline maps:** Settings; destination search, suggested coverage, download/update/delete and recovery — PAR-67–68.
6. **Variants for supplied boards:** aircraft edit/archive/default changes; empty/offline/recovery Home; expanded filters/no matches; automatic-sharing/pending/hidden states; denied/empty profile/detail; common navigation, keyboard and large-text patterns.

For each batch, design the main screen and meaningful empty/loading/error/offline/pending states, sheets and keyboard layouts. Android permission and system share dialogs remain OS-owned. Private and shared replay may share a player layout but need distinct availability/privacy framing.

Do not silently remove the mandatory welcome acknowledgement, merge private pilot identity into Friends identity, expose private equipment/identifiers, fabricate season totals from a partial page, or promise immediate remote hiding while offline. Equipment preview must retain the real HFGTY/HFGID mapping; restored original IGC files remain unchanged.

Public links/web viewer, friend push notifications, live-flight viewing, 3D and iOS are outside this final Android UI pass unless separately brought into scope. Existing recorder, map, hosted and exact-build acceptance tickets retain their own evidence boundaries.


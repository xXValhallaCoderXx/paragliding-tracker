# Social pass — Android acceptance

Captured on 2026-09-21 using a Samsung **SM-S938B**, **Android 16**, at the full **1080 × 2340** device resolution. The installed app was the isolated **Flight Log QA** package, `com.xxvalhallacoderxx.xcmvp.socialqa`. See the [installation receipt](installation.json) and [social-pass review](../README.md) for build and run context.

Normal captures use Android `font_scale=0.9`; filenames containing `large` use `font_scale=1.5`. Each PNG is an unchanged, full-resolution device capture. Its matching `.xml` contains the visible UI hierarchy, and `.json` records capture time and package. These files contain synthetic QA profiles and flights; no authentication screens are included.

## Screen notes

Independent visual review found no concrete clipping, wrapping, or safe-area issue in these captures. The warm paper, ink, thermal accent, and existing typography remain consistent. Content cut at a scroll boundary is visible in the complementary capture; the slim gray handle at the right edge is Samsung system UI.

| Group | Capture | Review note |
| --- | --- | --- |
| Empty states | [No friends](empty-circle.png) | Header actions, sharing status, illustration, explanatory copy, both actions, and tabs fit within the safe areas. |
| Empty states | [Friends without posts](empty-posts.png) | Distinct “No shared flights yet” state; wrapped privacy copy and both actions remain visible. |
| Feed | [Populated feed](feed-populated.png) | Publication-date heading and actual flight date remain separate. Long author name, full-width route, title, and metrics fit. |
| Feed | [Card footer](feed-card-bottom.png) | Independent kudos action/count and full audience disclosure are reachable above the tab bar. |
| Feed | [Kudos list](kudos-list.png) | Confirmed count of 2, supporter initials/names, and visibility explanation render without clipping. |
| Profile | [Friend profile](friend-profile.png) | Long name wraps cleanly beside initials. “Backed-up flights” retains its definition; refresh and management link are visible. |
| Profile | [Find pilots](find-pilots.png) | Existing search entry and minimum-query guidance wrap correctly below the back control. |
| Shared detail | [Detail top](shared-detail-top.png) | Linked pilot row, existing flight hero, and route plate fit. The lower stat rows continue below the viewport. |
| Shared detail | [Detail bottom](shared-detail-bottom.png) | All supported stats, replay action, kudos controls, IGC provenance, and privacy explanation are readable and reachable. |
| Replay | [Replay top](shared-replay.png) | Map, telemetry, and altitude chart render. Unavailable IGC ground speed remains a dash with an explanation. |
| Replay | [Replay controls](shared-replay-controls.png) | Timeline, play/seek/speed controls, and explanatory copy clear system navigation. |
| Automatic sharing | [Confirmation](automatic-sheet.png) | Both disclosure columns and all consent text fit; confirm and “Not now” remain above system navigation. |
| Automatic sharing | [Large text, top](automatic-large-top.png) | Consent columns stack at 1.5 font scale. Headings and full-width paragraphs remain readable. |
| Automatic sharing | [Large text, bottom](automatic-large-bottom.png) | Scrolling reaches the complete automatic-sharing explanation and both actions without clipping. |
| Manual sharing | [Selected flight and consent](manual-sheet-top.png) | Selected title, date, metrics, and route thumbnail fit; complete disclosure and both actions are visible. |
| Manual sharing | [Large text, top](manual-large-top.png) | Selected-flight preview remains contained; privacy sections stack and wrap correctly. |
| Manual sharing | [Large text, bottom](manual-large-bottom.png) | Full audience/field disclosures and both actions remain reachable above system navigation. |
| Manual sharing | [Published state](manual-published.png) | Detail reports “Shared with friends” and exposes shared preview/hide controls; the private journal section remains in the owner's detail. |
| Manual sharing | [Hidden state](manual-hidden.png) | Detail reports “Hidden from friends,” explains persistence, and offers explicit re-sharing. |
| Feed after mutation | [Owner feed after sharing](own-feed-after-share.png) | Newly published flight appears in the feed. Owner card offers the kudos count without a self-kudos action. |
| Feed after mutation | [Owner feed after hiding](own-feed-after-hide.png) | Hidden flight is absent; the remaining published flight is still visible. |

## Interactions observed on the phone

- Both confirmation sheets dismissed through **Not now**, Android Back, backdrop tap, and backgrounding, without publishing or enabling sharing through cancellation.
- Automatic sharing was explicitly enabled and then disabled. This preference flow remained separate from manual publication.
- Giving kudos changed the confirmed count from **1 to 2**; the list showed the supporters. Removing kudos returned the count to **1**.
- Two backed-up fixture flights were restored into the isolated QA app before exercising manual sharing.
- Manual publication completed, its server state was checked, and the flight appeared in the owner's feed. Hiding completed, its server state was checked, and the flight disappeared from that feed.
- Both sharing sheets were inspected at normal and enlarged text sizes, including the bottom actions after scrolling.

## Acceptance limits

This run covers the installed Android UI and the listed interactions with synthetic fixtures. It does not establish recorder endurance or field reliability. No native offline-network or TalkBack check was performed. Fast pending-operation, duplicate-submit, and late-response cases are covered by automated tests; they were not observed as timed scenarios on the phone. Screenshots record visible states and do not, by themselves, prove the timing of network transitions.

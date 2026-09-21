# Design review notes

Selected visual review of the screenshot audit assembled on 21 September 2026. This note covers
onboarding, Account, recorder, saved flights, postcards, Friends/search, a populated feed card,
shared replay, Settings, offline maps and navigation. Findings refer to the specific images
linked below and relevant source. The audit pack is broader than this independent review;
these notes neither limit its coverage to the initial social captures nor claim every image
and conditional state was reviewed. Use the [capture manifest](captures.json) for the full
pack and the [planned inventory](planned-screen-inventory.md) for capture targets.

The reviewed images are full-screen captures on a Samsung SM-S938B, Android 16, at
1080 × 2340. Social, onboarding and newly exercised workflows use the isolated QA app; the
reviewed Settings and original saved-offline-area images use the owner's normal app, read-only.
Later offline download/confirmation captures are QA. The
[build receipt](device-and-build.json) identifies QA APK
`eb763eb1…` and normal APK `b3939fbc…`: their application JavaScript/assets are identical,
while package, signer and dex optimization differ. QA images do not establish exact
normal-APK acceptance. See the [capture manifest](captures.json) for each image's provenance.

## Prioritized observations

Priorities here describe design-review order, not a claim that these issues block recording.
No application fixes were made during this review.

| Priority | Observed issue and consequence | Suggested direction | Evidence |
| --- | --- | --- | --- |
| P1 | **Onboarding step navigation crowds the status bar.** In both reviewed steps, the back chevron, progress segments and step count sit immediately beneath the system icons, with much less separation than the Friends route headers. The visible controls are cramped; the images do not establish that a tap is blocked. | Place the complete step header below the top safe-area inset, with consistent spacing. Check the back hit area as well as the painted chevron on the same device. | [Pilot step](screens/onboarding/pilot.png), [Location step](screens/onboarding/location.png). The [overlay](../src/features/onboarding/components/onboarding-overlay.tsx) is positioned at `top: 0`; [StepChrome](../src/features/onboarding/components/step-chrome.tsx) supplies fixed top padding without a safe-area inset. |
| P1 | **The email keyboard hides the field being edited.** The captured Account email keyboard is open, but neither the email input nor its send action is visible above it; unrelated Account content occupies that space. This is a concrete first-focus layout problem, not proof the form cannot be reached by scrolling. | Bring the focused email field and a clear submit path into the keyboard-visible viewport. Verify the initial focus transition and subsequent scrolling on Android. | [Email keyboard](screens/account/email-keyboard.png). The [Account route](../src/app/(tabs)/account.tsx) places the form in a general ScrollView without explicit focus-to-field scrolling. |
| P1 | **Username conflict offers the wrong recovery action.** “That username is already taken” is followed by a prominent “Retry loading Friends” button. Reloading the list does not express the required correction, and the notice/button push the relevant form farther down the viewport. The typed draft is visibly retained, which is good. | Show the conflict alongside Username, retain the draft, and make correction followed by Save the clear path. Reserve a list-loading retry for list-loading failures. | [Conflict with retained draft](screens/friends-profile/username-conflict-draft.png). The shared error branch in [Friends screen](../src/features/friends/friends-screen.tsx) renders “Retry loading Friends” for this save error too. |
| P2 | **Search result actions have weak primary/secondary hierarchy and repetitive visible labels.** Add/Accept/Cancel appear as plain dark text within the card, while orange Block/Decline attract attention. Repeating the full pilot name in every action makes a one-person result card tall and verbose; the outgoing state also says “Request sent” in both the notice and card. | Give the ordinary next action a clearer button treatment; make destructive actions secondary. Use short visible labels such as “Accept” and “Block” within the clearly identified card, while retaining the full pilot name in accessibility labels. Consolidate repeated status feedback where appropriate. | [New result](screens/pilot-search/name-search.png), [Incoming request](screens/pilot-search/incoming-request.png), [Outgoing request](screens/pilot-search/outgoing-request.png). Compare the more compact action labels in [Manage friends](screens/friends-profile/renamed-hidden-profile.png). Current label construction is in [Pilot search](../src/features/friends/pilot-search-screen.tsx). |
| P2 | **Unavailable-profile instruction and action disagree.** The removed-profile state says “Refresh Friends”, but the sole content action is “Retry profile”. This makes it unclear whether the user should reload this unavailable profile or return to the relationship list. The back button remains available. | Align the action with the message, for example a clear return to Friends for revoked access, while keeping a retry for a transient read failure. | [Removed profile](screens/friend-profile/removed-profile-denied.png), [profile error branch](../src/features/friends/friend-profile-screen.tsx). |
| P2 | **Interrupted recorder labels advancing elapsed time as recorded airtime.** The interrupted screen shows **0:03:33**, then the partial-save dialog's underlying screen shows **0:03:39**, while both retain 101 fixes and last fix 05:45. | Distinguish time since starting from the amount of retained recording, or freeze the value labeled “recorded” at the appropriate evidence boundary. This observation concerns the displayed label/value; it does not establish incorrect finalized metrics. | [Interrupted recorder](screens/recorder/interrupted.png), [partial-save confirmation](screens/recorder/partial-confirmation.png). [InterruptedView](../src/features/record/components/interrupted.tsx) labels the snapshot duration “Airtime recorded”; [recorder snapshot](../src/recorder/recorder-service.native.ts) uses the current time while the session has no end time. |

## Route and content consistency

| Surface | What the reviewed capture establishes |
| --- | --- |
| `/friends` | The **Friends** tab is the shared-flight feed, with **Find pilots** and **Manage friends** as explicit destinations. The [empty feed](screens/feed/profile-created-feed.png) clearly says future flights are private and older flights can be shared from the logbook. It does not imply that creating a Friends profile publishes flights. |
| `/friends/manage` | **Manage friends** is the route header and **Your circle** the page heading. The [renamed, hidden profile](screens/friends-profile/renamed-hidden-profile.png) shows the username and search visibility independently of the existing friend below it. This agrees with the search privacy model. |
| `/friends/search` | **Find pilots** consistently describes requests requiring acceptance. [Accepted search result](screens/pilot-search/request-accepted.png) offers a profile action. [No matching visible pilot](screens/pilot-search/hidden-friend-search-empty.png) explains discovery visibility rather than declaring that the friendship ended. |
| `/friends/[id]` | [Accepted profile](screens/friend-profile/accepted-profile.png) gives display name and username a clear hierarchy. **Backed-up flights** includes a precise explanation; a visible zero is not presented as the pilot's complete lifetime flight count. |
| Onboarding overlay | The [Pilot](screens/onboarding/pilot.png) and [Location](screens/onboarding/location.png) content distinguish private pilot details, unsigned IGC export fields, permission needs and recording limits. Keep this specificity when tightening layout. |
| `/settings` | A smaller copy inconsistency: [Delete your account — Not published yet](screens/settings/settings-bottom.png) is followed by “Also available from the Account screen while signed in.” [Source](../src/app/settings.tsx) shows that the unpublished item is an external URL, while [Account](screens/account/signed-in-bottom.png) already offers in-app deletion. Label the missing web page separately so the status does not imply account deletion itself is unavailable. |

The native [Block confirmation](screens/pilot-search/confirm-stranger-block.png) clearly states
the effect on discovery, requests, connections and shared-flight access. Its generic “this
pilot” title is intentional: source comments explain that native alerts can outlive an
account-scoped React screen. The screenshot keeps the target card visible underneath; this
review does not recommend moving personal names into that longer-lived dialog.

## States worth preserving

- [Offline search](screens/pilot-search/offline-search-cleared.png) retains the typed query and
  explains reconnection while omitting result cards.
- [Signed-out search](screens/pilot-search/signed-out-search-cleared.png) offers **Open Account**,
  with no previous query or result names visible. [Switched-account search](screens/pilot-search/switched-account-empty-search.png)
  returns to the empty prompt.
- The [unblocked management capture](screens/manage-friends/unblocked-no-friendship.png)
  contains the remaining accepted friend, with no Cora row visible. A static screenshot alone
  does not establish the unblock operation or prove that a friendship was not recreated;
  those are acceptance-test conclusions, separate from this layout review.
- Paper, forest and rust colors, avatars and rounded cards are visually consistent across this
  batch. No text clipping is visible in the reviewed social images. This is not a measured
  contrast, screen-reader, large-text or keyboard-accessibility audit.

## Selected capture checks

These checks distinguish real alternate states from screenshots that should represent a
different state. They are not new functional acceptance claims.

| Capture | Visual check |
| --- | --- |
| [Recording card](screens/logbook/recording-card.png) | Correctly shows the Logbook tab with **Recording in progress** and Open recorder actions. It is not a recorder screen mislabeled as Logbook. |
| [Live-map loading](screens/recorder/live-map.png) | Shows **Loading map…**, a position dot and scale over a blank basemap. Keep as a loading-state example; it does not establish a ready live-map layout. The [leave-recorder dialog](screens/recorder/leave-dialog.png) has a rendered basemap behind it, but the dialog obscures part of the map. |
| [Rendered live map](screens/recorder/live-map-ready.png) | Basemap, recorded position, fix age and recorder controls are visible in the later ground session. This correctly represents the ready map layout; it does not turn the ground test into in-flight acceptance. |
| [Instruments](screens/recorder/instruments.png), [later instruments](screens/recorder/recorder-current.png) | Elapsed recording time, GPS altitude, speed, fix evidence and hold-to-stop are visible. These are brief stationary ground-session captures, not in-flight or endurance evidence. |
| [Pre-flight permissions](screens/recorder/missing-permissions.png) | Correctly shows precise/background permissions not yet requested, plus battery optimization information. It is not a fully granted-permission state. |
| [Permissions granted, battery warning](screens/recorder/ready.png) | Location permissions are granted, but **One thing to know** and **Start anyway** remain because battery optimization is on. Caption this as a permitted/degraded pre-flight state, not an all-green readiness result. |
| [Pilot details with keyboard](screens/account/pilot-details-keyboard.png) | Field content and top Save action remain visible. The sheet drag handle sits in the status-bar region; include this sheet in the safe-area pass alongside onboarding. |
| [Logout confirmation](screens/account/logout-confirmation.png) | Correct dialog, with the effect on local copies and backup/restoration stated. |
| [Account-deletion confirmation](screens/account/delete-account-confirmation.png) | The replacement capture now contains the real **Delete your account?** dialog, not just its section heading. It describes removal of cloud copies and preservation of flights recorded on this phone. A displayed confirmation is not evidence that deletion was executed. |
| [Recorded-flight deletion](screens/flight-detail/delete-local-confirmation.png) | Correct confirmation dialog while signed out. Its copy includes eventual deletion from the account and linked phones; caption it as a recorded-flight confirmation, not as a local-only deletion operation. |
| [Ground-flight top](screens/flight-detail/ground-flight.png), [middle](screens/flight-detail/ground-flight-middle.png), [bottom](screens/flight-detail/ground-flight-bottom.png) | Real ground recording with timing-gap messaging, map, metrics, journal, integrity and export/delete sections. The filename/fixture note must retain the ground-session context. |
| [Restored-flight top](screens/flight-detail/archive-top.png), [bottom](screens/flight-detail/archive-bottom.png) | Correct restored synthetic fixture, with a visible RESTORED badge and separate archive-provenance explanation. |
| [Edit flight](screens/flight-edit/form.png), [site suggestions](screens/flight-edit/site-picker.png) | The corrected site-suggestions capture shows **Matching places** for Bukit Jugra with the keyboard open. It now represents the intended state. |
| [Settings upper section](screens/settings/settings-top.png), [saved areas top](screens/offline-maps/saved-areas-top.png), [saved areas bottom](screens/offline-maps/saved-areas-bottom.png) | Correct read-only owner screens. Saved areas visibly report Ready; these static images alone do not prove offline map retrieval. |
| [Downloading](screens/offline-maps/downloading.png), [QA Ready](screens/offline-maps/qa-ready.png) | Correct distinct states for the QA Bukit Jugra area: Downloading with Pause/Cancel, then **Ready for offline use**. |
| [Update preview](screens/offline-maps/update-preview.png) | Explicit **Update map area** heading and **Update area** action, with coverage rectangle and estimate. This is not a paused download. |
| [Map-deletion confirmation](screens/offline-maps/delete-area-confirmation.png) | Correct **Delete Around bukit jugra?** dialog with Keep map/Delete map. It explains retained shared map data and saved flights. |
| [Unknown route](screens/navigation/not-found.png) | Correct **That screen does not exist** layout and Back to logbook action. |
| [Kudos given](screens/feed/kudos-given.png) | Populated shared-flight card shows **Remove kudos** and **View kudos (1)**, consistent with the viewer having given kudos. The audience disclosure is visible. |
| [Shared-replay map](screens/shared-replay/map.png), [controls](screens/shared-replay/controls.png) | Correct rendered shared IGC route, altitude graph and playback controls. Both are paused at 0:00; 60× selected alone does not establish playback. Ground speed is explicitly unavailable. |
| [Archive replay playing](screens/replay/archive-playing.png) | **Pause**, elapsed **0:00:35**, altitude **430 m** and 60× selected establish the intended playing-state screenshot, rather than merely a selected speed. |
| [Interrupted Logbook card](screens/logbook/interrupted-card.png), [interrupted recorder](screens/recorder/interrupted.png), [partial-save confirmation](screens/recorder/partial-confirmation.png) | The later settled captures correctly show **Recording interrupted**, **Needs attention** with a precise-location permission error, and the real **Save as a partial flight?** dialog. These were deliberately reached in the QA ground session; they do not establish spontaneous field recovery reliability. |
| [Saved partial flight](screens/flight-detail/partial.png) | Correct **Saved as a partial flight** notice and PARTIAL badge, with saved interval **05:43–05:45**, **2 min** and retention up to **05:45**. This finalized display is separate from the advancing interrupted-screen counter noted above. |
| [Idle recorder after partial save](screens/recorder/idle-final.png) | Correct return to pre-flight, with **Can't record yet** and denied precise/background permissions. This is an idle permission-blocked state, not ready-to-record or a continuing REC session. |

## Postcard observations and acceptance gap

**P1 — Share remains disabled without an explanation in the captured state.** Both the
[square controls](screens/postcard/controls.png) and [Story controls](screens/postcard/landing-story-bottom.png)
show a dimmed **Share image** button, although scene/format selection and the preview render.
The capture operator reported waiting several seconds; no loading, failure or retry notice
is visible. The [composer](../src/features/postcard/postcard-composer.tsx) enables sharing only
after fonts, the current image and layout, a committed composition and foreground state are
ready. The screenshots do not identify which condition failed, and the rendered image alone
does not establish that capture/export is ready.

Record this as an observed readiness problem requiring physical follow-up. A preparing state,
an actionable reason or a recovery path would be clearer than an indefinitely disabled primary
action. **Postcard PNG export and its system share sheet are not verified by these images.**
The separately observed IGC share sheet does not establish postcard sharing.
Android modal/window-focus handling is one source-review hypothesis for the readiness state;
it has not been isolated as the cause. No postcard background/return or reopen retest was
performed during this audit.

**P2 — Square preview crops the illustration's subject.** In [Flying](screens/postcard/flying-square.png)
the canopy is mostly above the art strip; [Launch](screens/postcard/launch-square.png) cuts the
orange wing at the bottom; [Landing](screens/postcard/landing-square.png) omits the wing visible
in its thumbnail and Story preview. Review scene-specific framing or the square art-strip
height so the illustration still communicates its selected scene. This is visible cropping,
not a missing-asset inference.

The [Landing Story upper part](screens/postcard/landing-story-top.png) correctly shows the
taller portrait preview, including title, artwork, route, metrics and restored-flight label.
Its [lower part](screens/postcard/landing-story-bottom.png) shows the controls. Needing multiple
viewport captures is expected for the scrollable composer; it is not evidence that the
exported portrait image would be truncated.

## Capture privacy and remaining visual gaps

The imported social images contain disposable QA display names and handles, as documented in
the manifest. The later Account captures show a disposable QA email address; no entered OTP
or password appears in the selected images reviewed here. The reviewed onboarding Pilot
fields are blank. System notification icons and the device edge handle are phone chrome, not
application design defects.

System share-sheet screenshots are excluded from this design pack because Android displayed
personal suggested-recipient names and avatars. The capture session reached the IGC share
sheet successfully and exited without sending; this is a session observation, with no system
share-sheet screenshot retained in the pack. Authorized QA ground-session map images are
retained and labeled as ground recordings, since they contain the actual local position.

The inventory already distinguishes shareable disposable-fixture images from private owner
captures and excludes entered OTPs/credential manifests. Keep that distinction when reviewing
Account, pilot details, flight notes and route maps: these can contain owner email, identity or
location information. This does not require extra warnings inside the app.

The initial social set uses single-result search, empty feed and zero-flight profiles; later
selected checks add a populated reacted-to flight and shared-replay layout. None of these stills
establish full pagination, every authorization/lifecycle race or field reliability. The
profile-conflict form continues below its captured viewport; Save being below that image is
not evidence that it is unreachable. Large-text, screen-reader and measured-contrast behavior
remain outside this visual review. The final coverage report, rather than this selected
finding list, records the complete pack and outstanding capture states.

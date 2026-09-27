# Friends and social layout pass — 21 September 2026

Implemented the layout direction from the social HTML mock using the existing paper theme,
Archivo/IBM Plex Mono typography, native UI kit, navigation and social services.

The feed now has compact discovery/management controls, sharing status, publication-date
headings and route-first cards. Shared detail and pilot profiles have clearer identity and
content hierarchy. Manual publication and automatic future sharing use separate confirmation
sheets. Existing consent, kudos visibility, account isolation, pending publication and offline
Hide behavior remain in place.

The profile continues to show **Backed-up flights**, with its existing definition. Unsupported
season totals, glider details, per-pilot flight lists, best-climb statistics and kudos avatar
previews were omitted. No backend schema, API, dependency, native configuration or permission
change was made.

## Validation

| Check | Result |
| --- | --- |
| TypeScript | Passed on final source |
| ESLint and architecture checks | Passed; 3 architecture checks |
| Jest | 125 suites / 1,216 tests passed on final source |
| Edge functions | 71 tests passed |
| Isolated database | 13 SQL files / 469 assertions passed; generated types matched; temporary database cleaned up |
| Android export | Passed on final source; `/tmp/xc-social-android-export` |
| Browser layout | 36 cases; no JavaScript errors or horizontal page overflow; 8/8 sheet cancellations passed |
| Physical Android | Passed the scoped social UI checks on Samsung SM-S938B / Android 16; isolated current-source QA release installed, checked and removed |

Behavioral coverage includes publication-date grouping across pagination, own flights, distinct
empty/loading/unavailable states, independent navigation/reaction controls, explicit consent,
cancel/Android Back handlers, duplicate submissions, failed submission retry, pending publication,
account/flight changes during an operation, background/blur dismissal and offline Hide.

## Selected browser captures

- [Populated feed](browser/feed-390-1x.png)
- [Manual sharing sheet](browser/manual-390-1x.png)
- [Pilot profile](browser/profile-390-1x.png)
- [Manual sheet actions at 320px and enlarged text](browser/manual-320-1.5x-bottom.png)

The [validation matrix](browser/validation.json) records all 36 cases at 320px and 390px,
with normal and simulated 1.5× text. It covers populated/no-track feed content, both empty
states, manual and automatic sharing, pilot profile, shared detail, error and offline states.
The four selected PNGs above are preserved here; the full capture set and temporary harness
remain under `/tmp/xc-social-source-review`.

These captures render actual source components through the already available React Native Web,
React DOM and NativeWind tooling, with the app's fonts, theme and route geometry. Providers and
navigation use fixture data, network maps are disabled to exercise the real route fallback, CSS
layers are flattened for the browser harness, and safe-area insets are zero. Font scaling is
simulated. The [source hashes](browser/source-hashes.json) were checked against the final source.

This is browser layout evidence. The separate [native review](native/README.md) records physical
safe areas, normal/enlarged text, Android Back and background dismissal, real map/replay,
server-backed kudos, automatic-sharing changes and manual publication/hiding. It includes
full-resolution screenshots from the current-source QA build. TalkBack, offline network
transitions and fast pending/duplicate-submission races were not exercised on the phone.

The QA app used a separate package and three disposable pilots with synthetic flights.
Its JavaScript and application assets matched the current-source release build. The QA app,
accounts and uploaded fixture data were removed afterward. The existing installed app was
left unchanged and reopened with its 15 flights / 3:00 airtime. Baseline full-row fingerprints
for pre-existing private flights, private profiles and social profiles remained unchanged.
Font size was restored to 0.9; the user's chosen 10-minute timeout was retained. See the
[installation and cleanup receipt](native/installation.json).

Local verification logs: `/tmp/xc-social-verification.log`, `/tmp/xc-social-final-unit.log`
and `/tmp/xc-social-final-export.log`. Hosted QA mutations were limited to the disposable
fixtures; no schema deployment or owner-data changes were made.

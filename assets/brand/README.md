# Paraglider mark

A name-free canopy and suspended pilot, drawn as a vector. Warm cream, forest green
and the orange wingtip match the journal palette in `src/ui/theme.ts`.

Edit `paraglider-mark.svg`, then run `pnpm brand:generate`. The generator uses Sharp
to produce the committed assets; EAS builds do not need to run it.

| Asset | Purpose |
| --- | --- |
| `paraglider-mark.svg` | Editable master, light artwork for dark backgrounds |
| `paraglider-mark-on-light.svg` | Generated dark artwork for light backgrounds |
| `paraglider-mark.png` | Transparent logo at 1024×1024 |
| `icon-preview.png` | Rounded preview; not the actual platform icon |
| `adaptive-preview.png` | Circle, rounded-square and themed Android previews |
| `../images/icon.png` | Opaque 1024×1024 icon for iOS and Android fallback |
| `../images/android-icon-foreground.png` | Transparent Android adaptive foreground |
| `../images/android-icon-monochrome.png` | Single-color Android themed-icon mask |
| `../images/splash-icon.png` | Transparent launch-screen artwork |

The platform icon has no baked corner rounding. Android foregrounds keep the mark
inside the central 66/108 safe circle; the OS applies the launcher mask. The solid
background and splash color are set in `app.json`. Preview images simulate masks
only for review.

Icon and splash changes require a new APK. EAS regenerates the ignored native
project from `app.json`; for a local Gradle build, synchronize it with Expo prebuild
first, following the signing-key preservation steps in the root README.

`expo.name` controls the visible name (currently Flight Log Alpha) and can change
when the final name is chosen. Keep the existing Android package, iOS bundle ID,
scheme and EAS project identity while updating these assets. A package-ID change
creates a separate Android app with separate local data; it is not a display rename.

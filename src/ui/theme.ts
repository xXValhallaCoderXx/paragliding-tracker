/**
 * Visual language for the "field notebook" design (Claude Design project
 * "MVP app UI design", file `XC Tracker UI.dc.html`).
 *
 * A single warm-paper palette across every screen. (The recorder previously inverted to a
 * near-black instrument mode; that was removed in favour of one consistent theme.)
 *
 * Fonts are loaded at runtime in the root layout. Custom font families carry
 * their weight in the family name, so styles must never combine `fontFamily`
 * with `fontWeight` (Android would synthesise a fake bold or fall back).
 */

export const paper = {
  background: '#F4EFE6',
  card: '#FFFCF6',
  cardAlt: '#F1E8D8',
  border: '#E2D9C8',
  hairline: '#EFE7D6',
  ink: '#16130F',
  text: '#5B534A',
  muted: '#8B8177',
  faint: '#C9BFAE',
  ghost: '#A79A82',
  placeholder: '#B8AD9C',
  thermal: '#D9591F',
  thermalPressed: '#B4471A',
  thermalSoft: '#F7E7DC',
  thermalInk: '#8A3F14',
  altitude: '#1F5F6B',
  altitudeSoft: '#E2EDEF',
  good: '#3E7A52',
  goodSoft: '#E7F0E7',
  goodBorder: '#CFE1CF',
  goodBody: '#3E5E45',
  warn: '#C98A20',
  warnInk: '#9A6A12',
  warnSoft: '#F6EBD3',
  warnBorder: '#E5D3AC',
  warnBody: '#7A5A1A',
  danger: '#B4320E',
  dangerSoft: '#FFF1EC',
  dangerBorder: '#EFC6B6',
  dangerBody: '#7A3A24',
  attentionSoft: '#FFF3EA',
  attentionBorder: '#E0B79E',
  attentionInk: '#7A4A2C',
  onDark: '#FFFCF6',
  onDarkMuted: 'rgba(255,252,246,0.6)',
  onDarkFaint: 'rgba(255,252,246,0.45)',
  onDarkHairline: 'rgba(255,252,246,0.14)',
} as const;

export const fonts = {
  sans: 'Archivo_400Regular',
  sansMedium: 'Archivo_500Medium',
  sansSemi: 'Archivo_600SemiBold',
  sansBold: 'Archivo_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
} as const;

export const radii = {
  card: 14,
  cardLarge: 16,
  control: 12,
  controlLarge: 16,
  pill: 999,
} as const;

export const spacing = {
  screen: 16,
  gutter: 22,
} as const;

/**
 * Height of the bottom tab bar, excluding the safe-area inset.
 *
 * expo-router v6 vendors React Navigation rather than depending on it, so
 * `useBottomTabBarHeight` is not importable and deep-importing the vendored copy would
 * be fragile. Screens that scroll under the bar add this to their bottom padding.
 */
export const TAB_BAR_HEIGHT = 49;

export type Tone = 'neutral' | 'good' | 'warning' | 'danger';

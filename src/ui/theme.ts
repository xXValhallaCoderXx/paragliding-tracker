/**
 * Visual language for the illustrated adventure journal.
 *
 * A single warm-paper palette across every screen. (The recorder previously inverted to a
 * near-black instrument mode; that was removed in favour of one consistent theme.)
 *
 * Fonts are loaded at runtime in the root layout. Custom font families carry
 * their weight in the family name, so styles must never combine `fontFamily`
 * with `fontWeight` (Android would synthesise a fake bold or fall back).
 */

export const paper = {
  background: '#F7F3E8',
  card: '#FFFCF5',
  cardAlt: '#EEE8D9',
  border: '#DADCCF',
  hairline: '#EAEADD',
  /** The chart-plate graticule. Deliberately darker than `border`, which is too pale to read as a grid. */
  grid: '#D3D9CA',
  ink: '#203F36',
  text: '#4F6257',
  muted: '#637368',
  faint: '#C9BFAE',
  ghost: '#A79A82',
  placeholder: '#B8AD9C',
  thermal: '#B74E29',
  thermalPressed: '#943D20',
  thermalSoft: '#F5E5D8',
  thermalInk: '#8A3F14',
  altitude: '#356C88',
  altitudeSoft: '#E5EEF2',
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
  onDark: '#FFFCF5',
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
  card: 22,
  cardLarge: 28,
  control: 14,
  controlLarge: 18,
  pill: 999,
} as const;

export const spacing = {
  screen: 16,
  gutter: 22,
} as const;

export type Tone = 'neutral' | 'good' | 'warning' | 'danger';

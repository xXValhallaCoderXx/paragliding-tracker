/**
 * Visual language for the "field notebook" design (Claude Design project
 * "MVP app UI design", file `XC Tracker UI.dc.html`).
 *
 * Sofa screens (logbook, pre-flight, flight detail) use warm paper tones.
 * The in-flight recorder inverts to a near-black instrument mode.
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
  warn: '#C98A20',
  warnInk: '#9A6A12',
  warnSoft: '#F6EBD3',
  warnBorder: '#E5D3AC',
  danger: '#B4320E',
  dangerSoft: '#FFF1EC',
  dangerBorder: '#EFC6B6',
  attentionSoft: '#FFF3EA',
  attentionBorder: '#E0B79E',
  attentionInk: '#7A4A2C',
  onDark: '#FFFCF6',
  onDarkMuted: 'rgba(255,252,246,0.6)',
  onDarkFaint: 'rgba(255,252,246,0.45)',
  onDarkHairline: 'rgba(255,252,246,0.14)',
} as const;

export const night = {
  background: '#0A0D12',
  surface: '#131A22',
  surfaceQuiet: '#0E141A',
  border: '#232B34',
  hairline: '#1B222B',
  text: '#FFFCF6',
  label: '#5D6B78',
  muted: '#7E8D9A',
  faint: '#3B4652',
  dim: '#4A5661',
  rec: '#FF6A25',
  recText: '#FF8A50',
  recSoft: 'rgba(217,89,31,0.14)',
  recBorder: 'rgba(217,89,31,0.45)',
  good: '#4FA37B',
  goodText: '#9BC49A',
  goodSoft: '#151B14',
  goodBorder: '#2C3A2B',
  goodMuted: '#6E8A6D',
  warn: '#D3A03A',
  warnSoft: '#1A1712',
  warnBorder: '#3A3428',
  warnMuted: '#9A8455',
  warnInk: '#8A5636',
  danger: '#FF7B5A',
  dangerSoft: '#221310',
  dangerBorder: '#4A2A22',
  dangerMuted: '#B0776A',
  thermal: '#D9591F',
  speed: '#5D93A3',
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

export type Scheme = 'paper' | 'night';
export type Tone = 'neutral' | 'good' | 'warning' | 'danger';

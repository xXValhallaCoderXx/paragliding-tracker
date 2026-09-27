/** Shared native and CSS tokens. Bundled font families carry their own weight.
 * Never add fontWeight to a custom fontFamily on Android. */
export const paper = {
  background: '#F3F0E7',
  card: '#FCFBF5',
  sheet: '#F8F6EE',
  scrim: '#DEDACC',
  actionText: '#A8401F',
  restored: '#5B7FA0',
  cardAlt: '#EEE8D9',
  border: '#E9E5D8',
  hairline: '#E9E5D8',
  /** The chart-plate graticule. Deliberately darker than `border`, which is too pale to read as a grid. */
  grid: '#D3D9CA',
  ink: '#18382C',
  text: '#44543F',
  muted: '#63705F',
  faint: '#C9BFAE',
  ghost: '#A79A82',
  placeholder: '#63705F',
  thermal: '#B8482A',
  thermalPressed: '#943D20',
  thermalSoft: '#F7E6DE',
  thermalInk: '#A8401F',
  altitude: '#356C88',
  altitudeSoft: '#E5EEF2',
  good: '#2E7050',
  goodSoft: '#E7F0E7',
  goodBorder: '#CFE1CF',
  goodBody: '#3E5E45',
  warn: '#C9A227',
  warnInk: '#7A5A12',
  warnSoft: '#F2E6C8',
  warnBorder: '#E5D3AC',
  warnBody: '#7A5A1A',
  danger: '#A8401F',
  dangerSoft: '#FFF1EC',
  dangerBorder: '#EED2C6',
  dangerBody: '#7A3A24',
  attentionSoft: '#FFF3EA',
  attentionBorder: '#E0B79E',
  attentionInk: '#7A4A2C',
  onDark: '#FCFBF5',
  onDarkMuted: 'rgba(255,252,246,0.6)',
  onDarkFaint: 'rgba(255,252,246,0.45)',
  onDarkHairline: 'rgba(255,252,246,0.14)',
} as const;

export const fonts = {
  sans: 'BricolageGrotesque_400Regular',
  sansMedium: 'BricolageGrotesque_500Medium',
  sansSemi: 'BricolageGrotesque_600SemiBold',
  sansBold: 'BricolageGrotesque_700Bold',
  sansExtraBold: 'BricolageGrotesque_800ExtraBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
} as const;

/** Prepared for PAR-62; recording still uses the light theme. */
export const darkRecorder = {
  background: '#101F18', panel: '#183025', recessed: '#16291F', border: '#2E4C3A',
  ink: '#F4F7F1', text: '#B9CDBE', recording: '#E0503A', good: '#58B182',
} as const;

export const radii = {
  tile: 12, control: 16, card: 18, cardLarge: 20, controlLarge: 28, sheet: 26, pill: 999,
} as const;

export const spacing = {
  micro: 4, tight: 9, inline: 13, section: 18, action: 26, top: 46,
  screen: 20, gutter: 20, bottom: 28,
} as const;

export const typography = {
  display: { fontFamily: fonts.sansExtraBold, fontSize: 46, lineHeight: 51, letterSpacing: -1.4 },
  title: { fontFamily: fonts.sansExtraBold, fontSize: 31, lineHeight: 35, letterSpacing: -1 },
  section: { fontFamily: fonts.sansExtraBold, fontSize: 23, lineHeight: 28, letterSpacing: -0.6 },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: 17, lineHeight: 22, letterSpacing: -0.3 },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 24 },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 19 },
  heroFigure: { fontFamily: fonts.mono, fontSize: 46, lineHeight: 51, letterSpacing: -2.2 },
  progress: { fontFamily: fonts.mono, fontSize: 28, lineHeight: 34, letterSpacing: -1.2 },
  stat: { fontFamily: fonts.mono, fontSize: 21, lineHeight: 27 },
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 18, letterSpacing: 2 },
  label: { fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 18, letterSpacing: 1.6 },
} as const;

export type Tone = 'neutral' | 'good' | 'warning' | 'danger';

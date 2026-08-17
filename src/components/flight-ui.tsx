import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, night, paper, radii, type Scheme, type Tone } from '@/ui/theme';

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scheme = 'paper',
  style,
}: {
  children: ReactNode;
  scheme?: Scheme;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      style={[
        styles.screen,
        { backgroundColor: scheme === 'night' ? night.background : paper.background },
        style,
      ]}>
      {children}
    </SafeAreaView>
  );
}

export function LoadingScreen({ label, scheme = 'paper' }: { label: string; scheme?: Scheme }) {
  return (
    <Screen scheme={scheme} style={styles.centered}>
      <ActivityIndicator color={paper.thermal} size="large" />
      <Text style={[styles.loadingText, scheme === 'night' && { color: night.muted }]}>{label}</Text>
    </Screen>
  );
}

export function UnsupportedScreen() {
  return (
    <Screen style={styles.unsupported}>
      <SectionLabel>Flight Log Alpha</SectionLabel>
      <Text style={styles.unsupportedTitle}>Open this on your phone</Text>
      <Text style={styles.unsupportedBody}>
        Flight recording and your local logbook live in the installed Android build. The web
        version only checks that the project builds cleanly.
      </Text>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Navigation chrome
// ---------------------------------------------------------------------------

export function TopBar({
  onBack,
  backLabel = 'Back',
  title,
  right,
  scheme = 'paper',
}: {
  onBack?: () => void;
  backLabel?: string;
  title?: string;
  right?: ReactNode;
  scheme?: Scheme;
}) {
  const isNight = scheme === 'night';
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarLeft}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              isNight && styles.backButtonNight,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.backGlyph, isNight && { color: night.text }]}>‹</Text>
          </Pressable>
        ) : null}
        {title ? (
          <Text
            style={[styles.topBarTitle, isNight && { color: night.muted }]}
            numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.topBarRight}>{right}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Typography helpers
// ---------------------------------------------------------------------------

export function SectionLabel({
  children,
  scheme = 'paper',
  style,
}: {
  children: ReactNode;
  scheme?: Scheme;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[styles.sectionLabel, scheme === 'night' && { color: night.label }, style]}>
      {typeof children === 'string' ? children.toUpperCase() : children}
    </Text>
  );
}

export function Disclaimer({
  children,
  scheme = 'paper',
  align = 'center',
  style,
}: {
  children: ReactNode;
  scheme?: Scheme;
  align?: 'center' | 'left';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        styles.disclaimer,
        scheme === 'night' && { color: night.dim },
        align === 'left' && { textAlign: 'left' },
        style,
      ]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  variant = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'alt' | 'dark' | 'night';
}) {
  return (
    <View
      style={[
        styles.card,
        variant === 'alt' && styles.cardAlt,
        variant === 'dark' && styles.cardDark,
        variant === 'night' && styles.cardNight,
        style,
      ]}>
      {children}
    </View>
  );
}

/** A label/value row inside a paper card, in the pre-flight checklist style. */
export function ListRow({
  label,
  value,
  tone = 'neutral',
  showDot = false,
  detail,
  action,
  last = false,
  mono = true,
  labelMuted = false,
}: {
  label: string;
  value?: string;
  tone?: Tone;
  showDot?: boolean;
  detail?: string | null;
  action?: { label: string; onPress: () => void } | null;
  last?: boolean;
  mono?: boolean;
  labelMuted?: boolean;
}) {
  return (
    <View style={[styles.listRow, last && styles.listRowLast]}>
      <View style={styles.listRowMain}>
        <Text style={[styles.listRowLabel, labelMuted && { color: paper.muted }]}>{label}</Text>
        {value !== undefined ? (
          <View style={styles.listRowValueWrap}>
            <Text
              style={[
                mono ? styles.listRowValue : styles.listRowValueSans,
                tone === 'danger' && { color: paper.danger },
                tone === 'warning' && { color: paper.warnInk },
              ]}>
              {value}
            </Text>
            {showDot ? <ToneDot tone={tone} /> : null}
          </View>
        ) : null}
      </View>
      {detail ? <Text style={styles.listRowDetail}>{detail}</Text> : null}
      {action ? <LinkButton label={`${action.label} ›`} onPress={action.onPress} style={styles.listRowAction} /> : null}
    </View>
  );
}

export function ToneDot({ tone, size = 7 }: { tone: Tone; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: toneColor(tone),
      }}
    />
  );
}

export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'good':
      return paper.good;
    case 'warning':
      return paper.warn;
    case 'danger':
      return paper.danger;
    default:
      return paper.faint;
  }
}

/** Grid of stat cells separated by hairlines, as on the flight detail. */
export function StatGrid({
  cells,
  columns = 2,
}: {
  cells: {
    label: string;
    value: string;
    unit?: string;
    emphasis?: boolean;
    tone?: 'ink' | 'thermal' | 'altitude';
  }[];
  columns?: 2 | 3;
}) {
  const rows = Math.ceil(cells.length / columns);
  return (
    <View style={styles.statGrid}>
      {cells.map((cell, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return (
          <View
            key={cell.label}
            style={[
              styles.statCell,
              { width: `${100 / columns}%` },
              column < columns - 1 && styles.statCellRightHairline,
              row < rows - 1 && styles.statCellBottomHairline,
            ]}>
            <Text style={styles.statCellLabel}>{cell.label.toUpperCase()}</Text>
            <Text
              style={[
                cell.emphasis ? styles.statCellValueLarge : styles.statCellValue,
                cell.tone === 'thermal' && { color: paper.thermal },
                cell.tone === 'altitude' && { color: paper.altitude },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {cell.value}
              {cell.unit ? <Text style={styles.statCellUnit}> {cell.unit}</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chips and pills
// ---------------------------------------------------------------------------

export type ChipTone = 'good' | 'altitude' | 'muted' | 'warning' | 'danger' | 'thermal';

export function Chip({ label, tone = 'muted' }: { label: string; tone?: ChipTone }) {
  return (
    <View style={[styles.chip, chipStyles[tone].box]}>
      <Text style={[styles.chipText, chipStyles[tone].text]}>{label.toUpperCase()}</Text>
    </View>
  );
}

const chipStyles: Record<ChipTone, { box: ViewStyle; text: TextStyle }> = {
  good: { box: { backgroundColor: paper.goodSoft }, text: { color: paper.good } },
  altitude: { box: { backgroundColor: paper.altitudeSoft }, text: { color: paper.altitude } },
  muted: { box: { backgroundColor: paper.cardAlt }, text: { color: paper.muted } },
  warning: {
    box: { backgroundColor: paper.warnSoft, borderColor: paper.warnBorder, borderWidth: 1 },
    text: { color: paper.warnInk },
  },
  danger: {
    box: { backgroundColor: paper.dangerSoft, borderColor: paper.dangerBorder, borderWidth: 1 },
    text: { color: paper.danger },
  },
  thermal: { box: { backgroundColor: paper.thermalSoft }, text: { color: paper.thermalInk } },
};

/**
 * Small state label with a dot, e.g. "● ALL GOOD" on the pre-flight screen.
 * The dot only pulses when explicitly asked to, so degraded states can never
 * borrow the "live" cue.
 */
export function StateLabel({
  label,
  tone,
  pulse = false,
  halo = true,
  scheme = 'paper',
}: {
  label: string;
  tone: Tone;
  pulse?: boolean;
  halo?: boolean;
  scheme?: Scheme;
}) {
  const color = scheme === 'night' ? nightToneColor(tone) : toneColor(tone);
  return (
    <View style={styles.stateLabel}>
      <PulseDot color={color} size={12} pulse={pulse} halo={halo} />
      <Text style={[styles.stateLabelText, { color: tone === 'neutral' && scheme === 'paper' ? paper.text : color }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function nightToneColor(tone: Tone): string {
  switch (tone) {
    case 'good':
      return night.good;
    case 'warning':
      return night.warn;
    case 'danger':
      return night.danger;
    default:
      return night.muted;
  }
}

/**
 * A stable Animated.Value created once per component instance. (React Native's
 * `useAnimatedValue` is not available in react-native-web, and reading a ref
 * during render is disallowed by the React Compiler rules.)
 */
export function useStableAnimatedValue(initialValue: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initialValue));
  return value;
}

export function PulseDot({
  color,
  size = 9,
  pulse,
  halo = false,
}: {
  color: string;
  size?: number;
  pulse: boolean;
  halo?: boolean;
}) {
  const opacity = useStableAnimatedValue(1);
  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, pulse]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        ...(halo ? { boxShadow: `0 0 0 5px ${color}29` } : null),
      }}
    />
  );
}

/** Rounded pill for the recorder header ("REC", "GPS STALE", "PHONE SENSORS · 62%"). */
export function StatusPill({
  label,
  tone = 'neutral',
  pulse = false,
  emphasis = false,
}: {
  label: string;
  tone?: Tone;
  pulse?: boolean;
  emphasis?: boolean;
}) {
  const color = emphasis ? night.rec : nightToneColor(tone);
  const textColor = emphasis ? night.recText : nightToneColor(tone);
  return (
    <View
      style={[
        styles.pill,
        emphasis && styles.pillEmphasis,
        tone === 'warning' && !emphasis && styles.pillWarning,
        tone === 'danger' && !emphasis && styles.pillDanger,
      ]}>
      <PulseDot color={color} size={emphasis ? 9 : 7} pulse={pulse} />
      <Text style={[styles.pillText, { color: textColor }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  busy = false,
  leadingDot = false,
  scheme = 'paper',
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg' | 'xl';
  disabled?: boolean;
  busy?: boolean;
  leadingDot?: boolean;
  scheme?: Scheme;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const isNight = scheme === 'night';
  const textColor =
    variant === 'primary' || variant === 'dark'
      ? paper.onDark
      : variant === 'danger'
        ? paper.danger
        : variant === 'ghost'
          ? isNight
            ? night.muted
            : paper.muted
          : isNight
            ? night.text
            : paper.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === 'lg' && styles.buttonLg,
        size === 'xl' && styles.buttonXl,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'primary' && size === 'xl' && styles.buttonPrimaryGlow,
        variant === 'secondary' && (isNight ? styles.buttonSecondaryNight : styles.buttonSecondary),
        variant === 'ghost' && styles.buttonGhost,
        variant === 'dark' && styles.buttonDark,
        variant === 'danger' && styles.buttonDanger,
        (disabled || busy) && styles.buttonDisabled,
        pressed && !disabled && !busy && styles.pressed,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : leadingDot ? (
        <View style={[styles.buttonDot, size === 'xl' && { width: 13, height: 13 }]} />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          size === 'lg' && styles.buttonTextLg,
          size === 'xl' && styles.buttonTextXl,
          { color: textColor },
        ]}
        numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Text-only affordance in thermal, e.g. "Open Android settings ›". */
export function LinkButton({
  label,
  onPress,
  scheme = 'paper',
  style,
}: {
  label: string;
  onPress: () => void;
  scheme?: Scheme;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.linkButton, pressed && styles.pressed, style]}>
      <Text style={[styles.linkButtonText, scheme === 'night' && { color: night.recText }]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Notice({
  title,
  children,
  tone = 'info',
  scheme = 'paper',
}: {
  title?: string;
  children?: ReactNode;
  tone?: 'info' | 'warning' | 'danger' | 'good';
  scheme?: Scheme;
}) {
  const palette = scheme === 'night' ? nightNotice[tone] : paperNotice[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: palette.background, borderColor: palette.border }]}>
      {title ? <Text style={[styles.noticeTitle, { color: palette.title }]}>{title}</Text> : null}
      {children ? (
        <Text style={[styles.noticeBody, { color: palette.body }, !title && styles.noticeBodyOnly]}>
          {children}
        </Text>
      ) : null}
    </View>
  );
}

const paperNotice = {
  info: { background: paper.cardAlt, border: paper.border, title: paper.ink, body: paper.text },
  good: { background: paper.goodSoft, border: '#CFE1CF', title: paper.good, body: '#3E5E45' },
  warning: { background: paper.warnSoft, border: paper.warnBorder, title: paper.warnInk, body: '#7A5A1A' },
  danger: { background: paper.dangerSoft, border: paper.dangerBorder, title: paper.danger, body: '#7A3A24' },
} as const;

const nightNotice = {
  info: { background: night.surface, border: night.border, title: night.text, body: night.muted },
  good: { background: night.goodSoft, border: night.goodBorder, title: night.goodText, body: night.goodMuted },
  warning: { background: night.warnSoft, border: night.warnBorder, title: night.warn, body: night.warnMuted },
  danger: { background: night.dangerSoft, border: night.dangerBorder, title: night.danger, body: night.dangerMuted },
} as const;

export function BusyRow({ label, scheme = 'paper' }: { label: string; scheme?: Scheme }) {
  return (
    <View style={styles.busyRow} accessibilityLiveRegion="polite">
      <ActivityIndicator color={scheme === 'night' ? night.recText : paper.thermal} />
      <Text style={[styles.loadingText, scheme === 'night' && { color: night.muted }]}>{label}</Text>
    </View>
  );
}

export function Hairline({ scheme = 'paper', style }: { scheme?: Scheme; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        styles.hairline,
        { backgroundColor: scheme === 'night' ? night.hairline : paper.hairline },
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontFamily: fonts.sans, fontSize: 13, color: paper.text },
  unsupported: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  unsupportedTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 26,
    color: paper.ink,
    textAlign: 'center',
  },
  unsupportedBody: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: paper.text,
    maxWidth: 520,
    textAlign: 'center',
  },

  topBar: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topBarTitle: { fontFamily: fonts.sansSemi, fontSize: 13, color: paper.text, flexShrink: 1 },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: paper.card,
    borderWidth: 1,
    borderColor: paper.border,
  },
  backButtonNight: { backgroundColor: night.surface, borderColor: night.border },
  backGlyph: { fontFamily: fonts.sansSemi, fontSize: 21, lineHeight: 24, color: paper.ink, marginTop: -2 },

  sectionLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.4,
    color: paper.muted,
  },
  disclaimer: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    lineHeight: 15,
    color: paper.muted,
    textAlign: 'center',
  },

  card: {
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: radii.card,
  },
  cardAlt: { backgroundColor: paper.cardAlt },
  cardDark: { backgroundColor: paper.ink, borderColor: paper.ink },
  cardNight: { backgroundColor: night.surface, borderColor: night.border },

  listRow: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: paper.hairline,
    gap: 4,
  },
  listRowLast: { borderBottomWidth: 0 },
  listRowMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  listRowLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: paper.ink, flexShrink: 1 },
  listRowValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  listRowValue: { fontFamily: fonts.monoMedium, fontSize: 11.5, color: paper.text, textAlign: 'right' },
  listRowValueSans: { fontFamily: fonts.sansSemi, fontSize: 13, color: paper.ink, textAlign: 'right' },
  listRowDetail: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16.5, color: paper.text },
  listRowAction: { minHeight: 32, marginTop: -2 },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  statCell: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 66 },
  statCellRightHairline: { borderRightWidth: 1, borderRightColor: paper.hairline },
  statCellBottomHairline: { borderBottomWidth: 1, borderBottomColor: paper.hairline },
  statCellLabel: { fontFamily: fonts.sansMedium, fontSize: 9.5, letterSpacing: 1.2, color: paper.muted },
  statCellValue: { fontFamily: fonts.monoSemi, fontSize: 18, color: paper.ink, marginTop: 4 },
  statCellValueLarge: { fontFamily: fonts.monoSemi, fontSize: 24, color: paper.ink, marginTop: 3, letterSpacing: -0.4 },
  statCellUnit: { fontFamily: fonts.monoSemi, fontSize: 12, color: paper.muted },

  chip: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, alignSelf: 'flex-start' },
  chipText: { fontFamily: fonts.monoMedium, fontSize: 9.5, letterSpacing: 0.3 },

  stateLabel: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  stateLabelText: { fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 1.2 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: night.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillEmphasis: { backgroundColor: night.recSoft, borderColor: night.recBorder, paddingHorizontal: 13, gap: 9 },
  pillWarning: { backgroundColor: 'rgba(201,138,32,0.1)', borderColor: night.warnBorder },
  pillDanger: { backgroundColor: night.dangerSoft, borderColor: night.dangerBorder },
  pillText: { fontFamily: fonts.monoSemi, fontSize: 10.5, letterSpacing: 1.1 },

  button: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttonLg: { minHeight: 56, borderRadius: 14, gap: 10 },
  buttonXl: { minHeight: 60, borderRadius: radii.controlLarge, gap: 11 },
  buttonPrimary: { backgroundColor: paper.thermal, borderColor: paper.thermal },
  buttonPrimaryGlow: { boxShadow: '0 6px 18px rgba(217,89,31,0.34)' },
  buttonSecondary: { backgroundColor: paper.card, borderColor: paper.border },
  buttonSecondaryNight: { backgroundColor: night.surface, borderColor: night.border },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDark: { backgroundColor: paper.ink, borderColor: paper.ink },
  buttonDanger: { backgroundColor: paper.card, borderColor: paper.dangerBorder },
  buttonDisabled: { opacity: 0.42 },
  buttonDot: { width: 12, height: 12, borderRadius: 7, backgroundColor: paper.onDark },
  buttonText: { fontFamily: fonts.sansSemi, fontSize: 13.5 },
  buttonTextLg: { fontSize: 15.5 },
  buttonTextXl: { fontSize: 17 },
  linkButton: { minHeight: 40, justifyContent: 'center' },
  linkButtonText: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: paper.thermal },

  notice: { borderRadius: 11, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11, gap: 2 },
  noticeTitle: { fontFamily: fonts.sansSemi, fontSize: 11.5 },
  noticeBody: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  noticeBodyOnly: { fontSize: 12.5, lineHeight: 18 },

  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 32 },
  hairline: { height: 1 },
  pressed: { opacity: 0.72 },
});

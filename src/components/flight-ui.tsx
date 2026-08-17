import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const palette = {
  background: '#07111f',
  surface: '#101b2d',
  surfaceStrong: '#17243a',
  surfaceQuiet: '#0b1424',
  border: '#263653',
  borderStrong: '#526581',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  textQuiet: '#64748b',
  amber: '#fbbf24',
  amberPressed: '#d99f12',
  amberText: '#1c1917',
  danger: '#e11d48',
  dangerSurface: '#451a22',
  infoSurface: '#0c2d48',
  infoBorder: '#0369a1',
  warningSurface: '#3a2c0c',
  warningBorder: '#a16207',
  errorSurface: '#3f1720',
  errorBorder: '#be123c',
} as const;

export function LoadingScreen({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.fullScreen}>
      <ActivityIndicator color={palette.amber} size="large" />
      <Text style={styles.loadingText}>{label}</Text>
    </SafeAreaView>
  );
}

export function UnsupportedScreen() {
  return (
    <SafeAreaView style={styles.unsupported}>
      <Text style={styles.eyebrow}>FLIGHT LOG ALPHA</Text>
      <Text style={styles.unsupportedTitle}>Open this on your phone</Text>
      <Text style={styles.unsupportedBody}>
        Flight recording and your local logbook are available in the installed Android build. The
        web version is only used to check that the project builds cleanly.
      </Text>
    </SafeAreaView>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.headerBody}>{body}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function BackButton({ label = 'Flights', onPress }: { label?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label.toLowerCase()}`}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
      <Text style={styles.backText}>‹ {label}</Text>
    </Pressable>
  );
}

export function ActionButton({
  label,
  onPress,
  disabled = false,
  tone = 'default',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'default' | 'danger' | 'quiet';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'primary' && styles.buttonPrimary,
        tone === 'danger' && styles.buttonDanger,
        tone === 'quiet' && styles.buttonQuiet,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      <Text
        style={[
          styles.buttonText,
          tone === 'primary' && styles.buttonPrimaryText,
          tone === 'danger' && styles.buttonDangerText,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error';
}) {
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[
        styles.notice,
        tone === 'warning' && styles.noticeWarning,
        tone === 'error' && styles.noticeError,
      ]}>
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function BusyRow({ label }: { label: string }) {
  return (
    <View style={styles.busyRow}>
      <ActivityIndicator color={palette.amber} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatusChip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'good' && styles.chipGood,
        tone === 'warning' && styles.chipWarning,
        tone === 'danger' && styles.chipDanger,
      ]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: palette.background,
  },
  unsupported: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 28,
    backgroundColor: palette.background,
  },
  unsupportedTitle: {
    color: palette.text,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  unsupportedBody: {
    color: palette.textMuted,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 560,
    textAlign: 'center',
  },
  loadingText: { color: '#cbd5e1', fontSize: 13 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: palette.amber,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: { color: palette.text, fontSize: 30, fontWeight: '800', marginTop: 4 },
  headerBody: { color: palette.textMuted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    justifyContent: 'center',
    marginLeft: -4,
    paddingHorizontal: 4,
  },
  backText: { color: palette.amber, fontSize: 16, fontWeight: '700' },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surfaceStrong,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  buttonPrimary: { backgroundColor: palette.amber, borderColor: palette.amber },
  buttonDanger: { backgroundColor: palette.dangerSurface, borderColor: palette.danger },
  buttonQuiet: { backgroundColor: 'transparent', borderColor: palette.border },
  buttonText: { color: palette.text, fontSize: 15, fontWeight: '800' },
  buttonPrimaryText: { color: palette.amberText },
  buttonDangerText: { color: '#fff1f2' },
  disabled: { opacity: 0.38 },
  pressed: { opacity: Platform.OS === 'web' ? 0.72 : 0.76 },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
  },
  metric: {
    width: '48%',
    minWidth: 135,
    flexGrow: 1,
    backgroundColor: palette.surfaceQuiet,
    borderRadius: 11,
    padding: 12,
  },
  metricLabel: {
    color: '#7890ad',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: '#f1f5f9',
    fontSize: 19,
    fontWeight: '700',
    marginTop: 5,
    fontVariant: ['tabular-nums'],
  },
  notice: {
    borderRadius: 11,
    borderWidth: 1,
    borderColor: palette.infoBorder,
    backgroundColor: palette.infoSurface,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  noticeWarning: {
    borderColor: palette.warningBorder,
    backgroundColor: palette.warningSurface,
  },
  noticeError: { borderColor: palette.errorBorder, backgroundColor: palette.errorSurface },
  noticeText: { color: '#e2e8f0', fontSize: 13, lineHeight: 18 },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 99,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surfaceStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipGood: { borderColor: '#0f766e', backgroundColor: '#052e2b' },
  chipWarning: { borderColor: palette.warningBorder, backgroundColor: palette.warningSurface },
  chipDanger: { borderColor: palette.errorBorder, backgroundColor: palette.errorSurface },
  chipText: { color: '#e2e8f0', fontSize: 11, fontWeight: '800' },
});

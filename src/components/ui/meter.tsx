import { StyleSheet, View } from 'react-native';

import { paper, type Tone } from '@/ui/theme';

/**
 * A filled bar for "6 / 10". Continuous rather than segmented, because the number it
 * represents keeps growing and segments stop being readable past a handful.
 *
 * Clamped at both ends: over-capacity is a real state here, and a bar that overflowed its
 * track would render as a glitch rather than as "you are past the line".
 *
 * Does not use `toneColor`: its neutral is `paper.faint` (#C9BFAE), which against this
 * track (#E2D9C8) is invisible. A progress fill has to be readable at rest — that is the
 * whole job — so neutral is ink here and only the warning states borrow the tone palette.
 */
const FILL: Record<Tone, string> = {
  neutral: paper.ink,
  good: paper.good,
  warning: paper.warn,
  danger: paper.danger,
};

export function Meter({
  value,
  max,
  tone = 'neutral',
}: {
  value: number;
  max: number;
  tone?: Tone;
}) {
  const fraction = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max, now: Math.min(value, max) }}>
      <View
        style={[
          styles.fill,
          { width: `${fraction * 100}%`, backgroundColor: FILL[tone] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: paper.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
});

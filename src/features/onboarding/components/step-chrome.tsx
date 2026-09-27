import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, paper } from '@/ui/theme';

/**
 * The header every numbered setup step shares: a back chevron, the segmented progress
 * indicator, and the "2/3" count.
 *
 */
export function StepChrome({
  current,
  total,
  onBack,
  disabled = false,
}: {
  current: number;
  total: number;
  onBack: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={12}
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Text style={styles.chevron}>‹</Text>
      </Pressable>

      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Setup step ${current} of ${total}`}
        accessibilityValue={{ min: 1, max: total, now: current }}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[styles.segment, index < current ? styles.segmentDone : null]}
          />
        ))}
      </View>

      <Text style={styles.count} accessibilityElementsHidden importantForAccessibility="no">{`${current}/${total}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  chevron: { fontFamily: fonts.sans, fontSize: 24, lineHeight: 26, color: paper.ink },
  track: { flex: 1, flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: paper.border },
  segmentDone: { backgroundColor: paper.thermal },
  count: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    color: paper.muted,
    minWidth: 26,
    textAlign: 'right',
  },
});

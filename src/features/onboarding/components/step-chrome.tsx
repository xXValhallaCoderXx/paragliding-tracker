import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts, paper } from '@/ui/theme';

/**
 * The header every numbered setup step shares: a back chevron, the segmented progress
 * indicator, and the "2/4" count.
 *
 * Plain `View`s rather than a new kit component on purpose — nothing here takes a
 * `className`, so `src/ui/__tests__/classname-targets.test.ts` and its `OWN` allowlist
 * stay untouched.
 */
export function StepChrome({
  current,
  total,
  onBack,
}: {
  current: number;
  total: number;
  onBack: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={12}
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <Text style={styles.chevron}>‹</Text>
      </Pressable>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: total, now: current }}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[styles.segment, index < current ? styles.segmentDone : null]}
          />
        ))}
      </View>

      <Text style={styles.count}>{`${current}/${total}`}</Text>
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
    fontSize: 11,
    letterSpacing: 0.4,
    color: paper.muted,
    minWidth: 26,
    textAlign: 'right',
  },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, paper, TAB_BAR_HEIGHT } from '@/ui/theme';

export function RecordFab({
  label,
  onPress,
  disabled = false,
  dot = true,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  dot?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { bottom: Math.max(insets.bottom, 12) + 14 + TAB_BAR_HEIGHT },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {dot ? <View style={styles.dot} /> : null}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    height: 56,
    paddingHorizontal: 22,
    borderRadius: 28,
    backgroundColor: paper.thermal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 6px 18px rgba(217,89,31,0.4)',
  },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: paper.onDark },
  label: { fontFamily: fonts.sansSemi, fontSize: 14.5, color: paper.onDark },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

import { StyleSheet, Text, View } from 'react-native';

import { fonts, paper } from '@/ui/theme';

/**
 * The pilot's initials, or a quiet placeholder when there is no name yet.
 *
 * Deliberately not a photo: nothing in this app has an avatar image to show, and a
 * silhouette would just be a slot begging to be filled.
 */
export function Avatar({ initials, size = 46 }: { initials: string; size?: number }) {
  const empty = initials.length === 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
        empty ? styles.empty : null,
      ]}>
      <Text style={[styles.initials, { fontSize: size * 0.36 }, empty ? styles.initialsEmpty : null]}>
        {empty ? '·' : initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: paper.ink,
  },
  empty: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: paper.border,
  },
  initials: { fontFamily: fonts.sansBold, color: paper.onDark, letterSpacing: 0.4 },
  initialsEmpty: { color: paper.muted },
});

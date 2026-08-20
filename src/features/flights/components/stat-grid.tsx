import { StyleSheet, Text, View } from 'react-native';

import { fonts, paper } from '@/ui/theme';

export interface StatCell {
  label: string;
  value: string;
  /** Rendered smaller beside the value, so "52.4 km" reads as one number and its unit. */
  unit?: string | null;
}

/**
 * The flight's numbers, two to a row.
 *
 * A grid rather than the list of rows this replaced: six labelled values down a column all
 * read with equal weight, and the point of the detail screen is that some of these are the
 * story and the rest are supporting. Side by side they scan in one look.
 */
export function StatGrid({ cells }: { cells: StatCell[] }) {
  return (
    <View style={styles.grid}>
      {cells.map((cell) => (
        <View key={cell.label} style={styles.cell}>
          <Text style={styles.label}>{cell.label.toUpperCase()}</Text>
          <View style={styles.valueRow}>
            <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
              {cell.value}
            </Text>
            {cell.unit ? <Text style={styles.unit}>{cell.unit}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 16,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: paper.hairline,
  },
  cell: {
    width: '50%',
    paddingVertical: 12,
    paddingRight: 12,
    gap: 3,
    borderBottomWidth: 1,
    borderBottomColor: paper.hairline,
  },
  label: { fontFamily: fonts.sans, fontSize: 10, letterSpacing: 0.9, color: paper.muted },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value: { fontFamily: fonts.monoSemi, fontSize: 21, letterSpacing: -0.6, color: paper.ink },
  unit: { fontFamily: fonts.sans, fontSize: 11.5, color: paper.muted },
});

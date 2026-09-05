import { StyleSheet, Text, View } from 'react-native';

import { JournalArt } from '@/components/ui/journal-art';

import type { SeasonSummary } from '@/features/logbook/logbook';
import { formatAirtimeShort, formatDistance } from '@/lib/format/flight-format';
import { fonts, paper } from '@/ui/theme';

/**
 * Season totals derived from finished flights on this phone. Non-interactive:
 * a dedicated season screen is not part of this build.
 */
export function SeasonCard({ summary }: { summary: SeasonSummary }) {
  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`Season ${summary.year}: ${formatAirtimeShort(summary.airtimeMs)} airtime, ${summary.flightCount} flights`}>
      <JournalArt scene="flight" height={165} />
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>SEASON {summary.year}</Text>
        <Text style={styles.eyebrowQuiet}>FROM THIS PHONE</Text>
      </View>
      <View style={styles.airtimeRow}>
        <Text style={styles.airtime}>{formatAirtimeShort(summary.airtimeMs)}</Text>
        <Text style={styles.airtimeLabel}>airtime</Text>
      </View>
      <View style={styles.grid}>
        <SeasonStat value={String(summary.flightCount)} label={summary.flightCount === 1 ? 'flight' : 'flights'} />
        <SeasonStat value={formatAirtimeShort(summary.longestMs)} label="longest" />
        <SeasonStat
          value={summary.bestDistanceMetres > 0 ? formatDistance(summary.bestDistanceMetres) : '—'}
          label="best distance"
        />
      </View>
    </View>
  );
}

function SeasonStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: paper.ink,
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerRow: { marginTop: 20, flexWrap: 'wrap', gap: 6, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 10, letterSpacing: 1.4, color: paper.onDark },
  eyebrowQuiet: { fontFamily: fonts.monoMedium, fontSize: 9, letterSpacing: 0.8, color: paper.onDarkMuted },
  airtimeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 9 },
  airtime: { fontFamily: fonts.monoSemi, fontSize: 34, lineHeight: 36, letterSpacing: -1.2, color: paper.onDark },
  airtimeLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: paper.onDark, paddingBottom: 4 },
  grid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: paper.onDarkHairline,
  },
  stat: { flex: 1 },
  statValue: { fontFamily: fonts.monoSemi, fontSize: 15, color: paper.onDark },
  statLabel: { fontFamily: fonts.sans, fontSize: 10, color: paper.onDarkMuted, marginTop: 2 },
});

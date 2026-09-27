import { StyleSheet, Text, View } from 'react-native';

import { JournalArt } from '@/components/ui/journal-art';
import { formatAirtimeShort, formatDistance } from '@/lib/format/flight-format';
import { fonts, paper } from '@/ui/theme';
import type { JournalSummary } from '../journal-query';

const recordedTimeMeaning = 'Recorded time runs from recording start to stop; it includes time on the ground.';
const time = (milliseconds: number | null) => milliseconds === null ? '—' : formatAirtimeShort(milliseconds);

/** Totals for the same complete filtered journal dataset as the cards below it. */
export function JournalSummaryCard({ summary, scopeLabel }: { summary: JournalSummary; scopeLabel: string }) {
  const coverage = summary.flightCount > 0 && (summary.timeCount < summary.flightCount || summary.distanceCount < summary.flightCount)
    ? `Recorded time available for ${summary.timeCount} of ${summary.flightCount} flights; track distance for ${summary.distanceCount} of ${summary.flightCount}.`
    : null;
  const flightLabel = summary.flightCount === 1 ? 'flight' : 'flights';
  const recordedTime = time(summary.recordedTimeMs);
  const longestTime = time(summary.longestMs);
  const longestTrack = formatDistance(summary.longestDistanceMetres);
  const accessibilityLabel = [scopeLabel, `${summary.flightCount} ${flightLabel}`,
    `Recorded time ${recordedTime}. Longest recording ${longestTime}. Longest track ${longestTrack}`,
    coverage, recordedTimeMeaning].filter(Boolean).join('. ');

  return <View style={styles.card} accessibilityRole="summary" accessibilityLabel={accessibilityLabel}>
    <JournalArt scene="flight" height={150} />
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{scopeLabel.toUpperCase()}</Text>
      <Text style={styles.eyebrow}>YOUR LOGBOOK</Text>
    </View>
    <View style={styles.total}>
      <Text style={styles.figure}>{recordedTime}</Text>
      <Text style={styles.totalLabel}>Recorded time · h:mm</Text>
    </View>
    <View style={styles.grid}>
      <SummaryMetric value={summary.flightCount.toLocaleString()} label={flightLabel} />
      <SummaryMetric value={longestTime} label="Longest recording" />
      <SummaryMetric value={longestTrack} label="Longest track" />
    </View>
    {coverage ? <Text style={styles.note}>{coverage}</Text> : null}
    <Text style={styles.note}>{recordedTimeMeaning}</Text>
  </View>;
}

function SummaryMetric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: paper.ink, borderRadius: 24, padding: 16 },
  header: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 18, letterSpacing: 0.8, color: paper.onDarkMuted },
  total: { marginTop: 8, gap: 3 },
  figure: { fontFamily: fonts.monoSemi, fontSize: 38, lineHeight: 48, letterSpacing: -1, color: paper.onDark },
  totalLabel: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 21, color: paper.onDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: paper.onDarkHairline },
  metric: { flexGrow: 1, flexBasis: 88 },
  metricValue: { fontFamily: fonts.monoSemi, fontSize: 17, lineHeight: 24, color: paper.onDark },
  metricLabel: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.onDarkMuted, marginTop: 3 },
  note: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, color: paper.onDarkMuted, marginTop: 12 },
});

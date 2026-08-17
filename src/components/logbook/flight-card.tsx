import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, type ChipTone } from '@/components/flight-ui';
import type { FlightSummary } from '@/recorder/types';
import {
  flightHeadline,
  formatAirtimeShort,
  formatClockTime,
  formatDayLabel,
  formatDistance,
  formatMetres,
} from '@/ui/flight-format';
import { fonts, paper } from '@/ui/theme';

export function FlightCard({ flight, onPress }: { flight: FlightSummary; onPress: () => void }) {
  const metrics = flight.metrics;
  const headline = flightHeadline(flight);
  const site = flight.site?.trim();
  const showSite = Boolean(site && flight.title?.trim() && site !== flight.title?.trim());
  const isProcessing = flight.status === 'processing' || (flight.endedAt !== null && !metrics);
  const durationMs =
    metrics?.durationMs ??
    (flight.endedAt === null ? null : Math.max(0, flight.endedAt - flight.startedAt));
  const chips = flightChips(flight);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${headline}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Text style={styles.dateLine}>
        {formatDayLabel(flight.startedAt, flight.timezoneOffsetMinutes).toUpperCase()} ·{' '}
        {formatClockTime(flight.startedAt, flight.timezoneOffsetMinutes)}
        {showSite ? ` · ${site!.toUpperCase()}` : ''}
      </Text>
      <Text style={styles.title} numberOfLines={2}>
        {headline}
      </Text>
      {isProcessing ? (
        <Text style={styles.metricsPending}>Finishing stats…</Text>
      ) : (
        <Text style={styles.metrics}>
          {durationMs === null ? '—' : formatAirtimeShort(durationMs)}
          <Text style={styles.dot}> · </Text>
          {metrics && metrics.trackDistanceMetres > 0 ? formatDistance(metrics.trackDistanceMetres) : '—'}
          <Text style={styles.dot}> · </Text>
          {formatMetres(metrics?.maxGpsAltitude ?? null)}
        </Text>
      )}
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <Chip key={chip.label} label={chip.label} tone={chip.tone} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export function flightChips(flight: FlightSummary): { label: string; tone: ChipTone }[] {
  const chips: { label: string; tone: ChipTone }[] = [];
  const metrics = flight.metrics;
  if (flight.status === 'processing' || (flight.endedAt !== null && !metrics)) {
    chips.push({ label: 'Finishing stats', tone: 'muted' });
    return chips;
  }
  if (flight.status === 'partial' || metrics?.quality === 'partial') {
    chips.push({ label: 'Partial', tone: 'warning' });
  }
  if (metrics?.quality === 'no_track') {
    chips.push({ label: 'No track', tone: 'danger' });
  } else if (metrics?.quality === 'gaps') {
    chips.push({ label: 'Track gaps', tone: 'warning' });
  } else if (metrics?.quality === 'healthy') {
    chips.push({ label: 'Good track', tone: 'good' });
  }
  return chips;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  pressed: { opacity: 0.74 },
  dateLine: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 0.4, color: paper.muted },
  title: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 19, color: paper.ink, marginTop: 5 },
  metrics: { fontFamily: fonts.monoSemi, fontSize: 12, color: paper.ink, marginTop: 8 },
  metricsPending: { fontFamily: fonts.sans, fontSize: 12, color: paper.muted, marginTop: 8 },
  dot: { color: paper.faint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 },
});

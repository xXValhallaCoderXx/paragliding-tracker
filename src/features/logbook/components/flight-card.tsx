import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui';
import { TrackPlate } from '@/features/flights/components/track-plate';
import { trackPlateState } from '@/features/flights/track-presentation';
import { flightChips, isFlightProcessing } from '@/features/logbook/logbook';
import type { FlightSummary } from '@/recorder/types';
import {
  flightHeadline,
  formatAirtimeShort,
  formatClockTime,
  formatDayLabel,
  formatDistance,
  formatMetres,
} from '@/lib/format/flight-format';
import type { TrackSegments } from '@/lib/track/types';
import { fonts, paper } from '@/ui/theme';

/** Stable identity, so a default `[]` does not churn the plate memo on every list render. */
const EMPTY_TRACK: TrackSegments = [];

export function FlightCard({
  flight,
  track = EMPTY_TRACK,
  onPress,
}: {
  flight: FlightSummary;
  /** The stored shape, when there is one. Never derived here — see `listTracks`. */
  track?: TrackSegments;
  onPress: () => void;
}) {
  const metrics = flight.metrics;
  const headline = flightHeadline(flight);
  const site = flight.site?.trim();
  const showSite = Boolean(site && flight.title?.trim() && site !== flight.title?.trim());
  const isProcessing = isFlightProcessing(flight);
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
      <View style={styles.row}>
        <View style={styles.body}>
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
              {metrics && metrics.trackDistanceMetres > 0
                ? formatDistance(metrics.trackDistanceMetres)
                : '—'}
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
        </View>

        {/*
          Renders nothing at all when there is no track — a card with an empty box beside it
          reads as broken, a card with no box reads as no picture, and the chip above
          already says which flights those are. The text simply reflows to the full width.
        */}
        <View style={styles.thumbnail}>
          <TrackPlate
            segments={track}
            variant="thumbnail"
            state={trackPlateState(flight, track)}
          />
        </View>
      </View>
    </Pressable>
  );
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
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  body: { flex: 1 },
  // Fixed width so every card's text column starts and ends in the same place, whether or
  // not that flight has a track yet.
  thumbnail: { width: 64 },
  dateLine: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 0.4, color: paper.muted },
  title: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 19, color: paper.ink, marginTop: 5 },
  metrics: { fontFamily: fonts.monoSemi, fontSize: 12, color: paper.ink, marginTop: 8 },
  metricsPending: { fontFamily: fonts.sans, fontSize: 12, color: paper.muted, marginTop: 8 },
  dot: { color: paper.faint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 },
});

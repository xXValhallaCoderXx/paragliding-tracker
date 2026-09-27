import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, type ChipTone } from '@/components/ui';
import { FlightMapPreview } from '@/features/flights/components/flight-map-preview';
import { archivedRouteMessage, trackPlateState } from '@/features/flights/track-presentation';
import { isFlightProcessing } from '@/features/logbook/logbook';
import { journalFlightMetrics, journalQualityExplanation, journalQualityFlags, type JournalQuality } from '../journal-query';
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
const QUALITY_CHIPS: Record<JournalQuality, { label: string; tone: ChipTone }> = {
  healthy: { label: 'Good track', tone: 'good' },
  gaps: { label: 'Track gaps', tone: 'warning' },
  partial: { label: 'Partial recording', tone: 'warning' },
  no_track: { label: 'No usable track', tone: 'muted' },
  unknown: { label: 'Metrics unavailable', tone: 'muted' },
};

export function FlightCard({
  flight,
  track = EMPTY_TRACK,
  mapPreviewEnabled = true,
  onPress,
}: {
  flight: FlightSummary;
  /** The stored shape, when there is one. Never derived here — see `listTracks`. */
  track?: TrackSegments;
  mapPreviewEnabled?: boolean;
  onPress: () => void;
}) {
  const headline = flightHeadline(flight);
  const site = flight.site?.trim();
  const showSite = Boolean(site && flight.title?.trim() && site !== flight.title?.trim());
  const isProcessing = isFlightProcessing(flight);
  const { durationMs, distanceMetres } = journalFlightMetrics(flight);
  const quality = journalQualityFlags(flight);
  const explanation = journalQualityExplanation(flight);
  const chips: { label: string; tone: ChipTone }[] = [
    ...(flight.source === 'archive' ? [{ label: 'Restored', tone: 'altitude' as const }] : []),
    ...(isProcessing ? [{ label: 'Finishing stats', tone: 'muted' as const }] : quality.map(flag => QUALITY_CHIPS[flag])),
  ];
  const archiveMessage = track.length === 0 ? archivedRouteMessage(flight) : null;
  const recordedTime = durationMs === null ? '—' : formatAirtimeShort(durationMs);
  const distance = formatDistance(distanceMetres);
  const altitude = formatMetres(isProcessing ? null : flight.metrics?.maxGpsAltitude ?? null);
  const date = `${formatDayLabel(flight.startedAt, flight.timezoneOffsetMinutes)} · ${formatClockTime(flight.startedAt, flight.timezoneOffsetMinutes)}`;
  const accessibilityLabel = [
    `Open ${headline}`, date, showSite ? site : null,
    ...chips.map(chip => chip.label),
    isProcessing ? null : `Recorded time ${recordedTime}, track distance ${distance}, maximum GPS altitude ${altitude}`,
    explanation, archiveMessage,
  ].filter(Boolean).join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.row}>
        <View style={styles.body}>
          <Text style={styles.dateLine}>
            {date.toUpperCase()}
            {showSite ? ` · ${site!.toUpperCase()}` : ''}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {headline}
          </Text>
          {!isProcessing ? <View style={styles.metrics}>
            <CardMetric value={recordedTime} label="Recorded time" />
            <CardMetric value={distance} label="Track distance" />
            <CardMetric value={altitude} label="Max GPS altitude" />
          </View> : null}
          {chips.length > 0 ? (
            <View style={styles.chips}>
              {chips.map((chip) => (
                <Chip key={chip.label} label={chip.label} tone={chip.tone} />
              ))}
            </View>
          ) : null}
          {explanation ? <Text style={[styles.explanation,
            (quality.includes('partial') || quality.includes('gaps')) && styles.warning]}>{explanation}</Text> : null}
        </View>

        {/* Finished routes and unavailable/processing states share a full-width plate. */}
        <View style={styles.thumbnail}>
          {archiveMessage ? <Text style={styles.routeMessage}>{archiveMessage}</Text> : <FlightMapPreview
            enabled={mapPreviewEnabled}
            segments={track}
            variant="hero"
            state={trackPlateState(flight, track)}
          />}
        </View>
      </View>
    </Pressable>
  );
}

function CardMetric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
  },
  pressed: { opacity: 0.74 },
  row: { gap: 16 },
  body: { flex: 1 },
  // A full-width route gives each dated journal entry room to breathe.
  thumbnail: { width: '100%' },
  dateLine: { fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 18, letterSpacing: 0.4, color: paper.muted },
  title: { fontFamily: fonts.sansSemi, fontSize: 21, lineHeight: 27, color: paper.ink, marginTop: 5 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  metric: { flexGrow: 1, flexBasis: 90 },
  metricValue: { fontFamily: fonts.monoSemi, fontSize: 16, lineHeight: 23, color: paper.ink },
  metricLabel: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted, marginTop: 2 },
  explanation: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, color: paper.muted, marginTop: 9 },
  warning: { color: paper.warnInk },
  routeMessage: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 19, color: paper.muted,
    backgroundColor: paper.cardAlt, padding: 14, borderRadius: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 },
});

import { StyleSheet, Text, View } from 'react-native';

import { Chip, type ChipTone } from '@/components/flight-ui';
import type { FlightDetail } from '@/recorder/types';
import {
  formatAirtime,
  formatAirtimeWords,
  formatClockTime,
  formatDayPartLabel,
  formatDistanceParts,
  formatLongDate,
  formatMetres,
  formatThousands,
  formatUtcOffset,
  utcOffsetDiffersFromDevice,
} from '@/ui/flight-format';
import { fonts, paper } from '@/ui/theme';

export type SavedContext = 'stopped' | 'partial' | null;

export interface DetailStatus {
  label: string;
  tone: ChipTone;
}

export function FlightHero({
  flight,
  status,
  saved,
  insight,
}: {
  flight: FlightDetail;
  status: DetailStatus;
  saved: SavedContext;
  insight: string | null;
}) {
  const metrics = flight.metrics;
  const tz = flight.timezoneOffsetMinutes;
  const title = flight.title?.trim() || null;
  const site = flight.site?.trim() || null;
  const dayPart = formatDayPartLabel(flight.startedAt, tz);
  const eyebrow = site && site !== title ? `${dayPart} · ${site}` : dayPart;
  const durationMs =
    metrics?.durationMs ??
    (flight.endedAt === null ? null : Math.max(0, flight.endedAt - flight.startedAt));
  const distance = metrics && metrics.trackDistanceMetres > 0 ? formatDistanceParts(metrics.trackDistanceMetres) : null;
  const heroIsDistance = distance !== null;
  const endLabel = flight.endedAt === null ? null : formatClockTime(flight.endedAt, tz);
  const showOffset = tz !== null && utcOffsetDiffersFromDevice(tz);

  let summaryLine: string | null = null;
  if (metrics) {
    if (heroIsDistance && durationMs !== null) {
      summaryLine = `${formatAirtimeWords(durationMs)} in the air · ${formatMetres(metrics.maxGpsAltitude)} max altitude`;
    } else if (metrics.quality === 'no_track') {
      summaryLine = 'No usable GPS track was recorded.';
    } else {
      summaryLine = `${formatMetres(metrics.maxGpsAltitude)} max altitude · ${formatThousands(metrics.fixCount)} fixes`;
    }
  } else if (flight.endedAt === null) {
    summaryLine = 'This flight is still open.';
  } else {
    summaryLine = 'Stats are still being calculated.';
  }

  return (
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.bigRow}>
        {heroIsDistance ? (
          <>
            <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>
              {distance.value}
            </Text>
            <Text style={styles.bigUnit}>{distance.unit}</Text>
          </>
        ) : (
          <Text style={[styles.big, styles.bigTime]} numberOfLines={1} adjustsFontSizeToFit>
            {durationMs === null ? '—' : formatAirtime(durationMs)}
          </Text>
        )}
      </View>
      {summaryLine ? <Text style={styles.summary}>{summaryLine}</Text> : null}

      {saved ? (
        <View style={[styles.savedBox, saved === 'partial' && styles.savedBoxPartial]}>
          <Text style={[styles.savedTitle, saved === 'partial' && styles.savedTitlePartial]}>
            {saved === 'partial' ? 'Saved as a partial flight.' : 'Nice one — saved to your logbook.'}
          </Text>
          <Text style={[styles.savedBody, saved === 'partial' && styles.savedBodyPartial]}>
            {saved === 'partial'
              ? `Only what was recorded before the interruption is kept${endLabel ? `, up to ${endLabel}` : ''}. It is marked partial everywhere it appears.`
              : `${endLabel ? `Stopped at ${endLabel}. ` : ''}The details below are optional — add whatever will help you remember it.`}
          </Text>
        </View>
      ) : null}

      {insight ? (
        <View style={styles.insight}>
          <View style={styles.insightDot} />
          <Text style={styles.insightText}>{insight}</Text>
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {formatLongDate(flight.startedAt, tz)} · {formatClockTime(flight.startedAt, tz)}
          {endLabel ? `–${endLabel}` : ''}
          {showOffset ? ` · ${formatUtcOffset(tz)}` : ''}
        </Text>
        <Chip label={status.label} tone={status.tone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6 },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 10, letterSpacing: 1.4, color: paper.muted },
  title: { fontFamily: fonts.sansSemi, fontSize: 17, lineHeight: 22, color: paper.ink, marginTop: 8 },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  big: {
    fontFamily: fonts.monoSemi,
    fontSize: 58,
    lineHeight: 58,
    letterSpacing: -2.6,
    color: paper.ink,
    flexShrink: 1,
  },
  bigTime: { fontSize: 46, lineHeight: 50, letterSpacing: -1.8 },
  bigUnit: { fontFamily: fonts.sansSemi, fontSize: 20, color: paper.muted, paddingBottom: 6 },
  summary: { fontFamily: fonts.sansMedium, fontSize: 16, lineHeight: 22, color: paper.ink, marginTop: 10 },
  savedBox: {
    marginTop: 14,
    backgroundColor: paper.goodSoft,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  savedBoxPartial: { backgroundColor: paper.warnSoft, borderWidth: 1, borderColor: paper.warnBorder },
  savedTitle: { fontFamily: fonts.sansSemi, fontSize: 13, color: paper.good },
  savedTitlePartial: { color: paper.warnInk },
  savedBody: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: '#3E5E45' },
  savedBodyPartial: { color: '#7A5A1A' },
  insight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 14,
    backgroundColor: paper.thermalSoft,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  insightDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: paper.thermal, marginTop: 5 },
  insightText: { flex: 1, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: paper.thermalInk },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14 },
  meta: { flex: 1, fontFamily: fonts.sans, fontSize: 12, color: paper.muted },
});

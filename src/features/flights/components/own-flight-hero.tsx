import { Text, View } from 'react-native';
import { Chip, Notice, SectionLabel } from '@/components/ui';
import type { FlightSummary } from '@/recorder/types';
import { formatClockTime, formatDistanceParts, formatLongDate } from '@/lib/format/flight-format';
import { journalQualityExplanation, journalQualityFlags } from '@/features/logbook/journal-query';
import { ownFlightMetrics } from '../own-flight-presentation';

/** Own-flight presentation only: the public detail retains its separate contract. */
export function OwnFlightHero({ flight, saved, insight }: { flight: FlightSummary; saved: boolean; insight: string | null }) {
  const measurements = ownFlightMetrics(flight);
  const distance = formatDistanceParts(measurements.distanceMetres);
  const quality = journalQualityFlags(flight);
  const explanation = journalQualityExplanation(flight);
  return <View className="gap-[12px] px-[20px] pt-[12px]">
    {saved ? <Notice title={flight.status === 'partial' ? 'Partial flight saved on this phone' : 'Saved on this phone'} tone="good">
      Your recording is in your logbook. Add a title or site to help remember it.
    </Notice> : null}
    <Text className="font-data-medium text-[12px] text-muted">{formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes)}</Text>
    <Text accessibilityRole="header" className="font-body-bold text-[32px] leading-[38px] text-ink">{flight.title?.trim() || flight.site?.trim() || 'A day in the sky'}</Text>
    <Text className="font-body text-[16px] text-muted">{flight.site || 'Unnamed site'} · Start {formatClockTime(flight.startedAt, flight.timezoneOffsetMinutes)}{flight.endedAt !== null ? ` · Stop ${formatClockTime(flight.endedAt, flight.timezoneOffsetMinutes)}` : ''}</Text>
    <View className="gap-[4px]">
      <SectionLabel>{saved ? 'Recorded time' : 'Track distance'}</SectionLabel>
      <Text className="font-data-semi text-[44px] leading-[54px] text-ink">{saved ? measurements.time : distance ? `${distance.value} ${distance.unit}` : '—'}</Text>
    </View>
    <View className="flex-row flex-wrap gap-[8px]">
      <Chip label={flight.source === 'archive' ? 'Restored from backup' : 'Recorded on this phone'} tone="muted" />
      {quality.map(flag => <Chip key={flag} label={{ healthy: 'Good track', gaps: 'Track gaps', partial: 'Partial recording', no_track: 'No usable track', unknown: 'Stats pending/unavailable' }[flag]} tone={flag === 'healthy' ? 'good' : flag === 'gaps' || flag === 'partial' ? 'warning' : 'muted'} />)}
    </View>
    {explanation ? <Text className="font-body text-[14px] text-muted">{explanation}</Text> : null}
    {insight ? <Notice tone="info">{insight}</Notice> : null}
  </View>;
}

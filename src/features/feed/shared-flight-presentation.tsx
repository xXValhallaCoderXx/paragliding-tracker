import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button, Chip, SectionLabel } from '@/components/ui';
import { formatClockTime, formatDistance, formatLongDate } from '@/lib/format/flight-format';
import type { SharedFlightSummary } from '@/social/feed-types';
import { fonts, paper } from '@/ui/theme';
import { sharedHeadline, sharedMeasurements, sharedStats, sharedStatus } from './presentation';
import { feedStyles as styles } from './styles';

/** Public presentation only: no journal, aircraft, personal insight or export inputs. */
export function SharedFlightHero({ flight }: { flight: SharedFlightSummary }) {
  const measurements = sharedMeasurements(flight);
  const status = sharedStatus(flight);
  return <View style={local.hero}>
    <Text style={styles.date}>{formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes)}</Text>
    <Text accessibilityRole="header" style={local.title}>{sharedHeadline(flight)}</Text>
    <Text style={styles.body}>{flight.site?.trim() || 'Unnamed site'} · Start {formatClockTime(flight.startedAt, flight.timezoneOffsetMinutes)} · Stop {formatClockTime(flight.endedAt, flight.timezoneOffsetMinutes)}</Text>
    <View style={local.headline}>
      <SectionLabel>Track distance</SectionLabel>
      <Text style={local.distance}>{formatDistance(measurements.distanceMetres)}</Text>
    </View>
    <View style={local.badges}>
      <Chip label={flight.provenance === 'igc' ? 'From archived IGC' : 'Recorded on Flight Log'} tone="muted" />
      <Chip label={status.label} tone={status.tone} />
    </View>
  </View>;
}

export function SharedFlightStats({ flight }: { flight: SharedFlightSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 360 || fontScale > 1.2;
  return <View style={local.stats}>
    <View style={local.grid}>
      {sharedStats(flight, expanded).map(cell => <View key={cell.label} style={[local.cell, singleColumn && local.wide]}>
        <Text style={styles.helper}>{cell.label}</Text>
        <Text style={local.value}>{cell.value}</Text>
      </View>)}
    </View>
    <Button label={expanded ? 'Fewer stats' : 'More stats'} onPress={() => setExpanded(!expanded)} />
    <Text style={styles.helper}>Recorded time runs from Start to Stop, including interruptions. GPS altitude is relative to the WGS84 ellipsoid.</Text>
  </View>;
}

const local = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  title: { fontFamily: fonts.sansBold, fontSize: 32, lineHeight: 38, color: paper.ink },
  headline: { gap: 4 },
  distance: { fontFamily: fonts.monoSemi, fontSize: 44, lineHeight: 54, color: paper.ink },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stats: { paddingHorizontal: 18, paddingTop: 20, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: paper.hairline },
  cell: { flexBasis: '50%', flexGrow: 1, minWidth: 145, gap: 6, paddingVertical: 14, paddingRight: 12,
    borderBottomWidth: 1, borderBottomColor: paper.hairline },
  wide: { flexBasis: '100%' },
  value: { fontFamily: fonts.monoSemi, fontSize: 21, color: paper.ink },
});

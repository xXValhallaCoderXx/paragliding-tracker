import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { FlightSummary } from '@/recorder/types';
import type { TrackSegments } from '@/lib/track/types';
import { straightLineMetres } from '@/lib/track/stats';
import { trackPointCount } from '@/lib/track/simplify';
import { formatClockTime, formatDistance, formatLongDate, formatUtcOffset } from '@/lib/format/flight-format';
import { ownFlightMetrics } from '../own-flight-presentation';

export function OwnFlightStats({ flight, track }: { flight: FlightSummary; track: TrackSegments }) {
  const [expanded, setExpanded] = useState(false);
  const values = ownFlightMetrics(flight);
  const offset = flight.timezoneOffsetMinutes;
  const stamp = (timestamp: number | null) => timestamp === null ? '—' : `${formatLongDate(timestamp, offset)} · ${formatClockTime(timestamp, offset)}`;
  const cells = [
    ['Recorded time', values.time], ['Track distance', formatDistance(values.distanceMetres)],
    ['Maximum GPS altitude', values.maximumAltitude], ['Maximum ground speed', values.maximumSpeed],
    ...(expanded ? [['Minimum GPS altitude', values.minimumAltitude], ['Start-to-stop straight-line distance', formatDistance(trackPointCount(track) >= 2 ? straightLineMetres(track) : null)],
      ['GPS fix count', values.fixCount], ['Start', stamp(flight.startedAt)], ['Stop', stamp(flight.endedAt)],
      ['Recording timezone', offset === null ? 'Not captured · times use this device’s timezone' : formatUtcOffset(offset)]] : []),
  ];
  return <View className="gap-[12px] px-[18px]">
    <View className="flex-row flex-wrap border-t border-hairline">
      {cells.map(([label, value]) => <View key={label} style={{ flexGrow: 1, flexBasis: '50%', minWidth: 145 }} className="gap-[6px] border-b border-hairline py-[14px] pr-[12px]">
        <Text className="font-body text-[12px] text-muted">{label}</Text>
        <Text className="font-data-semi text-[21px] text-ink">{value}</Text>
      </View>)}
    </View>
    <Button label={expanded ? 'Fewer stats' : 'More stats'} onPress={() => setExpanded(!expanded)} />
    <Text className="font-body text-[12px] text-muted">Recorded time runs from Start to Stop, including interruptions. GPS altitude is relative to the WGS84 ellipsoid.</Text>
  </View>;
}

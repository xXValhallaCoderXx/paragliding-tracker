import { Pressable, Text, View } from 'react-native';
import { Avatar, Card, Chip } from '@/components/ui';
import { TrackPlate } from '@/features/flights/components/track-plate';
import { friendInitials } from '@/features/friends/presentation';
import { formatDistance, formatLongDate } from '@/lib/format/flight-format';
import type { SharedFlightSummary } from '@/social/feed-types';
import { sharedHeadline, sharedMeasurements, sharedStatus } from './presentation';
import { KudosControls } from './kudos-controls';
import { feedLayout } from './feed-layout';
import { feedStyles as styles } from './styles';

export function SharedFlightCard({ flight, own, onOpen, onAuthor }: {
  flight: SharedFlightSummary; own: boolean; onOpen(): void; onAuthor(): void;
}) {
  const status = sharedStatus(flight);
  const values = sharedMeasurements(flight);
  return <Card><View style={feedLayout.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${own ? 'your Friends profile' : flight.author.displayName + '’s profile'}`}
      onPress={onAuthor} style={({ pressed }) => [feedLayout.identity, pressed && styles.pressed]}>
      <Avatar initials={friendInitials(flight.author.displayName)} size={40} />
      <View style={styles.grow}><Text style={styles.name}>{flight.author.displayName}</Text>
        <Text style={styles.helper}>{flight.site?.trim() || (own ? 'Your shared flight' : 'Shared with friends')}</Text></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open shared flight: ${sharedHeadline(flight)}`}
      onPress={onOpen} style={({ pressed }) => pressed && styles.pressed}>
      <TrackPlate segments={flight.routePreview} variant="hero" state={flight.routePreview.length ? 'ready' : 'no_track'} takeoffLabel="Start" landingLabel="Stop" />
      <View style={feedLayout.summary}>
        <Text style={styles.heading}>{sharedHeadline(flight)}</Text>
        <Text style={styles.date}>Flight on {formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes)}</Text>
        <View style={feedLayout.cardMetrics}>
          {[['Recorded time', values.time], ['Track distance', formatDistance(values.distanceMetres)], ['Max GPS altitude', values.maximumAltitude]].map(([label, value]) =>
            <View key={label} style={feedLayout.cardMetric}><Text style={styles.helper}>{label}</Text><Text style={styles.metrics}>{value}</Text></View>)}
        </View>
        {status.tone === 'warning' ? <Chip label={status.label} tone={status.tone} /> : null}
      </View>
    </Pressable>
    <View style={feedLayout.cardFooter}><KudosControls activityId={flight.activityId} summary={flight.kudos} own={own} /></View>
  </View></Card>;
}

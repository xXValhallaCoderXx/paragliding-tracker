import { Pressable, Text, View } from 'react-native';
import { Avatar, Card, Chip } from '@/components/ui';
import { TrackPlate } from '@/features/flights/components/track-plate';
import { friendInitials } from '@/features/friends/presentation';
import { formatAirtimeShort, formatDistance, formatLongDate, formatMetres } from '@/lib/format/flight-format';
import type { SharedFlightSummary } from '@/social/feed-types';
import { sharedHeadline, sharedStatus } from './presentation';
import { feedStyles as styles } from './styles';

export function SharedFlightCard({ flight, own, onOpen, onAuthor }: {
  flight: SharedFlightSummary; own: boolean; onOpen(): void; onAuthor(): void;
}) {
  const status = sharedStatus(flight);
  return <Card><View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${own ? 'your Friends profile' : flight.author.displayName + '’s profile'}`}
      onPress={onAuthor} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Avatar initials={friendInitials(flight.author.displayName)} />
      <View style={styles.grow}><Text style={styles.name}>{flight.author.displayName}</Text>
        <Text style={styles.helper}>{own ? 'Your shared flight' : 'Shared with friends'}</Text></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open shared flight: ${sharedHeadline(flight)}`}
      onPress={onOpen} style={({ pressed }) => [styles.section, pressed && styles.pressed]}>
      <Text style={styles.date}>{formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes)}</Text>
      <Text style={styles.heading}>{sharedHeadline(flight)}</Text>
      {flight.site?.trim() && flight.site.trim() !== sharedHeadline(flight) ? <Text style={styles.helper}>{flight.site}</Text> : null}
      <Text style={styles.metrics}>{formatAirtimeShort(flight.metrics.durationMs)} · {flight.metrics.quality === 'no_track' ? '—' : formatDistance(flight.metrics.trackDistanceMetres)} · {formatMetres(flight.metrics.maxGpsAltitude)}</Text>
      <Chip label={status.label} tone={status.tone} />
      <TrackPlate segments={flight.routePreview} variant="hero" state={flight.routePreview.length ? 'ready' : 'no_track'} takeoffLabel="Start" landingLabel="Stop" />
    </Pressable>
  </View></Card>;
}

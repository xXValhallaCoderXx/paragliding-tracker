import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Notice, Screen, TopBar } from '@/components/ui';
import { FlightHero } from '@/features/flights/components/hero';
import { FlightMapPreview } from '@/features/flights/components/flight-map-preview';
import { StatGrid } from '@/features/flights/components/stat-grid';
import { siteAttribution } from '@/features/flights/site-picker';
import { friendInitials } from '@/features/friends/presentation';
import { useFriends } from '@/features/friends/friends-provider';
import { errorMessage } from '@/lib/format/error-message';
import type { SharedFlightDetail } from '@/social/feed-types';
import { fonts, paper, radii } from '@/ui/theme';
import { useFeed } from './feed-provider';
import { KudosControls } from './kudos-controls';
import { sharedHeroSummary, sharedStats, sharedStatus } from './presentation';
import { feedStyles as styles } from './styles';

export default function SharedDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const friends = useFriends();
  const feed = useFeed();
  const back = () => router.canGoBack() ? router.back() : router.replace('/friends');
  const accessible = friends.status === 'ready' && feed.available && feed.identityKey === friends.identityKey;
  return <Screen><TopBar title="Shared flight" onBack={back} backLabel="Back to Friends" />
    {friends.status !== 'ready' ? <View style={styles.content}><Notice title="Sign in to view shared flights">Flights are available to the owner and their accepted friends.</Notice>
      <Button label="Open Account" onPress={() => router.push('/account')} /></View>
      : !accessible ? <View style={styles.content}><Notice title="Connect to view this flight">Shared flights and replays are available while you are online.</Notice></View>
        : !id || typeof id !== 'string' ? <View style={styles.content}><Notice title="Shared flight unavailable">Open a flight from Friends.</Notice></View>
          : focused ? <SharedDetailContent key={`${feed.identityKey}:${feed.revision}:${id}`} activityId={id} /> : null}
  </Screen>;
}

type Read = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; flight: SharedFlightDetail };
function SharedDetailContent({ activityId }: { activityId: string }) {
  const feed = useFeed();
  const { getDetail } = feed;
  const router = useRouter();
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let current = true;
    setRead({ kind: 'loading' });
    void getDetail(activityId).then(flight => { if (current) setRead({ kind: 'ready', flight }); })
      .catch(error => { if (current) setRead({ kind: 'error', message: errorMessage(error) }); });
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry restarts this focus-scoped authorized read.
  }, [activityId, getDetail, retry]));
  const revoked = read.kind === 'ready' && !feed.kudosByActivity[activityId];
  if (revoked) setRead({ kind: 'error', message: 'This shared flight is no longer available. Refresh Friends.' });
  if (read.kind === 'loading') return <View style={styles.content}><BusyRow label="Opening shared flight…" /></View>;
  if (read.kind === 'error' || revoked) return <View style={styles.content}>
    <Notice tone="danger" title="Shared flight unavailable">{read.kind === 'error' ? read.message : 'This shared flight is no longer available. Refresh Friends.'}</Notice>
    <Button label="Retry shared flight" onPress={() => setRetry(value => value + 1)} />
  </View>;
  const { flight } = read;
  const own = flight.author.userId === feed.identityKey;
  const attribution = siteAttribution(flight.siteSource);
  return <ScrollView contentContainerStyle={styles.detailContent}>
    <View style={styles.detailSection}>
      <Pressable accessibilityRole="button" accessibilityLabel={own ? 'Your Friends profile' : `View ${flight.author.displayName}’s profile`}
        onPress={() => own ? router.push('/friends/manage')
          : router.push({ pathname: '/friends/[id]', params: { id: flight.author.userId } })}
        style={({ pressed }) => [detailStyles.pilot, pressed && styles.pressed]}>
        <Avatar initials={friendInitials(flight.author.displayName)} size={42} />
        <View style={detailStyles.pilotText}>
          <Text style={styles.name}>{flight.author.displayName}</Text>
          <Text style={styles.helper}>{own ? 'Your shared flight' : 'Shared with accepted friends'}</Text>
        </View>
        <Text accessible={false} style={detailStyles.chevron}>›</Text>
      </Pressable>
    </View>
    <FlightHero flight={sharedHeroSummary(flight)} status={sharedStatus(flight)} saved={null} insight={null} />
    <View style={styles.detailSection}>
      <FlightMapPreview segments={flight.routePreview} variant="hero" cachePolicy="none"
        state={flight.routePreview.length ? 'ready' : 'no_track'} takeoffLabel="Start" landingLabel="Stop"
        describe={() => 'Shared flight route. Circle marks the first fix and square marks the last. Recording gaps stay open.'} />
      {flight.status === 'partial' || flight.metrics.quality === 'partial' ? <Notice tone="warning" title="Partial flight">Statistics and replay cover only the saved portion of this flight.</Notice> : null}
      {flight.metrics.quality === 'gaps' ? <Notice tone="warning" title="Track has timing gaps">Distance and maximum values may be incomplete. Recording gaps stay open in the replay.</Notice> : null}
      {flight.metrics.quality === 'no_track' ? <Notice title="No usable GPS track">No usable route was recorded for this flight.</Notice> : null}
    </View>
    <StatGrid cells={sharedStats(flight)} />
    <View style={styles.detailSection}>
      {flight.replayAvailable ? <Button label="Replay shared flight" variant="primary" size="xl" disabled={feed.recorderBusy}
        onPress={() => router.push({ pathname: '/shared-flights/[id]/replay', params: { id: activityId } })} />
        : <Notice title="Replay unavailable">This shared flight does not contain enough usable GPS fixes for replay. Its summary remains available.</Notice>}
      {feed.recorderBusy && flight.replayAvailable ? <Text style={styles.helper}>Finish recording before opening a shared replay.</Text> : null}
    </View>
    <View style={styles.detailSection}><KudosControls activityId={activityId} summary={flight.kudos} own={own} /></View>
    <View style={styles.detailSection}>
      <View style={detailStyles.about}>
        {attribution ? <Text style={styles.helper}>{attribution}</Text> : null}
        <Text style={styles.helper}>{flight.provenance === 'igc'
          ? 'Replay comes from the archived IGC and keeps its saved time and coordinate precision. Replay ground speed is unavailable; the summary keeps the original saved statistics.'
          : 'Replay uses the saved GPS route and available telemetry. Missing measurements and recording gaps remain unavailable.'}</Text>
        <Text style={styles.helper}>Shared with accepted friends. Private journal notes, pilot details and original recorder files are not included.</Text>
      </View>
    </View>
  </ScrollView>;
}

const detailStyles = StyleSheet.create({
  pilot: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.controlLarge,
    borderWidth: 1, borderColor: paper.border, backgroundColor: paper.card,
  },
  pilotText: { flex: 1, gap: 3 },
  chevron: { fontFamily: fonts.sansMedium, fontSize: 24, color: paper.muted },
  about: { borderTopWidth: 1, borderTopColor: paper.hairline, paddingTop: 16, gap: 8 },
});

import { useCallback, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Notice, Screen, TopBar } from '@/components/ui';
import { useFriends } from '@/features/friends/friends-provider';
import { friendInitials } from '@/features/friends/presentation';
import { errorMessage } from '@/lib/format/error-message';
import type { KudosCursor, KudosPage, SharedFlightDetail } from '@/social/feed-types';
import { formatLongDate } from '@/lib/format/flight-format';
import { fonts, paper } from '@/ui/theme';
import { sharedHeadline } from './presentation';
import { useFeed } from './feed-provider';
import { feedStyles as styles } from './styles';

export default function KudosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const friends = useFriends();
  const feed = useFeed();
  const accessible = friends.status === 'ready' && feed.available && feed.identityKey === friends.identityKey;
  const back = () => router.canGoBack() ? router.back() : router.replace('/friends');
  return <Screen><TopBar title="Kudos" onBack={back} backLabel="Back to shared flight" />
    {!accessible ? <View style={styles.content}><Notice title="Connect to view kudos">Sign in and connect to see who supported this flight.</Notice></View>
      : !id || typeof id !== 'string' ? <View style={styles.content}><Notice title="Kudos unavailable">Open kudos from a shared flight.</Notice></View>
        : focused ? <KudosContent key={`${feed.identityKey}:${feed.revision}:${id}`} activityId={id} /> : null}
  </Screen>;
}

type Read = { kind: 'loading' } | { kind: 'error'; message: string }
  | { kind: 'ready'; page: KudosPage; flight: SharedFlightDetail; loadingMore: boolean };
function KudosContent({ activityId }: { activityId: string }) {
  const feed = useFeed();
  const { getKudos, getDetail } = feed;
  const entry = feed.kudosByActivity[activityId];
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const revoked = read.kind === 'ready' && (!entry || !entry.summary);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(async (cursor: KudosCursor | null) => {
    if (!mounted.current || inFlight.current) return;
    inFlight.current = true;
    const revision = ++sequence.current;
    setRead(current => cursor && current.kind === 'ready' ? { ...current, loadingMore: true } : { kind: 'loading' });
    try {
      // Context comes from the same authorized projection, never route parameters or a private logbook row.
      const flight = cursor ? null : await getDetail(activityId);
      if (!mounted.current || revision !== sequence.current) return;
      if (flight && flight.kudos === null) throw new Error('Kudos are unavailable for this flight.');
      const page = await getKudos(activityId, cursor);
      if (!mounted.current || revision !== sequence.current) return;
      setRead(current => {
        if (cursor && current.kind === 'ready') {
          const seen = new Set(current.page.items.map(item => item.id));
          return { ...current, loadingMore: false, page: { ...page, items: [...current.page.items, ...page.items.filter(item => !seen.has(item.id))] } };
        }
        return flight ? { kind: 'ready', loadingMore: false, page, flight } : current;
      });
    } catch (error) {
      // Even a later-page denial must release names already shown by this route.
      if (mounted.current && revision === sequence.current) setRead({ kind: 'error', message: errorMessage(error) });
    } finally { if (revision === sequence.current) inFlight.current = false; }
  }, [activityId, getDetail, getKudos]);
  useFocusEffect(useCallback(() => {
    mounted.current = true;
    void load(null);
    return () => { mounted.current = false; sequence.current += 1; inFlight.current = false; };
  }, [load]));
  // A controller denial can arrive through another screen's read. Adjust this
  // route's state before committing so retained names are released immediately.
  if (revoked) setRead({ kind: 'error', message: 'This shared flight is no longer available. Refresh Friends.' });
  if (read.kind === 'error' || revoked) return <View style={styles.content}>
    <Notice tone="danger" title="Kudos unavailable">{read.kind === 'error' ? read.message : 'This shared flight is no longer available. Refresh Friends.'}</Notice>
    <Button label="Retry kudos" onPress={() => void load(null)} />
  </View>;
  if (read.kind === 'loading') return <View style={styles.content}><BusyRow label="Loading kudos…" /></View>;
  return <FlatList data={read.page.items} keyExtractor={item => item.id}
    contentContainerStyle={styles.content} initialNumToRender={25} maxToRenderPerBatch={25} windowSize={5}
    ListHeaderComponent={<View style={styles.section}>
      <View style={local.context}>
        <Text style={styles.date}>{read.flight.author.displayName} · {formatLongDate(read.flight.startedAt, read.flight.timezoneOffsetMinutes)}</Text>
        <Text accessibilityRole="header" style={styles.heading}>{sharedHeadline(read.flight)}</Text>
        <View style={local.countRow}><Text style={local.count}>{(entry?.summary?.count ?? read.page.count).toLocaleString()}</Text><Text style={styles.name}>kudos</Text></View>
      </View>
      <Text style={styles.helper}>Newest first. Names and initials are visible to everyone who can view this flight. Blocked pilots are excluded.</Text>
      <Button label="Refresh kudos" disabled={read.loadingMore} onPress={() => void load(null)} />
    </View>}
    ListEmptyComponent={<Notice title="No kudos yet">Support for this flight will appear here.</Notice>}
    renderItem={({ item }) => <View style={[styles.row, local.supporter]}><Avatar initials={friendInitials(item.displayName)} /><Text style={[styles.name, styles.grow]}>{item.displayName}</Text></View>}
    ListFooterComponent={read.page.nextCursor ? <Button label={read.loadingMore ? 'Loading more kudos…' : 'Load more kudos'}
      busy={read.loadingMore} onPress={() => void load(read.page.nextCursor)} /> : null} />;
}

const local = StyleSheet.create({
  context: { gap: 10, paddingTop: 8 },
  countRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, paddingVertical: 10 },
  count: { fontFamily: fonts.monoSemi, fontSize: 44, lineHeight: 54, color: paper.ink },
  supporter: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: paper.hairline },
});

import { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BusyRow, Button, Notice, Screen } from '@/components/ui';
import FriendsScreen from '@/features/friends/friends-screen';
import { useFriends } from '@/features/friends/friends-provider';
import { AutomaticSharingCard } from './automatic-sharing-card';
import { useFeed } from './feed-provider';
import { SharedFlightCard } from './shared-flight-card';
import { feedStyles as styles } from './styles';

export default function FeedScreen() {
  const friends = useFriends();
  const feed = useFeed();
  const router = useRouter();
  const { refresh, available } = feed;
  const hasProfile = friends.profile !== null;
  useFocusEffect(useCallback(() => {
    if (available && hasProfile) void refresh().catch(() => undefined);
  }, [available, hasProfile, refresh]));
  // Setup owns its loading/error/offline states. Unmounting it during its own
  // focus refresh would mount it again after every empty-profile response.
  if (friends.status !== 'ready' || !hasProfile) return <FriendsScreen />;
  const showFlights = feed.available && feed.identityKey === friends.identityKey;
  return <Screen edges={['top', 'left', 'right']}>
    <FlatList data={showFlights ? feed.items : []} keyExtractor={item => item.activityId}
      contentContainerStyle={styles.content} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={5}
      ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
      refreshing={feed.loading} onRefresh={() => void feed.refresh().catch(() => undefined)}
      ListHeaderComponent={<View style={styles.section}>
        <View><Text style={styles.eyebrow}>A SMALL CIRCLE</Text><Text style={styles.title}>Friends</Text>
          <Text style={styles.body}>Flights from the pilots you know.</Text></View>
        <Button label="Manage friends" onPress={() => router.push('/friends/manage')} />
        {showFlights ? <AutomaticSharingCard key={feed.identityKey} /> : <Notice title="Connect to see shared flights">The feed and shared replays are available while you are online.</Notice>}
        {feed.error ? <Notice tone="danger" title="Could not refresh shared flights">{feed.error}</Notice> : null}
        {friends.error ? <Notice tone="danger" title="Could not load Friends">{friends.error}</Notice> : null}
        <Button label="Refresh shared flights" disabled={!showFlights || feed.loading} onPress={() => void feed.refresh().catch(() => undefined)} />
      </View>}
      ListEmptyComponent={showFlights ? feed.loading || friends.loading ? <BusyRow label="Loading shared flights…" />
        : !feed.error ? <Notice title="No shared flights yet">When you or your friends share a flight, it will appear here. Your logbook stays private until you choose to share.</Notice> : null : null}
      renderItem={({ item }) => <SharedFlightCard flight={item} own={item.author.userId === feed.identityKey}
        onOpen={() => router.push({ pathname: '/shared-flights/[id]', params: { id: item.activityId } })}
        onAuthor={() => item.author.userId === feed.identityKey ? router.push('/friends/manage')
          : router.push({ pathname: '/friends/[id]', params: { id: item.author.userId } })} />}
      ListFooterComponent={showFlights && feed.nextCursor ? <Button label={feed.loadingMore ? 'Loading more flights…' : 'Load more flights'}
        busy={feed.loadingMore} disabled={feed.loading} onPress={() => void feed.loadMore().catch(() => undefined)} /> : null} />
  </Screen>;
}

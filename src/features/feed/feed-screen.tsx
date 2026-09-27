import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BusyRow, Button, Notice, Screen, TabGlyph } from '@/components/ui';
import { JournalArt } from '@/components/ui/journal-art';
import FriendsScreen from '@/features/friends/friends-screen';
import { useFriends } from '@/features/friends/friends-provider';
import { AutomaticSharingCard } from './automatic-sharing-card';
import { useFeed } from './feed-provider';
import { SharedFlightCard } from './shared-flight-card';
import { FeedIcon } from './feed-icon';
import { feedLayout } from './feed-layout';
import { sharedFeedRows } from './presentation';
import { paper } from '@/ui/theme';
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
  const hasFriends = friends.relationships.some(relationship => relationship.state === 'accepted');
  const rows = sharedFeedRows(showFlights ? feed.items : []);
  const refreshFlights = () => { if (showFlights && !feed.loading) void feed.refresh().catch(() => undefined); };
  const refreshControl = <Pressable accessibilityRole="button" accessibilityLabel="Refresh shared flights"
    accessibilityState={{ disabled: !showFlights || feed.loading, busy: showFlights && feed.loading }}
    disabled={!showFlights || feed.loading} onPress={refreshFlights}
    style={({ pressed }) => [feedLayout.refresh, (!showFlights || feed.loading) && feedLayout.disabled, pressed && styles.pressed]}>
    {showFlights && feed.loading ? <ActivityIndicator size="small" color={paper.muted} /> : null}
    <Text style={feedLayout.actionText}>{showFlights && feed.loading ? 'Refreshing…' : 'Refresh'}</Text>
  </Pressable>;
  return <Screen edges={['top', 'left', 'right']}>
    <FlatList data={rows} keyExtractor={item => item.flight.activityId}
      contentContainerStyle={styles.content} initialNumToRender={3} maxToRenderPerBatch={3} windowSize={5}
      ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
      refreshing={showFlights && feed.loading} onRefresh={refreshFlights}
      ListHeaderComponent={<View style={feedLayout.header}>
        <View style={feedLayout.headingRow}>
          <View style={styles.grow}><Text style={styles.eyebrow}>A SMALL CIRCLE</Text><Text style={styles.title}>Friends</Text></View>
          <View style={feedLayout.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Find pilots" accessibilityHint="Search for pilots to add as friends."
              onPress={() => router.push('/friends/search')} style={({ pressed }) => [feedLayout.iconButton, pressed && styles.pressed]}>
              <FeedIcon name="search" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Your circle" accessibilityHint="Manage friends, requests, and your Friends profile."
              onPress={() => router.push('/friends/manage')} style={({ pressed }) => [feedLayout.iconButton, pressed && styles.pressed]}>
              <TabGlyph shape="friends" color={paper.ink} focused={false} />
            </Pressable>
          </View>
        </View>
        {!friends.profile?.username ? <Notice title="Complete your profile">Choose a unique @username in Manage friends before finding pilots. Your existing feed and friends stay available.</Notice> : null}
        {showFlights ? <AutomaticSharingCard key={feed.identityKey} /> : <Notice title="Connect to see shared flights">The feed and shared replays are available while you are online.</Notice>}
        {feed.error ? <Notice tone="danger" title={rows.length ? 'Could not load more flights' : 'Could not refresh shared flights'}>{feed.error}</Notice> : null}
        {friends.error ? <Notice tone="danger" title="Could not load Friends">{friends.error}</Notice> : null}
        {!rows.length ? refreshControl : null}
      </View>}
      ListEmptyComponent={showFlights ? feed.loading || friends.loading || !friends.available
        ? <BusyRow label={!friends.available ? 'Checking your circle…' : 'Loading shared flights…'} />
        : !feed.error && !friends.error ? <View style={feedLayout.empty}>
          <JournalArt scene="launch" height={160} />
          <View style={feedLayout.emptyCopy}>
            <Text style={styles.heading}>{hasFriends ? 'No shared flights yet.' : 'Nobody here yet.'}</Text>
            <Text style={styles.body}>{hasFriends
              ? 'When you or your friends publish a flight, it will appear here.'
              : 'Add the pilots you fly with and their shared flights land here.'}</Text>
            <Text style={styles.body}>{feed.preferences?.enabled
              ? 'Automatic sharing is on for eligible recordings started after opt-in. Existing private flights stay private until you share them.'
              : feed.preferences ? 'Your logbook stays private until you share a flight or turn on automatic sharing.'
                : 'Check your sharing preference before starting a new recording.'}</Text>
          </View>
          <View style={feedLayout.emptyActions}>
            <Button label={hasFriends ? 'Open logbook' : 'Find pilots'} variant="primary"
              onPress={() => router.push(hasFriends ? '/(tabs)' : '/friends/search')} />
            <Button label={hasFriends ? 'Find pilots' : 'Open logbook'}
              onPress={() => router.push(hasFriends ? '/friends/search' : '/(tabs)')} />
          </View>
        </View> : null : null}
      renderItem={({ item: { flight, heading }, index }) => <View>
        {heading ? <View style={feedLayout.dayHeadingRow}>
          <Text accessibilityRole="header" style={feedLayout.dayHeading}>{heading}</Text>
          {index === 0 ? refreshControl : null}
        </View> : null}
        <SharedFlightCard flight={flight} own={flight.author.userId === feed.identityKey}
          onOpen={() => router.push({ pathname: '/shared-flights/[id]', params: { id: flight.activityId } })}
          onAuthor={() => flight.author.userId === feed.identityKey ? router.push('/friends/manage')
            : router.push({ pathname: '/friends/[id]', params: { id: flight.author.userId } })} />
      </View>}
      ListFooterComponent={showFlights && feed.nextCursor ? <Button label={feed.loadingMore ? 'Loading more flights…' : 'Load more flights'}
        busy={feed.loadingMore} disabled={feed.loading} onPress={() => void feed.loadMore().catch(() => undefined)} /> : null} />
  </Screen>;
}

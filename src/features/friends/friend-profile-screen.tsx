import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Card, Notice, Screen, TopBar } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import type { SocialProfile } from '@/social/types';
import { useFriends } from './friends-provider';
import { friendInitials } from './presentation';
import { friendsStyles as styles } from './styles';

export default function FriendProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const friends = useFriends();
  return <Screen>
    <TopBar title="Friend profile" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {friends.status === 'restoring' ? <BusyRow label="Loading your account…" />
        : friends.status !== 'ready' ? <View style={styles.section}>
          <Notice title="Sign in to view a friend">Profiles are available to accepted friends.</Notice>
          <Button label="Open Account" onPress={() => router.push('/account')} />
        </View>
        : !friends.available ? <Notice title="Connect to view this profile">Profiles and backed-up flight counts need an internet connection.</Notice>
        : typeof id !== 'string' || !id ? <Notice tone="danger" title="Profile unavailable">Open a profile from your Friends tab.</Notice>
        : <ProfileContent key={`${friends.identityKey}:${friends.revision}:${id}`} userId={id} />}
    </ScrollView>
  </Screen>;
}

type ProfileRead = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; profile: SocialProfile };

function ProfileContent({ userId }: { userId: string }) {
  const { getFriendProfile } = useFriends();
  const [read, setRead] = useState<ProfileRead>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let current = true;
    setRead({ kind: 'loading' });
    void getFriendProfile(userId).then(profile => {
      if (current) setRead({ kind: 'ready', profile });
    }).catch(error => {
      if (current) setRead({ kind: 'error', message: errorMessage(error) });
    });
    return () => { current = false; setRead({ kind: 'loading' }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry deliberately restarts the focus-scoped read.
  }, [getFriendProfile, retry, userId]));
  if (read.kind === 'loading') return <BusyRow label="Loading friend profile…" />;
  if (read.kind === 'error') return <View style={styles.section}>
    <Notice tone="danger" title="Profile unavailable">{read.message}</Notice>
    <Button label="Retry profile" onPress={() => setRetry(value => value + 1)} />
  </View>;
  return <>
    <View style={styles.profile}>
      <Avatar initials={friendInitials(read.profile.displayName)} size={76} />
      <Text style={[styles.title, styles.centered]}>{read.profile.displayName}</Text>
      {read.profile.username ? <Text style={styles.body}>@{read.profile.username}</Text> : null}
      <Text style={styles.helper}>Your friend on Flight Log Alpha</Text>
    </View>
    <Card><View style={[styles.card, styles.profile]}>
      <Text style={styles.count}>{read.profile.backedUpFlightCount.toLocaleString()}</Text>
      <Text style={styles.name}>Backed-up flights</Text>
      <Text style={[styles.helper, styles.centered]}>Finished flights synced to their account. Flights saved only on a phone are not included.</Text>
    </View></Card>
    <Button label="Refresh profile" onPress={() => setRetry(value => value + 1)} />
  </>;
}

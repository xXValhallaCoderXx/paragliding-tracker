import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Card, LinkButton, Notice, Screen, TopBar } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import type { SocialProfile } from '@/social/types';
import { fonts, paper } from '@/ui/theme';
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
          <Button label="Open Pilot" onPress={() => router.push('/account')} />
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
  const router = useRouter();
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
    <View style={profileStyles.identity}>
      <Avatar initials={friendInitials(read.profile.displayName)} size={68} />
      <View style={profileStyles.identityText}>
        <Text accessibilityRole="header" style={profileStyles.name}>{read.profile.displayName}</Text>
        {read.profile.username ? <Text style={profileStyles.username}>@{read.profile.username}</Text> : null}
        <Text style={styles.helper}>Your friend on Flight Log Alpha</Text>
      </View>
    </View>
    <Card variant="dark"><View style={profileStyles.summary}>
      <Text style={profileStyles.count} numberOfLines={1} adjustsFontSizeToFit>{read.profile.backedUpFlightCount.toLocaleString()}</Text>
      <Text style={profileStyles.countLabel}>Backed-up flights</Text>
      <View style={profileStyles.definition}>
        <Text style={profileStyles.summaryText}>Finished flights synced to their account. Flights saved only on a phone are not included.</Text>
      </View>
    </View></Card>
    <Button label="Refresh profile" onPress={() => setRetry(value => value + 1)} />
    <LinkButton label="Manage friends" onPress={() => router.push('/friends/manage')} />
  </>;
}

const profileStyles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 8 },
  identityText: { flex: 1, gap: 5 },
  name: { fontFamily: fonts.sansBold, fontSize: 26, lineHeight: 32, color: paper.ink, letterSpacing: -0.6 },
  username: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: paper.muted },
  summary: { padding: 20, gap: 8 },
  count: { fontFamily: fonts.monoSemi, fontSize: 42, lineHeight: 50, color: paper.onDark, letterSpacing: -1 },
  countLabel: { fontFamily: fonts.sansSemi, fontSize: 16, lineHeight: 22, color: paper.onDark },
  definition: { borderTopWidth: 1, borderTopColor: paper.onDarkHairline, paddingTop: 12, marginTop: 6 },
  summaryText: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.onDarkMuted },
});

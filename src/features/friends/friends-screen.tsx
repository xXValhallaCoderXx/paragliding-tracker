import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Card, Input, LinkButton, Notice, Screen, SectionLabel, TopBar } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import type { FriendshipAction, FriendshipSummary } from '@/social/types';
import { useFriends } from './friends-provider';
import { friendInitials, validDisplayName, validUsername } from './presentation';
import { RelationshipCard } from './relationship-card';
import { friendsStyles as styles } from './styles';

export default function FriendsScreen({ manage = false }: { manage?: boolean }) {
  const friends = useFriends();
  const router = useRouter();
  const { refresh, available, status } = friends;
  useFocusEffect(useCallback(() => {
    if (status === 'ready' && available) void refresh().catch(() => undefined);
  }, [available, refresh, status]));
  return <Screen edges={['top', 'left', 'right']}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {manage ? <TopBar title="Manage friends" onBack={() => router.canGoBack() ? router.back() : router.replace('/friends')} backLabel="Back to Friends" /> : null}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>A SMALL CIRCLE</Text>
        <Text style={styles.title}>{manage ? 'Your circle' : 'Friends'}</Text>
        <Text style={styles.body}>Connect with the pilots you know.</Text>
      </View>
      {status === 'restoring' ? <BusyRow label="Loading your account…" />
        : status === 'signed_out' ? <View style={styles.section}>
          <Notice title="Sign in to connect">Use your account to add friends and choose the name they see.</Notice>
          <Button label="Open Pilot" onPress={() => router.push('/account')} />
        </View>
        : status === 'unconfigured' ? <Notice title="Friends is unavailable in this build">Your logbook and recorder remain available.</Notice>
        : <FriendsContent key={friends.identityKey} />}
    </ScrollView>
  </Screen>;
}

function FriendsContent() {
  const friends = useFriends();
  const router = useRouter();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [discoverable, setDiscoverable] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const scope = useRef({ active: false, version: 0 });
  useFocusEffect(useCallback(() => {
    scope.current = { active: friends.available, version: scope.current.version + 1 };
    setWorking(null);
    return () => { scope.current = { active: false, version: scope.current.version + 1 }; };
  }, [friends.available]));
  const disabled = friends.busy || working !== null || !friends.available;
  const run = async (label: string, operation: () => Promise<unknown>) => {
    if (disabled || !scope.current.active) return;
    const version = scope.current.version;
    setWorking(label); setLocalError(null);
    try { await operation(); }
    catch (error) { if (scope.current.version === version) setLocalError(errorMessage(error)); }
    finally { if (scope.current.version === version) setWorking(null); }
  };
  const save = () => run('Saving profile…', async () => {
    const version = scope.current.version;
    await friends.saveProfile({ displayName: name, username, discoverable });
    if (scope.current.version === version) { setEditing(false); setCreating(false); }
  });
  const change = (relation: FriendshipSummary, action: FriendshipAction) => {
    const version = scope.current.version;
    const apply = () => { if (scope.current.version === version) void run('Updating connection…', () => friends.changeRelationship(relation, action)); };
    if (action === 'remove' || action === 'block') {
      // Native alerts can outlive the React screen during an account switch.
      // Keep names in the account-scoped screen, outside the native dialog.
      Alert.alert(action === 'block' ? 'Block this pilot?' : 'Remove this friend?',
        action === 'block' ? 'They will no longer be able to request friendship or view your friend profile. You can unblock them later.'
          : 'You will no longer see each other’s profiles. You can send a new request later.',
        [{ text: 'Cancel', style: 'cancel' }, { text: action === 'block' ? 'Block' : 'Remove friend', style: 'destructive', onPress: apply }]);
    } else apply();
  };
  const firstUse = !friends.profile && !friends.loading && !friends.error && friends.available;
  const showNameForm = editing || firstUse || creating;
  const message = localError ?? friends.error;
  return <>
    <LinkButton label="Refresh friends" disabled={disabled || friends.loading} onPress={() => void run('Loading Friends…', friends.refresh)} />
    {!friends.available ? <Notice title="Friends needs a connection">Connect to the internet to load profiles or change your connections.</Notice> : null}
    {message ? <View style={styles.section}>
      <Notice tone="danger" title="That did not work">{message}</Notice>
      <Button label="Retry loading Friends" disabled={disabled} onPress={() => void run('Loading Friends…', friends.refresh)} />
    </View> : null}
    {working ? <BusyRow label={working} /> : friends.loading ? <BusyRow label="Loading Friends…" /> : null}
    {showNameForm ? <Card><View style={styles.card}>
      <SectionLabel>{editing ? 'Edit your profile' : 'Your Friends profile'}</SectionLabel>
      <Text style={styles.name}>Choose how friends see you</Text>
      <View style={styles.row}><Avatar initials={friendInitials(name)} /><Text style={styles.helper}>Your initials preview</Text></View>
      <Input label="Display name" value={name} onChangeText={value => { setName(value); if (!editing) setCreating(true); }} placeholder="The name your friends know"
        maxLength={120} editable={!disabled} hint="1–60 characters. Separate from your private pilot details." />
      <Input label="Username" value={username} onChangeText={value => { setUsername(value.toLowerCase()); if (!editing) setCreating(true); }}
        placeholder="your_username" autoCapitalize="none" autoComplete="off" maxLength={24}
        editable={!disabled} hint="3–24 lowercase letters, numbers or underscores. Your @username is unique and editable." last />
      <View style={styles.row}><View style={styles.rowText}><Text style={styles.name}>Show me in search</Text>
        <Text style={styles.helper}>Other signed-in pilots can find your name, initials and @username. No flight count or flights appear in search.</Text></View>
        <Switch accessibilityLabel="Show me in search" value={discoverable} onValueChange={setDiscoverable} disabled={disabled} /></View>
      <Text style={styles.helper}>Turning this off prevents new incoming requests. Existing friends and requests stay, and you can still find pilots and send requests.</Text>
      <Text style={styles.helper}>Your name and @username appear with requests. Accepted friends can see your profile and backed-up flight count.</Text>
      <Text style={styles.helper}>If you give kudos, your name and initials are visible to everyone who can view that flight, including people outside your friends.</Text>
      <Button label={editing ? 'Save profile' : 'Create my Friends profile'} variant="primary" disabled={disabled || !validDisplayName(name) || !validUsername(username)} onPress={() => void save()} />
      {editing ? <LinkButton label="Cancel editing" disabled={disabled} onPress={() => setEditing(false)} /> : null}
    </View></Card> : friends.profile ? <Card><View style={styles.card}>
      <View style={styles.row}><Avatar initials={friendInitials(friends.profile.displayName)} /><View style={styles.rowText}>
        <Text style={styles.helper}>YOUR FRIENDS PROFILE</Text><Text style={styles.name}>{friends.profile.displayName}</Text>
        {friends.profile.username ? <Text style={styles.body}>@{friends.profile.username}</Text> : null}
      </View></View>
      <Text style={styles.helper}>{friends.profile.discoverable ? 'Visible in pilot search' : 'Hidden from pilot search'}</Text>
      {!friends.profile.username ? <Notice title="Complete your profile">Choose a unique @username before finding pilots or sending new requests. Your existing friends and shared flights stay available.</Notice> : null}
      <LinkButton label={friends.profile.username ? 'Edit profile' : 'Complete profile'} disabled={disabled} onPress={() => {
        setName(friends.profile!.displayName); setUsername(friends.profile!.username ?? '');
        setDiscoverable(friends.profile!.discoverable); setEditing(true);
      }} />
    </View></Card> : null}
    {friends.profile ? <>
      <Button label="Find pilots" disabled={disabled || !friends.profile.username} onPress={() => router.push('/friends/search')} />
      {(['incoming', 'accepted', 'outgoing', 'blocked'] as const).map(state => {
        const entries = friends.relationships.filter(relation => relation.state === state);
        if (!entries.length && (state !== 'accepted' || !friends.profile || friends.loading || friends.error || !friends.available)) return null;
        return <View key={state} style={styles.section}>
          <SectionLabel>{{ incoming: 'Incoming requests', accepted: 'Your friends', outgoing: 'Sent requests', blocked: 'Blocked' }[state]}</SectionLabel>
          {!entries.length ? <Text style={styles.body}>No friends yet. Find a pilot and send a request to start your circle.</Text> : entries.map(relation =>
            <RelationshipCard key={relation.id} relation={relation} disabled={disabled}
              onAction={action => change(relation, action)} onProfile={() => router.push({ pathname: '/friends/[id]', params: { id: relation.userId } })} />)}
        </View>;
      })}
    </> : null}
  </>;
}

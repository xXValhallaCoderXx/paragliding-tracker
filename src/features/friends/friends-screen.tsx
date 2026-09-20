import { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Card, Input, LinkButton, Notice, Screen, SectionLabel, TopBar } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import type { FriendRequestStatus, FriendshipAction, FriendshipSummary } from '@/social/types';
import { useFriends } from './friends-provider';
import { displayInviteCode, friendInitials, REQUEST_STATUS, validDisplayName } from './presentation';
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
          <Button label="Open Account" onPress={() => router.push('/account')} />
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
  const [code, setCode] = useState('');
  const [requestStatus, setRequestStatus] = useState<FriendRequestStatus | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const disabled = friends.busy || working !== null || !friends.available;
  const run = async (label: string, operation: () => Promise<unknown>) => {
    if (disabled) return;
    setWorking(label); setLocalError(null);
    try { await operation(); }
    catch (error) { setLocalError(errorMessage(error)); }
    finally { setWorking(null); }
  };
  const save = () => run('Saving profile…', async () => {
    await friends.saveProfile(name); setEditing(false); setCreating(false);
  });
  const request = () => run('Sending request…', async () => {
    setRequestStatus(null);
    const result = await friends.requestFriend(code);
    setRequestStatus(result);
    if (REQUEST_STATUS[result].success) setCode('');
  });
  const change = (relation: FriendshipSummary, action: FriendshipAction) => {
    const apply = () => void run('Updating connection…', () => friends.changeRelationship(relation, action));
    if (action === 'remove' || action === 'block') {
      // Native alerts can outlive the React screen during an account switch.
      // Keep names in the account-scoped screen, outside the native dialog.
      Alert.alert(action === 'block' ? 'Block this pilot?' : 'Remove this friend?',
        action === 'block' ? 'They will no longer be able to request friendship or view your friend profile. You can unblock them later.'
          : 'You will no longer see each other’s profiles. You can send a new request later.',
        [{ text: 'Cancel', style: 'cancel' }, { text: action === 'block' ? 'Block' : 'Remove friend', style: 'destructive', onPress: apply }]);
    } else apply();
  };
  const regenerate = () => Alert.alert('Replace your friend code?', 'Your old code will stop working. Existing friends and requests will stay as they are.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Replace code', onPress: () => void run('Replacing code…', friends.rotateInviteCode) },
  ]);
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
      <SectionLabel>{editing ? 'Edit your name' : 'Your Friends profile'}</SectionLabel>
      <Text style={styles.name}>Choose how friends see you</Text>
      <View style={styles.row}><Avatar initials={friendInitials(name)} /><Text style={styles.helper}>Your initials preview</Text></View>
      <Input label="Display name" value={name} onChangeText={value => { setName(value); if (!editing) setCreating(true); }} placeholder="The name your friends know"
        maxLength={120} editable={!disabled} hint="1–60 characters. Separate from your private pilot details." last />
      <Text style={styles.helper}>Your name appears with requests. Accepted friends can see your name, initials and backed-up flight count.</Text>
      <Text style={styles.helper}>If you give kudos, your name and initials are visible to everyone who can view that flight, including people outside your friends.</Text>
      <Button label={editing ? 'Save name' : 'Create my Friends profile'} variant="primary" disabled={disabled || !validDisplayName(name)} onPress={() => void save()} />
      {editing ? <LinkButton label="Cancel editing" disabled={disabled} onPress={() => setEditing(false)} /> : null}
    </View></Card> : friends.profile ? <Card><View style={styles.card}>
      <View style={styles.row}><Avatar initials={friendInitials(friends.profile.displayName)} /><View style={styles.rowText}>
        <Text style={styles.helper}>YOUR FRIENDS PROFILE</Text><Text style={styles.name}>{friends.profile.displayName}</Text>
      </View></View>
      <LinkButton label="Edit display name" disabled={disabled} onPress={() => { setName(friends.profile!.displayName); setEditing(true); }} />
    </View></Card> : null}
    {friends.profile || code.length > 0 ? <>
      <View style={styles.section}>
        <SectionLabel>Invite a friend</SectionLabel>
        {friends.profile ? <Card><View style={styles.card}>
          <Text style={styles.body}>Share this private code with someone you want to add.</Text>
          {friends.inviteCode ? <>
            <Text selectable accessibilityLabel={`Your friend code: ${friends.inviteCode}`} style={styles.code}>{displayInviteCode(friends.inviteCode)}</Text>
            <Button label="Share friend code" disabled={disabled} onPress={() => void run('Opening share sheet…', () => Share.share({
              message: `Add me on Flight Log Alpha. My friend code is ${friends.inviteCode}. Enter it in the Friends tab to send a request.`,
            }))} />
            <LinkButton label="Replace friend code" disabled={disabled} onPress={regenerate} />
          </> : <Text style={styles.helper}>Your code could not be loaded. Refresh friends to try again.</Text>}
        </View></Card> : null}
        <Card><View style={styles.card}>
          <Input label="Their friend code" value={code} onChangeText={value => { setCode(value); setRequestStatus(null); }}
            placeholder="Enter their 12-character code" maxLength={40} autoCapitalize="characters" autoComplete="off" editable={!disabled} last />
          <Button label="Send friend request" variant="primary" disabled={disabled || code.replace(/[\s-]/g, '').length !== 12} onPress={() => void request()} />
          {requestStatus ? <Notice tone={REQUEST_STATUS[requestStatus].success ? 'good' : 'warning'} title={REQUEST_STATUS[requestStatus].title}>
            {REQUEST_STATUS[requestStatus].message}
          </Notice> : null}
        </View></Card>
      </View>
      {(['incoming', 'accepted', 'outgoing', 'blocked'] as const).map(state => {
        const entries = friends.relationships.filter(relation => relation.state === state);
        if (!entries.length && (state !== 'accepted' || !friends.profile || friends.loading || friends.error || !friends.available)) return null;
        return <View key={state} style={styles.section}>
          <SectionLabel>{{ incoming: 'Incoming requests', accepted: 'Your friends', outgoing: 'Sent requests', blocked: 'Blocked' }[state]}</SectionLabel>
          {!entries.length ? <Text style={styles.body}>No friends yet. Share your code or enter a friend’s code to get started.</Text> : entries.map(relation =>
            <RelationshipCard key={relation.id} relation={relation} disabled={disabled}
              onAction={action => change(relation, action)} onProfile={() => router.push({ pathname: '/friends/[id]', params: { id: relation.userId } })} />)}
        </View>;
      })}
    </> : null}
  </>;
}

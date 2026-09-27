import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Avatar, BusyRow, Button, Card, Input, LinkButton, Notice, Screen, TopBar } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import type { FriendRequestStatus, FriendshipAction, PilotSearchPage, PilotSearchResult } from '@/social/types';
import { useFriends } from './friends-provider';
import { friendInitials, REQUEST_STATUS } from './presentation';
import { friendsStyles as styles } from './styles';

type SearchRead = { key: string; kind: 'idle' | 'loading' | 'error' | 'ready'; page?: PilotSearchPage; error?: string };
type ReadScope = { active: boolean; controller: AbortController; key: string; paging: boolean };

export default function PilotSearchScreen() {
  const friends = useFriends();
  const router = useRouter();
  return <Screen><TopBar title="Find pilots" onBack={() => router.canGoBack() ? router.back() : router.replace('/friends')} backLabel="Back to Friends" />
    {friends.status === 'restoring' ? <BusyRow label="Loading your account…" />
      : friends.status !== 'ready' ? <View style={styles.content}>
        <Notice title="Sign in to find pilots">Search is available to signed-in pilots with a Friends profile.</Notice>
        <Button label="Open Pilot" onPress={() => router.push('/account')} />
      </View> : <SearchContent key={friends.identityKey} />}
  </Screen>;
}

function SearchContent() {
  const friends = useFriends();
  const router = useRouter();
  const { available, revision, identityKey, searchPilots } = friends;
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<SearchRead>({ key: '', kind: 'idle' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<FriendRequestStatus | null>(null);
  const scope = useRef<ReadScope | null>(null);
  const mutationScope = useRef({ active: false, version: 0 });
  const normalized = query.trim();
  const queryLength = Array.from(normalized.replace(/^@/, '')).length;
  const enough = queryLength >= 2;
  const validLength = enough && queryLength <= 60;
  const hasUsername = Boolean(friends.profile?.username);
  const eligible = available && hasUsername;
  const readEligible = eligible && !friends.busy;
  const key = `${identityKey}:${revision}:${normalized}:${retry}`;
  const current = readEligible && read.key === key ? read : { key, kind: 'idle' as const };
  const disabled = friends.busy || working !== null || !eligible;

  // Drafts stay with this account; names/results never survive a lost read scope.
  useFocusEffect(useCallback(() => {
    mutationScope.current = { active: eligible, version: mutationScope.current.version + 1 };
    setWorking(null); setActionError(null); setRequestStatus(null);
    return () => { mutationScope.current = { active: false, version: mutationScope.current.version + 1 }; };
  }, [eligible]));
  useFocusEffect(useCallback(() => {
    const active: ReadScope = { active: true, controller: new AbortController(), key, paging: false };
    scope.current = active;
    setLoadingMore(false);
    setRead({ key, kind: readEligible && validLength ? 'loading' : 'idle' });
    const timer = readEligible && validLength ? setTimeout(() => {
      void searchPilots(normalized, null, active.controller.signal).then(page => {
        if (active.active && scope.current === active) setRead({ key, kind: 'ready', page });
      }).catch(error => {
        if (active.active && scope.current === active) setRead({ key, kind: 'error', error: errorMessage(error) });
      });
    }, 350) : undefined;
    return () => {
      clearTimeout(timer); active.active = false; active.controller.abort();
      if (scope.current === active) scope.current = null;
      setRead({ key: '', kind: 'idle' });
    };
  }, [readEligible, validLength, key, normalized, searchPilots]));

  const loadMore = async () => {
    const active = scope.current;
    const page = current.page;
    if (!active?.active || active.key !== key || active.paging || disabled || !page?.nextCursor) return;
    active.paging = true; setLoadingMore(true);
    try {
      const next = await searchPilots(normalized, page.nextCursor, active.controller.signal);
      if (!active.active || scope.current !== active) return;
      const ids = new Set(page.items.map(item => item.userId));
      setRead({ key, kind: 'ready', page: next.status === 'rate_limited' ? next : {
        ...next, items: [...page.items, ...next.items.filter(item => !ids.has(item.userId))],
      } });
    } catch (error) {
      if (active.active && scope.current === active) setRead({ key, kind: 'error', error: errorMessage(error) });
    } finally {
      active.paging = false;
      if (active.active && scope.current === active) setLoadingMore(false);
    }
  };
  const actOnPilot = async (pilot: PilotSearchResult, action: 'request' | 'block' | FriendshipAction) => {
    const guard = mutationScope.current;
    if (!guard.active || disabled) return;
    setWorking(pilot.userId); setActionError(null); setRequestStatus(null);
    try {
      if (action === 'request') {
        const status = await friends.requestPilot(pilot.userId);
        if (mutationScope.current === guard) setRequestStatus(status);
      } else if (action === 'block') await friends.blockPilot(pilot.userId);
      else if (pilot.relationshipId && pilot.relationshipState !== 'none') {
        await friends.changeRelationship({ id: pilot.relationshipId, userId: pilot.userId, displayName: pilot.displayName,
          username: pilot.username, state: pilot.relationshipState }, action);
      }
      if (mutationScope.current === guard) setRetry(value => value + 1);
    } catch (error) {
      if (mutationScope.current === guard) setActionError(errorMessage(error));
    } finally { if (mutationScope.current === guard) setWorking(null); }
  };
  const block = (pilot: PilotSearchResult) => {
    const guard = mutationScope.current;
    Alert.alert('Block this pilot?', 'You will not appear in each other’s search results or receive requests from each other. Any existing connection and shared-flight access will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => { if (mutationScope.current === guard && guard.active) void actOnPilot(pilot, 'block'); } },
    ]);
  };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.body}>Find a pilot by name or @username, then send a request. You become friends only after they accept.</Text>
    <Input label="Name or @username" placeholder="Search pilots" value={query} autoCapitalize="none"
      autoComplete="off" maxLength={80} editable={eligible} onChangeText={value => { setQuery(value); setActionError(null); setRequestStatus(null); }} last />
    {!available ? <Notice title="Connect to find pilots">Search needs an internet connection. Your search text stays here while you reconnect.</Notice>
      : !hasUsername ? <View style={styles.section}>
        {friends.loading ? <BusyRow label="Loading your profile…" /> : <>
          <Notice title="Complete your profile">Choose your unique @username before searching or sending new requests. Existing friends and shared flights stay available.</Notice>
          <Button label="Complete profile" onPress={() => router.push('/friends/manage')} />
        </>}
      </View>
      : !enough ? <Notice title="Who are you looking for?">Enter at least 2 characters. Search a name or start with @ to search usernames only.</Notice>
      : queryLength > 60 ? <Notice title="Search text is too long">Use at most 60 characters after the @, if present.</Notice>
      : friends.busy ? <BusyRow label="Updating connection…" />
      : current.kind === 'loading' ? <BusyRow label="Searching pilots…" />
      : current.kind === 'error' ? <View style={styles.section}>
        <Notice tone="danger" title="Could not search pilots">{current.error}</Notice>
        <Button label="Retry search" onPress={() => setRetry(value => value + 1)} />
      </View>
      : current.page?.status === 'rate_limited' ? <View style={styles.section}>
        <Notice title="Please wait before searching again">Too many searches were made. Your search text is kept; try again shortly.</Notice>
        <Button label="Retry search" onPress={() => setRetry(value => value + 1)} />
      </View>
      : current.kind === 'ready' && !current.page?.items.length ? <Notice title="No pilots found">Try another name or @username. Only pilots who show themselves in search appear here.</Notice> : null}
    {actionError ? <Notice tone="danger" title="Could not update this connection">{actionError}</Notice> : null}
    {requestStatus ? <Notice tone={REQUEST_STATUS[requestStatus].success ? 'good' : 'warning'} title={REQUEST_STATUS[requestStatus].title}>{REQUEST_STATUS[requestStatus].message}</Notice> : null}
    {current.page?.items.map(pilot => <Card key={pilot.userId}><View style={styles.card}>
      <View style={styles.row}><Avatar initials={friendInitials(pilot.displayName)} /><View style={styles.rowText}>
        <Text style={styles.name}>{pilot.displayName}</Text><Text style={styles.body}>@{pilot.username}</Text>
      </View></View>
      {working === pilot.userId ? <BusyRow label="Updating connection…" /> : null}
      {pilot.relationshipState === 'none' ? <Button label={`Add friend: ${pilot.displayName}`} disabled={disabled} onPress={() => void actOnPilot(pilot, 'request')} /> : null}
      {pilot.relationshipState === 'outgoing' ? <><Text style={styles.helper}>Request sent</Text>
        <Button label={`Cancel request: ${pilot.displayName}`} disabled={disabled} onPress={() => void actOnPilot(pilot, 'cancel')} /></> : null}
      {pilot.relationshipState === 'incoming' ? <><Text style={styles.helper}>Wants to be your friend</Text>
        <Button label={`Accept: ${pilot.displayName}`} disabled={disabled} onPress={() => void actOnPilot(pilot, 'accept')} />
        <LinkButton label={`Decline: ${pilot.displayName}`} disabled={disabled} onPress={() => void actOnPilot(pilot, 'decline')} /></> : null}
      {pilot.relationshipState === 'accepted' ? <Button label={`View ${pilot.displayName}’s profile`} disabled={disabled}
        onPress={() => router.push({ pathname: '/friends/[id]', params: { id: pilot.userId } })} />
        : <LinkButton label={`Block: ${pilot.displayName}`} disabled={disabled} onPress={() => block(pilot)} />}
    </View></Card>)}
    {current.page?.nextCursor ? <Button label="Load more pilots" busy={loadingMore} disabled={disabled || loadingMore} onPress={() => void loadMore()} /> : null}
  </ScrollView>;
}

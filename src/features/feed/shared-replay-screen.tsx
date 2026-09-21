import { useCallback, useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { BusyRow, Button, Notice, Screen, TopBar } from '@/components/ui';
import { ReplayPlayer } from '@/features/flights/replay/replay-player';
import { useFriends } from '@/features/friends/friends-provider';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { errorMessage } from '@/lib/format/error-message';
import type { SharedReplayArtifactV1 } from '@/social/feed-types';
import { useFeed } from './feed-provider';
import { sharedReplay } from './presentation';
import { feedStyles as styles } from './styles';

export default function SharedReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const friends = useFriends();
  const feed = useFeed();
  const lifecycle = useRecorderLifecycle();
  const back = useCallback(() => { router.dismissTo({ pathname: '/shared-flights/[id]', params: { id } }); }, [id, router]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]));
  const accessible = friends.status === 'ready' && feed.available && feed.identityKey === friends.identityKey;
  return <Screen><Stack.Screen options={{ gestureEnabled: false }} />
    <TopBar title="Shared flight replay" onBack={back} backLabel="Back to shared flight" />
    {!accessible ? <View style={styles.content}><Notice title="Connect to view this replay">Sign in and connect to view flights shared with you.</Notice></View>
      : feed.recorderBusy ? <View style={styles.content}><Notice title="Recording comes first">Finish recording before opening a shared replay.</Notice></View>
      : !lifecycle.ready || lifecycle.recovering ? <View style={styles.content}><BusyRow label="Waiting for recorder recovery…" /></View>
        : !id || typeof id !== 'string' ? <View style={styles.content}><Notice title="Replay unavailable">Open a shared flight from Friends.</Notice></View>
          : focused ? <SharedReplayContent key={`${feed.identityKey}:${feed.revision}:${id}`} activityId={id} onBack={back} /> : null}
  </Screen>;
}

type Read = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'unavailable' } | { kind: 'ready'; artifact: SharedReplayArtifactV1 };
function SharedReplayContent({ activityId, onBack }: { activityId: string; onBack(): void }) {
  const { getDetail, getReplay } = useFeed();
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let current = true;
    setRead({ kind: 'loading' });
    void (async () => {
      try {
        const detail = await getDetail(activityId);
        if (!current) return;
        if (!detail.replayAvailable) { setRead({ kind: 'unavailable' }); return; }
        const artifact = await getReplay(activityId, detail.artifact);
        if (current) setRead({ kind: 'ready', artifact });
      } catch (error) { if (current) setRead({ kind: 'error', message: errorMessage(error) }); }
    })();
    return () => { current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Retry obtains fresh permission and manifest before reading bytes.
  }, [activityId, getDetail, getReplay, retry]));
  if (read.kind === 'loading') return <View style={styles.content}><BusyRow label="Opening shared replay…" /></View>;
  if (read.kind === 'error') return <View style={styles.content}><Notice tone="danger" title="Could not load shared replay">{read.message}</Notice>
    <Button label="Retry shared replay" onPress={() => setRetry(value => value + 1)} /><Button label="Back to shared flight" onPress={onBack} /></View>;
  if (read.kind === 'unavailable') return <View style={styles.content}><Notice title="Replay unavailable">This shared flight does not contain enough usable GPS fixes for replay.</Notice>
    <Button label="Back to shared flight" onPress={onBack} /></View>;
  return <>
    <View style={{ paddingHorizontal: 18, paddingTop: 12 }}><Text style={styles.helper}>{read.artifact.provenance === 'igc'
      ? 'Shared IGC replay · saved time and coordinate precision · ground speed unavailable'
      : 'Shared GPS replay · missing measurements remain unavailable'}</Text></View>
    <ReplayPlayer replay={sharedReplay(activityId, read.artifact)} />
  </>;
}

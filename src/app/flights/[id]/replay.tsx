import { useCallback, useRef } from 'react';
import { BackHandler, View } from 'react-native';
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';

import { BusyRow, Button, Notice, Screen, TopBar } from '@/components/ui';
import { ReplayPlayer } from '@/features/flights/replay/replay-player';
import type { ReplayBookmark } from '@/features/flights/replay/use-replay-playback';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { errorMessage } from '@/lib/format/error-message';
import { REPLAY_UNAVAILABLE } from '@/lib/replay/model';
import { useGetFlightReplayQuery } from '@/store/endpoints';

export default function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const focused = useIsFocused();
  const lifecycle = useRecorderLifecycle();
  const canLoad = id && focused && lifecycle.ready && !lifecycle.recovering;
  const back = useCallback(() => {
    // Also replaces a directly opened replay, so Back always lands on this flight.
    router.dismissTo({ pathname: '/flights/[id]', params: { id } });
  }, [id, router]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [back]));

  return <Screen>
    <Stack.Screen options={{ gestureEnabled: false }} />
    <TopBar onBack={back} backLabel="Back to flight" title="Flight replay" />
    <ReplaySession key={id} id={id} canLoad={Boolean(canLoad)} onBack={back} />
  </Screen>;
}

/** Keyed by flight: retain only a paused bookmark while recovery releases all samples. */
function ReplaySession({ id, canLoad, onBack }: { id: string; canLoad: boolean; onBack: () => void }) {
  const bookmark = useRef<ReplayBookmark | null>(null);
  const readBookmark = useCallback(() => bookmark.current, []);
  const saveBookmark = useCallback((value: ReplayBookmark) => { bookmark.current = value; }, []);
  return canLoad ? <ReplayContent id={id} onBack={onBack} readBookmark={readBookmark} onRelease={saveBookmark} />
    : <BusyRow label="Opening recorded route…" />;
}

/** Unmount the query itself: a skipped RTK hook retains its previous data in a ref. */
function ReplayContent({ id, onBack, readBookmark, onRelease }: {
  id: string;
  onBack: () => void;
  readBookmark: () => ReplayBookmark | null;
  onRelease: (bookmark: ReplayBookmark) => void;
}) {
  const router = useRouter();
  const { currentData: replay, error, isFetching, refetch } = useGetFlightReplayQuery(id);
  return error ? <View className="gap-[12px] p-[18px]">
      <Notice tone="danger" title="Could not load replay">{errorMessage(error)}</Notice>
      <Button label="Try again" onPress={() => void refetch()} />
    </View> : !replay ? <BusyRow label="Opening recorded route…" />
      : replay.kind === 'unavailable' ? <View className="gap-[12px] p-[18px]">
        <Notice tone="info" title="Replay unavailable">{REPLAY_UNAVAILABLE[replay.reason]}</Notice>
        {replay.reason === 'archive_pending' || replay.reason === 'archive_invalid'
          ? <Button label="Open restoration settings" onPress={() => router.push('/account')} /> : null}
        <Button label="Back to flight" onPress={onBack} />
      </View> : isFetching ? <BusyRow label="Refreshing recorded route…" />
        : <ReplayPlayer replay={replay} bookmark={readBookmark()} onRelease={onRelease} />;
}

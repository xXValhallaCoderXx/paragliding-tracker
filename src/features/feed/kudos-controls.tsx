import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Notice } from '@/components/ui';
import { paper } from '@/ui/theme';
import type { KudosSummary } from '@/social/feed-types';
import { useFeed } from './feed-provider';
import { feedStyles as styles } from './styles';
import { FeedIcon } from './feed-icon';
import { feedLayout } from './feed-layout';

export function KudosControls({ activityId, summary: fallback, own }: {
  activityId: string; summary: KudosSummary | null; own: boolean;
}) {
  const feed = useFeed();
  const router = useRouter();
  const request = useRef<Promise<unknown> | null>(null);
  const state = feed.kudosByActivity[activityId];
  const [observed, setObserved] = useState({ activityId, hadEntry: Boolean(state) });
  const hadEntry = observed.activityId === activityId && observed.hadEntry;
  if (observed.activityId !== activityId || (state && !hadEntry)) setObserved({ activityId, hadEntry: Boolean(state) });
  const summary = state ? state.summary : hadEntry ? null : fallback;
  const pending = state?.pending === true;
  const disabled = !feed.available || !summary || pending || feed.recorderBusy;
  const change = () => {
    if (disabled || own || request.current || !summary) return;
    const operation = feed.setKudos(activityId, !summary.givenByMe).catch(() => undefined)
      .finally(() => { if (request.current === operation) request.current = null; });
    request.current = operation;
  };
  return <View style={feedLayout.kudos}>
    <View style={feedLayout.kudosRow}>
      {!own ? <Pressable accessibilityRole="button"
        accessibilityLabel={pending ? summary?.givenByMe ? 'Removing kudos…' : 'Giving kudos…' : summary?.givenByMe ? 'Remove kudos' : 'Give kudos'}
        accessibilityState={{ disabled, busy: pending, selected: summary?.givenByMe === true }} disabled={disabled}
        accessibilityHint="Your display name and initials are visible to everyone who can view this flight."
        onPress={change} style={({ pressed }) => [feedLayout.kudosAction, disabled && feedLayout.disabled, pressed && styles.pressed]}>
        {pending ? <ActivityIndicator color={paper.muted} size="small" /> : <FeedIcon name="heart" selected={summary?.givenByMe} />}
        <Text style={[feedLayout.actionText, summary?.givenByMe && feedLayout.kudosGiven]}>{pending ? 'Updating…' : summary?.givenByMe ? 'Given' : 'Kudos'}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={summary ? `View kudos (${summary.count.toLocaleString()})` : 'View kudos'}
        accessibilityState={{ disabled: !feed.available || !summary }} disabled={!feed.available || !summary} onPress={() => {
          if (feed.available && summary) router.push({ pathname: '/shared-flights/[id]/kudos', params: { id: activityId } });
        }} style={({ pressed }) => [feedLayout.kudosList, (!feed.available || !summary) && feedLayout.disabled, pressed && styles.pressed]}>
        <Text style={feedLayout.actionText}>{summary ? `${summary.count.toLocaleString()} kudos` : 'View kudos'}</Text>
      </Pressable>
    </View>
    {!summary ? <Text style={styles.helper}>Kudos is unavailable right now. Refresh Friends to try again.</Text> : null}
    {!own && feed.recorderBusy ? <Text style={styles.helper}>Finish recording before changing kudos.</Text> : null}
    {!own ? <Text style={feedLayout.audience}>Kudos shows your name and initials to all viewers, including people outside your friends.</Text> : null}
    {state?.error ? <Notice tone="danger" title="Could not update kudos">{state.error}</Notice> : null}
  </View>;
}

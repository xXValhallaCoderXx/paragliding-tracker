import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Notice } from '@/components/ui';
import type { KudosSummary } from '@/social/feed-types';
import { useFeed } from './feed-provider';
import { feedStyles as styles } from './styles';

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
  return <View style={styles.section}>
    <View style={styles.row}>
      {!own ? <View style={styles.grow}><Button
        label={pending ? summary?.givenByMe ? 'Removing kudos…' : 'Giving kudos…' : summary?.givenByMe ? 'Remove kudos' : 'Give kudos'}
        variant={summary?.givenByMe ? 'primary' : 'secondary'} busy={pending} disabled={disabled}
        accessibilityHint="Your display name and initials are visible to everyone who can view this flight."
        onPress={change} /></View> : null}
      <View style={styles.grow}><Button label={summary ? `View kudos (${summary.count.toLocaleString()})` : 'View kudos'}
        disabled={!feed.available || !summary} onPress={() => {
          if (feed.available && summary) router.push({ pathname: '/shared-flights/[id]/kudos', params: { id: activityId } });
        }} /></View>
    </View>
    {!summary ? <Text style={styles.helper}>Kudos is unavailable right now. Refresh Friends to try again.</Text> : null}
    {!own && feed.recorderBusy ? <Text style={styles.helper}>Finish recording before changing kudos.</Text> : null}
    {!own ? <Text style={styles.helper}>Giving kudos shows your display name and initials to everyone who can view this flight, including people outside your friends.</Text> : null}
    {state?.error ? <Notice tone="danger" title="Could not update kudos">{state.error}</Notice> : null}
  </View>;
}

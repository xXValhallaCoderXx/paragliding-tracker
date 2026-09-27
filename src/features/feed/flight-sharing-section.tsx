import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Button, Card, LinkButton, Notice, SectionLabel } from '@/components/ui';
import { TrackPlate } from '@/features/flights/components/track-plate';
import { useFriends } from '@/features/friends/friends-provider';
import { formatAirtimeShort, formatDistance, formatLongDate } from '@/lib/format/flight-format';
import type { TrackSegments } from '@/lib/track/types';
import { useFlightPublication } from './use-flight-publication';
import { SharingConsent } from './sharing-consent';
import { SharingSheet } from './sharing-sheet';
import { useSharingAction } from './use-sharing-action';
import { feedStyles as styles } from './styles';

/** Display-only selection context. Private journal and export fields never enter the sheet. */
export interface ShareFlightPreview {
  title: string | null;
  site: string | null;
  startedAt: number;
  timezoneOffsetMinutes: number | null;
  durationMs: number;
  distanceMetres: number | null;
  routePreview: TrackSegments;
}

export function FlightSharingSection({ flightId, preview }: { flightId: string; preview: ShareFlightPreview }) {
  const friends = useFriends();
  const router = useRouter();
  return <View style={styles.detailSection}><SectionLabel>Share with friends</SectionLabel>
    {friends.status !== 'ready' ? <>
      <Text style={styles.body}>Sign in to share this flight with accepted friends. Your private notes and original files stay private.</Text>
      <Button label="Open Pilot to share" onPress={() => router.push('/account')} />
    </> : friends.available && !friends.profile ? <>
        <Text style={styles.body}>Choose the name friends see before sharing a flight.</Text>
        <Button label="Set up your Friends profile" onPress={() => router.push('/friends/manage')} />
      </> : <PublicationControls key={`${friends.identityKey}:${flightId}`} flightId={flightId} preview={preview} />}
  </View>;
}

function PublicationControls({ flightId, preview }: { flightId: string; preview: ShareFlightPreview }) {
  const publication = useFlightPublication(flightId);
  const router = useRouter();
  const [confirming, setConfirming] = useState<'share' | 'hide' | null>(null);
  const action = useSharingAction();
  const close = useCallback(() => setConfirming(null), []);
  useFocusEffect(useCallback(() => () => close(), [close]));
  const disabled = publication.busy || !publication.available || action.pending;
  const onlineDisabled = disabled || !publication.online;
  const run = async (operation: () => Promise<void>) => {
    if (disabled) return;
    await action.run(operation, close);
  };
  const canConfirmShare = publication.available && publication.online && !publication.pendingHide
    && (action.pending || publication.state === 'private' || publication.state === 'hidden' || publication.state === 'error');
  return <Card><View style={styles.card}>
    <Text style={styles.name}>{publication.busy ? 'Updating sharing…' : publication.pendingHide ? 'Waiting to hide from friends' : {
      private: 'Private flight', pending: 'Waiting to share', shared: 'Shared with friends', hidden: 'Hidden from friends', error: 'Sharing needs attention',
    }[publication.state]}</Text>
    {confirming !== 'share' && (action.error || publication.error) ? <Notice tone="danger" title="Could not update sharing">{action.error ?? publication.error}</Notice> : null}
    {!publication.online ? <Notice title="You are offline">You can queue Hide from friends now. It takes effect for friends when the server confirms it after you reconnect.</Notice> : null}
    {publication.pendingHide ? <Notice title="Hide awaiting confirmation">The hide request is saved on this phone. Friends may still see this flight until the server confirms it. Reconnect to finish hiding it.</Notice> : null}
    {publication.state === 'pending' && !publication.pendingHide ? <Text style={styles.helper}>This flight will appear after its backup and shared replay are ready. Sharing waits while recording is active.</Text> : null}
    {publication.state === 'hidden' && !publication.pendingHide ? <Text style={styles.helper}>This flight stays hidden even if automatic sharing is on. Only sharing it again makes it visible.</Text> : null}
    {publication.state === 'shared' && !publication.pendingHide ? <Text style={styles.helper}>Current accepted friends can view the full route and replay. Title and site changes appear after backup sync.</Text> : null}
    {confirming === 'hide' ? <>
      <Text style={styles.body}>Remove this flight from the feed and stop pending publication. Your private flight stays in your logbook. It remains hidden until you explicitly share it again.</Text>
      <Button label="Hide this flight" variant="danger" disabled={disabled} onPress={() => void run(publication.hide)} />
      <LinkButton label="Keep sharing status" disabled={disabled} onPress={close} />
    </> : publication.pendingHide ? <>
      <Button label="Retry hide" disabled={onlineDisabled} onPress={() => void run(publication.retry)} />
      <LinkButton label="Refresh sharing status" disabled={onlineDisabled} onPress={() => void run(publication.refresh)} />
    </> : <>
      {publication.state === 'private' || publication.state === 'hidden' ? <Button label={publication.state === 'hidden' ? 'Share again…' : 'Share flight…'}
        disabled={onlineDisabled} onPress={() => { action.clearError(); setConfirming('share'); }} /> : null}
      {publication.state === 'error' ? <Button label="Retry sharing" disabled={onlineDisabled} onPress={() => void run(publication.retry)} /> : null}
      {publication.state === 'shared' && publication.activityId ? <Button label="Preview shared flight" disabled={onlineDisabled}
        onPress={() => router.push({ pathname: '/shared-flights/[id]', params: { id: publication.activityId! } })} /> : null}
      {publication.state === 'pending' || publication.state === 'shared' || publication.state === 'error' ? <LinkButton label="Hide from friends…"
        disabled={disabled} onPress={() => { action.clearError(); setConfirming('hide'); }} /> : null}
      <LinkButton label="Refresh sharing status" disabled={onlineDisabled} onPress={() => void run(publication.refresh)} />
    </>}
    {confirming === 'share' && canConfirmShare ? <SharingSheet title="Share this flight"
      busy={action.pending || publication.busy} onClose={close}>
      <Card><View style={[styles.card, styles.row]}>
        {preview.routePreview.length ? <View style={local.thumbnail}><TrackPlate segments={preview.routePreview} variant="thumbnail" state="ready" /></View> : null}
        <View style={[styles.grow, local.summary]}>
          <Text style={styles.name}>{preview.title?.trim() || preview.site?.trim() || 'A day in the sky'}</Text>
          <Text style={styles.date}>{formatLongDate(preview.startedAt, preview.timezoneOffsetMinutes)}</Text>
          <Text style={styles.metrics}>{formatAirtimeShort(preview.durationMs)} · {formatDistance(preview.distanceMetres)}</Text>
        </View>
      </View></Card>
      <SharingConsent />
      {action.error || publication.error ? <Notice tone="danger" title="Could not update sharing">{action.error ?? publication.error}</Notice> : null}
      <Button label="Share this flight with friends" variant="primary" size="lg" busy={action.pending} disabled={onlineDisabled}
        onPress={() => { if (canConfirmShare) void run(publication.share); }} />
      <LinkButton label="Not now" disabled={disabled} onPress={close} className="items-center" />
    </SharingSheet> : null}
  </View></Card>;
}

const local = StyleSheet.create({
  thumbnail: { width: 56 },
  summary: { gap: 5 },
});

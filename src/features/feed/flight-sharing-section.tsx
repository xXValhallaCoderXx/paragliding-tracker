import { useCallback, useRef, useState, type ReactNode } from 'react';
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

export interface FlightSharingEntry { label: string; reason: string | null; onPress: () => void }
interface SharingEntries {
  extraActions?: (entry: FlightSharingEntry) => ReactNode;
  beforeOpen?: (proceed: () => void) => void;
  blocked?: boolean;
  runExclusive?: (action: () => Promise<void>) => Promise<void>;
}
export function FlightSharingSection({ flightId, preview, ...entries }: { flightId: string; preview: ShareFlightPreview } & SharingEntries) {
  const friends = useFriends();
  const router = useRouter();
  const open = (proceed: () => void) => { if (!entries.blocked) { if (entries.beforeOpen) entries.beforeOpen(proceed); else proceed(); } };
  return <View style={styles.detailSection}><SectionLabel>Share with friends</SectionLabel>
    {friends.status !== 'ready' ? <>
      <Text style={styles.body}>Sign in to share this flight with accepted friends. Your private notes and original files stay private.</Text>
      <Button label="Open Pilot to share" disabled={entries.blocked} onPress={() => open(() => router.push('/account'))} />
      {entries.extraActions?.({ label: 'Share with friends', reason: entries.blocked ? 'Another action is finishing.' : null, onPress: () => open(() => router.push('/account')) })}
    </> : friends.available && !friends.profile ? <>
        <Text style={styles.body}>Choose the name friends see before sharing a flight.</Text>
        <Button label="Set up your Friends profile" disabled={entries.blocked} onPress={() => open(() => router.push('/friends/manage'))} />
        {entries.extraActions?.({ label: 'Share with friends', reason: entries.blocked ? 'Another action is finishing.' : null, onPress: () => open(() => router.push('/friends/manage')) })}
      </> : <PublicationControls key={`${friends.identityKey}:${flightId}`} flightId={flightId} preview={preview} {...entries} />}
  </View>;
}

function PublicationControls({ flightId, preview, extraActions, beforeOpen, blocked, runExclusive }: { flightId: string; preview: ShareFlightPreview } & SharingEntries) {
  const publication = useFlightPublication(flightId);
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<{ kind: 'share' | 'hide'; visit: number } | null>(null);
  const confirming = confirmation?.kind ?? null;
  const visit = useRef(0);
  const action = useSharingAction();
  const close = useCallback(() => { visit.current += 1; setConfirmation(null); }, []);
  useFocusEffect(useCallback(() => () => close(), [close]));
  const disabled = publication.busy || !publication.available || action.pending || Boolean(blocked);
  const onlineDisabled = disabled || !publication.online;
  const run = async (operation: () => Promise<void>, needsConfirmation = false) => {
    if (disabled || (needsConfirmation && (!confirmation || confirmation.visit !== visit.current))) return;
    await action.run(() => runExclusive ? runExclusive(operation) : operation(), close);
  };
  const open = (kind: 'share' | 'hide') => {
    if (disabled) return;
    const proceed = () => { action.clearError(); visit.current += 1; setConfirmation({ kind, visit: visit.current }); };
    if (beforeOpen) beforeOpen(proceed); else proceed();
  };
  const hideAction = publication.pendingHide || ['shared', 'pending', 'error'].includes(publication.state);
  const canConfirmShare = publication.available && publication.online && !publication.pendingHide
    && (action.pending || publication.state === 'private' || publication.state === 'hidden' || publication.state === 'error');
  return <><Card><View style={styles.card}>
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
      <Button label="Hide this flight" variant="danger" disabled={disabled} onPress={() => void run(publication.hide, true)} />
      <LinkButton label="Keep sharing status" disabled={disabled} onPress={close} />
    </> : publication.pendingHide ? <>
      <Button label="Retry hide" disabled={onlineDisabled} onPress={() => void run(publication.retry)} />
      <LinkButton label="Refresh sharing status" disabled={onlineDisabled} onPress={() => void run(publication.refresh)} />
    </> : <>
      {publication.state === 'private' || publication.state === 'hidden' ? <Button label={publication.state === 'hidden' ? 'Share again…' : 'Share flight…'}
        disabled={onlineDisabled} onPress={() => open('share')} /> : null}
      {publication.state === 'error' ? <Button label="Retry sharing" disabled={onlineDisabled} onPress={() => void run(publication.retry)} /> : null}
      {publication.state === 'shared' && publication.activityId ? <Button label="Preview shared flight" disabled={onlineDisabled}
        onPress={() => router.push({ pathname: '/shared-flights/[id]', params: { id: publication.activityId! } })} /> : null}
      {publication.state === 'pending' || publication.state === 'shared' || publication.state === 'error' ? <LinkButton label="Hide from friends…"
        disabled={disabled} onPress={() => open('hide')} /> : null}
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
        onPress={() => { if (canConfirmShare) void run(publication.share, true); }} />
      <LinkButton label="Not now" disabled={disabled} onPress={close} className="items-center" />
    </SharingSheet> : null}
  </View></Card>{extraActions ? <ExtraActions render={extraActions} entry={{
    label: publication.pendingHide ? 'Hide awaiting confirmation' : hideAction ? 'Hide from friends…' : 'Share with friends…',
    reason: disabled ? 'Checking or updating sharing. Please wait.' : publication.pendingHide ? 'Friends may still see this flight until the server confirms Hide.'
      : !hideAction && !publication.online ? 'Connect to check sharing and share this flight.' : null,
    onPress: () => open(hideAction ? 'hide' : 'share'),
  }} /> : null}</>;
}

function ExtraActions({ render, entry }: { render: (entry: FlightSharingEntry) => ReactNode; entry: FlightSharingEntry }) {
  return render(entry);
}

const local = StyleSheet.create({
  thumbnail: { width: 56 },
  summary: { gap: 5 },
});

import { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, LinkButton, Notice, SectionLabel } from '@/components/ui';
import { useFriends } from '@/features/friends/friends-provider';
import { errorMessage } from '@/lib/format/error-message';
import { useFlightPublication } from './use-flight-publication';
import { SharingConsent } from './sharing-consent';
import { feedStyles as styles } from './styles';

export function FlightSharingSection({ flightId }: { flightId: string }) {
  const friends = useFriends();
  const router = useRouter();
  return <View style={styles.detailSection}><SectionLabel>Share with friends</SectionLabel>
    {friends.status !== 'ready' ? <>
      <Text style={styles.body}>Sign in to share this flight with accepted friends. Your private notes and original files stay private.</Text>
      <Button label="Open Account to share" onPress={() => router.push('/account')} />
    </> : friends.available && !friends.profile ? <>
        <Text style={styles.body}>Choose the name friends see before sharing a flight.</Text>
        <Button label="Set up your Friends profile" onPress={() => router.push('/friends/manage')} />
      </> : <PublicationControls key={`${friends.identityKey}:${flightId}`} flightId={flightId} />}
  </View>;
}

function PublicationControls({ flightId }: { flightId: string }) {
  const publication = useFlightPublication(flightId);
  const router = useRouter();
  const [confirming, setConfirming] = useState<'share' | 'hide' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = publication.busy || !publication.available;
  const onlineDisabled = disabled || !publication.online;
  const run = async (action: () => Promise<void>) => {
    if (disabled) return;
    setError(null);
    try { await action(); setConfirming(null); }
    catch (problem) { setError(errorMessage(problem)); }
  };
  return <Card><View style={styles.card}>
    <Text style={styles.name}>{publication.busy ? 'Updating sharing…' : publication.pendingHide ? 'Waiting to hide from friends' : {
      private: 'Private flight', pending: 'Waiting to share', shared: 'Shared with friends', hidden: 'Hidden from friends', error: 'Sharing needs attention',
    }[publication.state]}</Text>
    {error || publication.error ? <Notice tone="danger" title="Could not update sharing">{error ?? publication.error}</Notice> : null}
    {!publication.online ? <Notice title="You are offline">You can queue Hide from friends now. It takes effect for friends when the server confirms it after you reconnect.</Notice> : null}
    {publication.pendingHide ? <Notice title="Hide awaiting confirmation">The hide request is saved on this phone. Friends may still see this flight until the server confirms it. Reconnect to finish hiding it.</Notice> : null}
    {publication.state === 'pending' && !publication.pendingHide ? <Text style={styles.helper}>This flight will appear after its backup and shared replay are ready. Sharing waits while recording is active.</Text> : null}
    {publication.state === 'hidden' && !publication.pendingHide ? <Text style={styles.helper}>This flight stays hidden even if automatic sharing is on. Only sharing it again makes it visible.</Text> : null}
    {publication.state === 'shared' && !publication.pendingHide ? <Text style={styles.helper}>Current accepted friends can view the full route and replay. Title and site changes appear after backup sync.</Text> : null}
    {confirming === 'share' ? <>
      <SharingConsent />
      <Button label="Share this flight with friends" variant="primary" disabled={onlineDisabled} onPress={() => void run(publication.share)} />
      <LinkButton label="Cancel sharing" disabled={publication.busy} onPress={() => setConfirming(null)} />
    </> : confirming === 'hide' ? <>
      <Text style={styles.body}>Remove this flight from the feed and stop pending publication. Your private flight stays in your logbook. It remains hidden until you explicitly share it again.</Text>
      <Button label="Hide this flight" variant="danger" disabled={disabled} onPress={() => void run(publication.hide)} />
      <LinkButton label="Keep sharing status" disabled={publication.busy} onPress={() => setConfirming(null)} />
    </> : publication.pendingHide ? <>
      <Button label="Retry hide" disabled={onlineDisabled} onPress={() => void run(publication.retry)} />
      <LinkButton label="Refresh sharing status" disabled={onlineDisabled} onPress={() => void run(publication.refresh)} />
    </> : <>
      {publication.state === 'private' || publication.state === 'hidden' ? <Button label={publication.state === 'hidden' ? 'Share again…' : 'Share flight…'}
        disabled={onlineDisabled} onPress={() => setConfirming('share')} /> : null}
      {publication.state === 'error' ? <Button label="Retry sharing" disabled={onlineDisabled} onPress={() => void run(publication.retry)} /> : null}
      {publication.state === 'shared' && publication.activityId ? <Button label="Preview shared flight" disabled={onlineDisabled}
        onPress={() => router.push({ pathname: '/shared-flights/[id]', params: { id: publication.activityId! } })} /> : null}
      {publication.state === 'pending' || publication.state === 'shared' || publication.state === 'error' ? <LinkButton label="Hide from friends…"
        disabled={disabled} onPress={() => setConfirming('hide')} /> : null}
      <LinkButton label="Refresh sharing status" disabled={onlineDisabled} onPress={() => void run(publication.refresh)} />
    </>}
  </View></Card>;
}

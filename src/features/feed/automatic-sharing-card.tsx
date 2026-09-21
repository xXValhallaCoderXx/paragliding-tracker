import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, LinkButton, Notice, SectionLabel } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import { useFeed } from './feed-provider';
import { SharingConsent } from './sharing-consent';
import { feedStyles as styles } from './styles';

export function AutomaticSharingCard() {
  const feed = useFeed();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !feed.available || feed.busy || feed.preferences === null;
  const enabled = feed.preferences?.enabled === true;
  const save = async (next: boolean) => {
    if (disabled) return;
    setError(null);
    try { await feed.setAutoShare(next); setConfirming(false); }
    catch (problem) { setError(errorMessage(problem)); }
  };
  return <Card><View style={styles.card}>
    <SectionLabel>Your flight sharing</SectionLabel>
    <Text style={styles.name}>{feed.preferences === null ? 'Loading your sharing preference…' : enabled ? 'Future flights are shared' : 'Future flights are private'}</Text>
    {error ? <Notice tone="danger" title="Sharing preference unchanged">{error}</Notice> : null}
    {confirming ? <>
      <SharingConsent automatic />
      <Button label="Turn on automatic sharing" variant="primary" disabled={disabled} onPress={() => void save(true)} />
      <LinkButton label="Keep future flights private" disabled={feed.busy} onPress={() => setConfirming(false)} />
    </> : <>
      <Text style={styles.helper}>{enabled ? 'New recordings are posted after saving and syncing. Turning this off leaves existing posts visible; you can hide each flight from its details.'
        : 'You choose whether to share new recordings automatically. You can also share an older flight from your logbook.'}</Text>
      <Button label={enabled ? 'Stop sharing future flights' : 'Choose automatic sharing'} disabled={disabled}
        onPress={() => enabled ? void save(false) : setConfirming(true)} />
    </>}
  </View></Card>;
}

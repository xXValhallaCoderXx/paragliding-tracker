import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, LinkButton, Notice } from '@/components/ui';
import { paper, radii } from '@/ui/theme';
import { useFeed } from './feed-provider';
import { SharingConsent } from './sharing-consent';
import { SharingSheet } from './sharing-sheet';
import { useSharingAction } from './use-sharing-action';
import { feedStyles as styles } from './styles';

export function AutomaticSharingCard() {
  const feed = useFeed();
  return <SharingPreference key={feed.identityKey} />;
}

function SharingPreference() {
  const feed = useFeed();
  const [open, setOpen] = useState(false);
  const action = useSharingAction();
  const close = useCallback(() => setOpen(false), []);
  const disabled = !feed.available || feed.busy || feed.preferences === null || action.pending;
  const enabled = feed.preferences?.enabled === true;
  const save = (next: boolean) => {
    if (!disabled) void action.run(() => feed.setAutoShare(next), close);
  };
  return <>
    <View style={local.status}>
      <View style={[local.dot, { backgroundColor: enabled ? paper.thermal : paper.muted }]} />
      <Text style={[styles.body, styles.grow]}>{feed.preferences === null
        ? feed.loading ? 'Loading sharing preference…' : 'Sharing preference unavailable'
        : enabled ? 'New flights go to your friends' : 'New flights stay private'}</Text>
      <LinkButton label="Change" disabled={disabled} onPress={() => { action.clearError(); setOpen(true); }} />
    </View>
    {open && feed.available && feed.preferences !== null ? <SharingSheet title="Future flight sharing"
      busy={action.pending || feed.busy} onClose={close}>
      <Text style={styles.name}>{enabled ? 'Automatic sharing is on' : 'Automatic sharing is off'}</Text>
      <SharingConsent automatic />
      {action.error ? <Notice tone="danger" title="Sharing preference unchanged">{action.error}</Notice> : null}
      <Button label={enabled ? 'Stop sharing future flights' : 'Turn on automatic sharing'}
        variant={enabled ? 'secondary' : 'primary'} size="lg" busy={action.pending} disabled={disabled}
        onPress={() => save(!enabled)} />
      <LinkButton label="Not now" disabled={action.pending || feed.busy} onPress={close} className="items-center" />
    </SharingSheet> : null}
  </>;
}

const local = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: paper.cardAlt,
    borderRadius: radii.control, paddingHorizontal: 14, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: radii.pill },
});

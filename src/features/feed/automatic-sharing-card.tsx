import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, LinkButton, Notice } from '@/components/ui';
import { paper, radii } from '@/ui/theme';
import { flightScopeRevision, subscribeFlightScope } from '@/lib/flight-scope';
import { useFeed } from './feed-provider';
import { SharingConsent } from './sharing-consent';
import { SharingSheet } from './sharing-sheet';
import { useSharingAction } from './use-sharing-action';
import { feedStyles as styles } from './styles';

export function AutomaticSharingCard() {
  const feed = useFeed();
  const revision = useSyncExternalStore(subscribeFlightScope, flightScopeRevision, flightScopeRevision);
  return <SharingPreference key={`${feed.identityKey}:${revision}`} />;
}

function SharingPreference() {
  const feed = useFeed();
  const [confirmation, setConfirmation] = useState<{ visit: number; enabled: boolean; generation: string | null } | null>(null);
  const visit = useRef(0);
  const action = useSharingAction();
  const { invalidate, clearError } = action;
  useEffect(() => { clearError(); }, [clearError, feed.preferences]);
  const close = useCallback(() => { visit.current += 1; invalidate(); setConfirmation(null); }, [invalidate]);
  const disabled = !feed.available || feed.busy || feed.preferences === null || action.pending;
  const enabled = feed.preferences?.enabled === true;
  const save = (next: boolean) => {
    if (!disabled && confirmation && confirmation.visit === visit.current) void action.run(() => feed.setAutoShare(next), close);
  };
  return <>
    <View style={local.status}>
      <View style={[local.dot, { backgroundColor: enabled ? paper.thermal : paper.muted }]} />
      <Text style={[styles.body, styles.grow]}>{action.error ? 'Sharing preference not confirmed' : feed.busy || action.pending ? 'Updating sharing preference…' : feed.preferences === null
        ? feed.loading ? 'Loading sharing preference…' : 'Sharing preference unavailable'
        : enabled ? 'Automatic sharing on' : 'Automatic sharing off'}</Text>
      <LinkButton label="Change" disabled={disabled} onPress={() => {
        if (disabled || !feed.preferences) return;
        visit.current += 1;
        setConfirmation({ visit: visit.current, enabled, generation: feed.preferences.generation });
      }} />
    </View>
    {confirmation && feed.available && feed.preferences !== null && confirmation.enabled === enabled
      && confirmation.generation === feed.preferences.generation ? <SharingSheet title="Future flight sharing"
      busy={action.pending || feed.busy} onClose={close}>
      <Text style={styles.name}>{action.error ? 'The change has not been confirmed' : enabled ? 'Automatic sharing is on' : 'Automatic sharing is off'}</Text>
      <SharingConsent automatic />
      {action.error ? <Notice tone="danger" title="Sharing preference not confirmed">{action.error}</Notice> : null}
      <Button label={enabled ? 'Stop sharing future flights' : 'Turn on automatic sharing'}
        variant={enabled ? 'secondary' : 'primary'} size="lg" busy={action.pending} disabled={disabled}
        onPress={() => save(!enabled)} />
      <LinkButton label="Not now" disabled={action.pending || feed.busy} onPress={close} className="items-center" />
    </SharingSheet> : null}
  </>;
}

const local = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, backgroundColor: paper.cardAlt,
    borderRadius: radii.control, paddingHorizontal: 14, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: radii.pill },
});

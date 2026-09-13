import { Alert } from 'react-native';

import { Button, Card, ListRow } from '@/components/ui';

/** The signed-in identity, and the way back out of it. */
export function AccountCard({
  email,
  busy,
  disabled = false,
  onSignOut,
}: {
  email: string | null;
  busy: boolean;
  disabled?: boolean;
  onSignOut: () => void;
}) {
  const confirmSignOut = () => {
    Alert.alert(
      'Log out?',
      'Your flights stay on this phone. Backup pauses until you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: onSignOut },
      ],
    );
  };

  // The email goes in `detail` rather than `value` so a long address wraps across the
  // full width instead of being squeezed into the right-hand column.
  return (
    <Card className="px-[16px] pt-[4px] pb-[16px]">
      <ListRow
        label="Account"
        value="Signed in"
        tone="good"
        showDot
        detail={email ?? 'Unknown account'}
        last
      />
      <Button
        label={busy ? 'Logging out…' : 'Log out'}
        onPress={confirmSignOut}
        variant="secondary"
        busy={busy}
        disabled={disabled || busy}
      />
    </Card>
  );
}

/** Placeholder used while a stored session is being read off disk. */
export function RestoringAccountCard() {
  return (
    <Card className="px-[16px] py-[4px]">
      <ListRow label="Account" value="Checking…" last />
    </Card>
  );
}

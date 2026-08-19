import { Alert } from 'react-native';

import { Card, ListRow } from '@/components/ui';

/** The signed-in identity, and the way back out of it. */
export function AccountCard({
  email,
  busy,
  onSignOut,
}: {
  email: string | null;
  busy: boolean;
  onSignOut: () => void;
}) {
  const confirmSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Your flights stay on this phone. Backup pauses until you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: onSignOut },
      ],
    );
  };

  // The email goes in `detail` rather than `value` so a long address wraps across the
  // full width instead of being squeezed into the right-hand column.
  return (
    <Card className="px-[16px] py-[4px]">
      <ListRow
        label="Backed up to"
        value="Active"
        tone="good"
        showDot
        detail={email ?? 'Unknown account'}
        action={{ label: busy ? 'Signing out…' : 'Sign out', onPress: confirmSignOut }}
        last
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

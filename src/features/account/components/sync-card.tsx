import { Button, Card, ListRow, Notice } from '@/components/ui';

import type { SyncStatusView } from '../account-presentation';

/** Backup state, and the manual escape hatch when a pilot wants it to happen now. */
export function SyncCard({
  status,
  onSyncNow,
  cloudOnly,
  onUseThisAccount,
}: {
  status: SyncStatusView;
  onSyncNow: () => void;
  cloudOnly: string | null;
  /** Offered only on an account mismatch; rebinds the device without touching local data. */
  onUseThisAccount?: (() => void) | null;
}) {
  return (
    <>
      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Last backup"
          value={status.label}
          tone={status.tone}
          showDot={status.tone !== 'neutral'}
          detail={status.detail}
          action={status.canSyncNow ? { label: 'Sync now', onPress: onSyncNow } : null}
          last
        />
      </Card>
      {onUseThisAccount ? (
        <>
          <Notice tone="warning" title="Backup linked to a different account">
            Your local flights stay on this phone. Switching accounts queues eligible flights
            for upload to the account you are signed in to now, and leaves old cloud copies alone.
          </Notice>
          <Button
            label="Back up to this account instead"
            variant="secondary"
            onPress={onUseThisAccount}
          />
        </>
      ) : null}
      {cloudOnly ? <Notice tone="info">{cloudOnly}</Notice> : null}
    </>
  );
}

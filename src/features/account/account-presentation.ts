import type { SyncSnapshot } from '@/cloud/types';
import type { Tone } from '@/ui/theme';
// ---------------------------------------------------------------------------
// Backup status
// ---------------------------------------------------------------------------

export interface SyncStatusView {
  label: string;
  tone: Tone;
  detail: string;
  /** Whether a "Sync now" action is worth offering. */
  canSyncNow: boolean;
}

function pendingDetail(snapshot: SyncSnapshot): string {
  const total = snapshot.pendingFlights + snapshot.pendingDeletions;
  if (total === 0) return snapshot.lastSyncAt === null
    ? 'Backup has not completed a sync yet.'
    : 'No eligible flights or deletions are waiting to sync. Raw sensor samples stay on this phone.';
  if (snapshot.pendingFlights === 0) {
    return total === 1 ? '1 deletion still to send.' : `${total} deletions still to send.`;
  }
  const flights =
    snapshot.pendingFlights === 1 ? '1 flight' : `${snapshot.pendingFlights} flights`;
  return `${flights} still to back up.`;
}

/**
 * Turns a sync snapshot into the one line the account screen shows.
 *
 * Every blocked reason gets its own sentence: "nothing happened" is only reassuring if
 * the pilot can tell *why*, and a few of these ('recording', 'account_mismatch') are
 * states they need to understand rather than errors to hide.
 */
export function describeSync(snapshot: SyncSnapshot, now: number): SyncStatusView {
  if (snapshot.phase === 'syncing') {
    return { label: 'Backing up…', tone: 'neutral', detail: pendingDetail(snapshot), canSyncNow: false };
  }

  if (snapshot.phase === 'blocked') {
    switch (snapshot.blockedBy) {
      case 'recording':
        return {
          label: 'Paused',
          tone: 'neutral',
          detail: 'Backup waits until the flight is finished. Recording always comes first.',
          canSyncNow: false,
        };
      case 'recovering':
        return {
          label: 'Paused',
          tone: 'neutral',
          detail: 'Waiting for the recorder to finish checking the last flight.',
          canSyncNow: false,
        };
      case 'account_mismatch':
        return {
          label: 'Different account',
          tone: 'warning',
          detail: "This phone's logbook is linked to another account.",
          canSyncNow: false,
        };
      case 'signed_out':
        return {
          label: 'Not backed up',
          tone: 'neutral',
          detail: 'Sign in to back up your logbook.',
          canSyncNow: false,
        };
      case 'backoff':
      case 'throttled':
        return { label: 'Waiting', tone: 'neutral', detail: pendingDetail(snapshot), canSyncNow: true };
      default:
        return {
          label: 'Unavailable',
          tone: 'neutral',
          detail: 'Backup is not available in this build.',
          canSyncNow: false,
        };
    }
  }

  if (snapshot.phase === 'error') {
    return {
      label: 'Could not back up',
      tone: 'danger',
      detail: snapshot.lastError ?? 'Try again when you have signal.',
      canSyncNow: true,
    };
  }

  if (snapshot.lastSyncAt === null) {
    return { label: 'Never', tone: 'neutral', detail: pendingDetail(snapshot), canSyncNow: true };
  }

  const pending = snapshot.pendingFlights + snapshot.pendingDeletions;
  return {
    label: relativeSyncTime(snapshot.lastSyncAt, now),
    tone: pending === 0 ? 'good' : 'neutral',
    detail: pendingDetail(snapshot),
    canSyncNow: true,
  };
}

/** Coarse on purpose: an exact timestamp invites a precision this feature does not have. */
export function relativeSyncTime(lastSyncAt: number, now: number): string {
  const elapsed = Math.max(0, now - lastSyncAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

/** Cloud-only flights are counted, never downloaded — this is how we say so. */
export function cloudOnlySummary(snapshot: SyncSnapshot): string | null {
  if (snapshot.cloudOnlyFlights <= 0) return null;
  const flights =
    snapshot.cloudOnlyFlights === 1 ? '1 flight' : `${snapshot.cloudOnlyFlights} flights`;
  return `${flights} in your account were recorded on another phone. They stay in the cloud — this app does not download flights.`;
}

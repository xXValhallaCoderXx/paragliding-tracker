import type { SyncSnapshot } from '@/cloud/types';

import {
  cloudOnlySummary,
  describeSync,
  relativeSyncTime,
} from '../account-presentation';

const IDLE: SyncSnapshot = {
  phase: 'idle',
  blockedBy: null,
  lastSyncAt: null,
  pendingFlights: 0,
  pendingDeletions: 0,
  cloudOnlyFlights: 0,
  linkedUserId: null,
  lastError: null,
};

const NOW = 1_760_000_000_000;

describe('backup status', () => {
  it('explains a pause during recording rather than looking broken', () => {
    // A pilot who opens the account screen mid-flight must see a reason, not silence.
    expect(describeSync({ ...IDLE, phase: 'blocked', blockedBy: 'recording' }, NOW)).toMatchObject({
      label: 'Paused',
      tone: 'neutral',
      canSyncNow: false,
    });
    expect(describeSync({ ...IDLE, phase: 'blocked', blockedBy: 'recording' }, NOW).detail).toMatch(
      /Recording always comes first/,
    );
  });

  it('flags an account mismatch as a warning with no sync action', () => {
    const view = describeSync({ ...IDLE, phase: 'blocked', blockedBy: 'account_mismatch' }, NOW);
    expect(view).toMatchObject({ label: 'Different account', tone: 'warning', canSyncNow: false });
  });

  it('offers a retry after an error and surfaces the reason', () => {
    const view = describeSync(
      { ...IDLE, phase: 'error', lastError: 'Network request failed' },
      NOW,
    );
    expect(view).toMatchObject({ tone: 'danger', canSyncNow: true, detail: 'Network request failed' });
  });

  it('goes good only when there is genuinely nothing left to send', () => {
    expect(describeSync({ ...IDLE, lastSyncAt: NOW - 30_000 }, NOW).tone).toBe('good');
    expect(describeSync({ ...IDLE, lastSyncAt: NOW - 30_000, pendingFlights: 2 }, NOW).tone).toBe(
      'neutral',
    );
    expect(describeSync({ ...IDLE, lastSyncAt: NOW - 30_000, pendingDeletions: 1 }, NOW).tone).toBe(
      'neutral',
    );
  });

  it('keeps the failure visible while automatic retries are delayed', () => {
    expect(describeSync({ ...IDLE, phase: 'blocked', blockedBy: 'backoff', lastError: 'Account service unavailable' }, NOW)).toMatchObject({
      label: 'Could not back up', tone: 'danger', detail: 'Account service unavailable', canSyncNow: true,
    });
  });

  it('keeps the completed backup status when an automatic check is throttled', () => {
    expect(describeSync({ ...IDLE, phase: 'blocked', blockedBy: 'throttled', lastSyncAt: NOW - 10_000 }, NOW)).toMatchObject({
      label: 'Just now', tone: 'good', canSyncNow: true,
    });
  });

  it('counts pending work in words a pilot can act on', () => {
    expect(describeSync({ ...IDLE, lastSyncAt: NOW, pendingFlights: 1 }, NOW).detail).toBe(
      '1 flight still to back up.',
    );
    expect(describeSync({ ...IDLE, lastSyncAt: NOW, pendingFlights: 3 }, NOW).detail).toBe(
      '3 flights still to back up.',
    );
    expect(describeSync({ ...IDLE, lastSyncAt: NOW, pendingDeletions: 1 }, NOW).detail).toBe(
      '1 deletion still to send.',
    );
    expect(describeSync({ ...IDLE, lastSyncAt: NOW }, NOW).detail).toBe(
      'No eligible flights or deletions are waiting to sync. Raw sensor samples stay on this phone.',
    );
  });

  it('says Never rather than an empty value before the first sync', () => {
    expect(describeSync(IDLE, NOW)).toMatchObject({ label: 'Never', canSyncNow: true, detail: 'Backup has not completed a sync yet.' });
  });
});

describe('relative sync time', () => {
  it('is coarse on purpose', () => {
    expect(relativeSyncTime(NOW, NOW)).toBe('Just now');
    expect(relativeSyncTime(NOW - 59_000, NOW)).toBe('Just now');
    expect(relativeSyncTime(NOW - 60_000, NOW)).toBe('1 min ago');
    expect(relativeSyncTime(NOW - 45 * 60_000, NOW)).toBe('45 min ago');
    expect(relativeSyncTime(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
    expect(relativeSyncTime(NOW - 5 * 60 * 60_000, NOW)).toBe('5 hours ago');
    expect(relativeSyncTime(NOW - 26 * 60 * 60_000, NOW)).toBe('Yesterday');
    expect(relativeSyncTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe('3 days ago');
  });

  it('never renders a negative age if the device clock moved backwards', () => {
    expect(relativeSyncTime(NOW + 60_000, NOW)).toBe('Just now');
  });
});

describe('cloud-only flights', () => {
  it('says nothing when there are none', () => {
    expect(cloudOnlySummary(IDLE)).toBeNull();
  });

  it('is explicit that this app does not download flights', () => {
    // Restore is out of scope by design, so the copy must not imply it is coming.
    expect(cloudOnlySummary({ ...IDLE, cloudOnlyFlights: 1 })).toMatch(/1 flight/);
    expect(cloudOnlySummary({ ...IDLE, cloudOnlyFlights: 4 })).toMatch(/4 flights/);
    expect(cloudOnlySummary({ ...IDLE, cloudOnlyFlights: 4 })).toMatch(/does not download flights/);
  });
});

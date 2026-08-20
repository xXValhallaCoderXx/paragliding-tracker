import type { SyncSnapshot } from '@/cloud/types';
import type { PilotProfile } from '@/recorder/types';

import {
  cloudOnlySummary,
  describeSync,
  igcHeaderSummary,
  relativeSyncTime,
} from '../account-presentation';

const EMPTY: PilotProfile = {
  pilotName: null,
  gliderType: null,
  gliderId: null,
  registrationId: null,
  updatedAt: 0,
  pushedUpdatedAt: null,
};

const FILLED: PilotProfile = {
  ...EMPTY,
  pilotName: 'Renate Gouveia',
  gliderType: 'Ozone Rush 6',
  updatedAt: 1_760_000_000_000,
};

describe('IGC header summary', () => {
  it('names the placeholder that ships today when nothing is filled in', () => {
    expect(igcHeaderSummary(EMPTY)).toContain('UNSPECIFIED');
  });

  it('falls back per field rather than hiding the whole line', () => {
    expect(igcHeaderSummary(FILLED)).toBe('IGC files will record Renate Gouveia flying Ozone Rush 6.');
    expect(igcHeaderSummary({ ...EMPTY, pilotName: 'Renate' })).toBe(
      'IGC files will record Renate flying PARAGLIDER.',
    );
  });
});

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
      'Everything on this phone is backed up.',
    );
  });

  it('says Never rather than an empty value before the first sync', () => {
    expect(describeSync(IDLE, NOW)).toMatchObject({ label: 'Never', canSyncNow: true });
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

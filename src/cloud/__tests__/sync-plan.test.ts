import { CLOUD_CONFIG } from '../config';
import {
  classifySyncError,
  evaluateSyncGate,
  hasUsableTrack,
  igcObjectPath,
  nextBackoff,
  resolveMetadataConflict,
  shouldUploadIgc,
  type SyncGateInput,
} from '../sync-plan';

const NOW = 1_760_000_000_000;

const READY: SyncGateInput = {
  configured: true,
  authStatus: 'signed_in',
  sessionUserId: 'user-1',
  linkedUserId: 'user-1',
  recorderRecovering: false,
  unfinishedSessionStatus: null,
  now: NOW,
  lastSyncAt: null,
  nextAttemptAt: 0,
  trigger: 'foreground',
};

describe('sync gate', () => {
  it('runs when everything is ready', () => {
    expect(evaluateSyncGate(READY)).toEqual({ run: true, bindTo: null });
  });

  it('refuses to run while a flight is being recorded', () => {
    // The single most important rule in this file. Sync must never compete with capture
    // for the database, the radio, or the battery.
    expect(evaluateSyncGate({ ...READY, unfinishedSessionStatus: 'recording' })).toEqual({
      run: false,
      reason: 'recording',
    });
  });

  it('does not treat an interrupted session as a reason to stay offline', () => {
    // The phone is on the ground and probably back on signal. That session's flight is
    // not 'completed', so the push query excludes it regardless.
    expect(evaluateSyncGate({ ...READY, unfinishedSessionStatus: 'interrupted' })).toEqual({
      run: true,
      bindTo: null,
    });
  });

  it('waits for recorder recovery to finish', () => {
    expect(evaluateSyncGate({ ...READY, recorderRecovering: true })).toEqual({
      run: false,
      reason: 'recovering',
    });
  });

  it('claims an unclaimed device on first sign-in', () => {
    expect(evaluateSyncGate({ ...READY, linkedUserId: null })).toEqual({
      run: true,
      bindTo: 'user-1',
    });
  });

  it('refuses to upload one pilot logbook into another pilot account', () => {
    expect(evaluateSyncGate({ ...READY, linkedUserId: 'user-2' })).toEqual({
      run: false,
      reason: 'account_mismatch',
    });
  });

  it('reports the most fundamental blocker rather than an incidental one', () => {
    // A signed-out pilot in an unconfigured build should be told configuration is the
    // problem; a signed-out pilot who is also throttled should be told they are signed out.
    expect(evaluateSyncGate({ ...READY, configured: false, authStatus: 'signed_out' })).toEqual({
      run: false,
      reason: 'unconfigured',
    });
    expect(
      evaluateSyncGate({ ...READY, authStatus: 'signed_out', lastSyncAt: NOW }),
    ).toEqual({ run: false, reason: 'signed_out' });
  });

  it('treats every non-signed-in auth status as signed out', () => {
    for (const status of ['restoring', 'signed_out', 'unconfigured'] as const) {
      expect(evaluateSyncGate({ ...READY, authStatus: status })).toMatchObject({ run: false });
    }
    // A signed_in status with no user id is incoherent and must not run either.
    expect(evaluateSyncGate({ ...READY, sessionUserId: null })).toEqual({
      run: false,
      reason: 'signed_out',
    });
  });

  it('honours the whole-cycle backoff window', () => {
    expect(evaluateSyncGate({ ...READY, nextAttemptAt: NOW + 1 })).toEqual({
      run: false,
      reason: 'backoff',
    });
    expect(evaluateSyncGate({ ...READY, nextAttemptAt: NOW })).toMatchObject({ run: true });
  });

  it('throttles automatic triggers but never a manual one', () => {
    const recent = { ...READY, lastSyncAt: NOW - 1_000 };
    expect(evaluateSyncGate(recent)).toEqual({ run: false, reason: 'throttled' });
    expect(evaluateSyncGate({ ...recent, trigger: 'logbook-focus' })).toEqual({
      run: false,
      reason: 'throttled',
    });
    // If a pilot taps "Sync now", something visible has to happen.
    expect(evaluateSyncGate({ ...recent, trigger: 'manual' })).toMatchObject({ run: true });
  });

  it('stops throttling once the interval has passed', () => {
    const interval = CLOUD_CONFIG.minimumSyncIntervalMs;
    expect(evaluateSyncGate({ ...READY, lastSyncAt: NOW - interval + 1 })).toMatchObject({
      run: false,
    });
    expect(evaluateSyncGate({ ...READY, lastSyncAt: NOW - interval })).toMatchObject({ run: true });
  });

  it('still blocks a manual sync while recording', () => {
    expect(
      evaluateSyncGate({ ...READY, trigger: 'manual', unfinishedSessionStatus: 'recording' }),
    ).toEqual({ run: false, reason: 'recording' });
  });
});

describe('metadata conflict resolution', () => {
  const local = { title: 'Local', site: null, notes: null, updatedAt: 5_000 };

  it('takes the remote edit when it is newer', () => {
    const remote = { title: 'Remote', site: 'Sopelana', notes: null, clientUpdatedAt: 6_000 };
    expect(resolveMetadataConflict(local, remote)).toBe(remote);
  });

  it('keeps the local edit when it is newer', () => {
    expect(
      resolveMetadataConflict(local, { title: 'Old', site: null, notes: null, clientUpdatedAt: 4_000 }),
    ).toBeNull();
  });

  it('treats a tie as a no-op, which is what breaks the push/pull echo loop', () => {
    expect(
      resolveMetadataConflict(local, { title: 'Same', site: null, notes: null, clientUpdatedAt: 5_000 }),
    ).toBeNull();
  });

  it('applies the remote record whole, so a multi-field edit is never split', () => {
    const remote = { title: null, site: null, notes: 'Only notes', clientUpdatedAt: 9_000 };
    // Nulls win too: clearing a title elsewhere must clear it here, not be ignored.
    expect(resolveMetadataConflict(local, remote)).toEqual(remote);
  });
});

describe('backoff', () => {
  const noJitter = () => 0.5;

  it('doubles from the base delay', () => {
    expect(nextBackoff(0, NOW, noJitter)).toEqual({ attemptCount: 1, nextAttemptAt: NOW + 30_000 });
    expect(nextBackoff(1, NOW, noJitter)).toEqual({ attemptCount: 2, nextAttemptAt: NOW + 60_000 });
    expect(nextBackoff(2, NOW, noJitter)).toEqual({ attemptCount: 3, nextAttemptAt: NOW + 120_000 });
  });

  it('caps so a long-failing row still retries roughly twice an hour', () => {
    expect(nextBackoff(30, NOW, noJitter).nextAttemptAt).toBe(NOW + CLOUD_CONFIG.backoffMaxMs);
    expect(nextBackoff(1_000, NOW, noJitter).nextAttemptAt).toBe(NOW + CLOUD_CONFIG.backoffMaxMs);
  });

  it('spreads retries by up to 20 % either way', () => {
    expect(nextBackoff(0, NOW, () => 0).nextAttemptAt).toBe(NOW + 24_000);
    expect(nextBackoff(0, NOW, () => 1).nextAttemptAt).toBe(NOW + 36_000);
  });

  it('is deterministic for a given random source, so tests never flake', () => {
    expect(nextBackoff(3, NOW, noJitter)).toEqual(nextBackoff(3, NOW, noJitter));
  });

  it('tolerates a negative attempt count rather than producing a delay in the past', () => {
    expect(nextBackoff(-5, NOW, noJitter).nextAttemptAt).toBe(NOW + 30_000);
  });
});

describe('error classification', () => {
  it('retries anything transient', () => {
    expect(classifySyncError(new TypeError('Network request failed'))).toBe('retry');
    expect(classifySyncError({ message: 'fetch failed' })).toBe('retry');
    expect(classifySyncError({ status: 429 })).toBe('retry');
    expect(classifySyncError({ status: 500 })).toBe('retry');
    expect(classifySyncError({ status: 503 })).toBe('retry');
  });

  it('asks for re-authentication on a rejected or expired token', () => {
    expect(classifySyncError({ status: 401 })).toBe('reauth');
    expect(classifySyncError({ status: 403 })).toBe('reauth');
    // PostgREST reports an RLS denial as 42501, not as an HTTP 403.
    expect(classifySyncError({ code: '42501' })).toBe('reauth');
  });

  it('parks a row that will never be accepted, instead of hot-looping on it', () => {
    expect(classifySyncError({ code: '23514', message: 'check constraint' })).toBe('fatal');
    expect(classifySyncError({ code: '23505' })).toBe('fatal');
    expect(classifySyncError({ status: 400 })).toBe('fatal');
    expect(classifySyncError({ status: 422 })).toBe('fatal');
  });

  it('defaults to retry for anything unrecognised', () => {
    // Better to try again than to permanently park work for a reason we do not
    // understand yet.
    expect(classifySyncError(undefined)).toBe('retry');
    expect(classifySyncError(new Error('who knows'))).toBe('retry');
  });
});

describe('IGC upload decisions', () => {
  const withTrack = { igcSha256: null, metrics: { fixCount: 240, quality: 'healthy' } };

  it('uploads a flight that has never been uploaded', () => {
    expect(shouldUploadIgc(withTrack, 'sha-a')).toBe(true);
  });

  it('skips a flight whose IGC bytes have not changed', () => {
    // The IGC is deterministic, so an unchanged hash means an identical file.
    expect(shouldUploadIgc({ ...withTrack, igcSha256: 'sha-a' }, 'sha-a')).toBe(false);
  });

  it('re-uploads when the bytes change, e.g. after the pilot fills in their name', () => {
    expect(shouldUploadIgc({ ...withTrack, igcSha256: 'sha-a' }, 'sha-b')).toBe(true);
  });

  it('never tries to build an IGC for a flight with no usable track', () => {
    expect(hasUsableTrack({ igcSha256: null, metrics: null })).toBe(false);
    expect(hasUsableTrack({ igcSha256: null, metrics: { fixCount: 0, quality: 'healthy' } })).toBe(false);
    expect(hasUsableTrack({ igcSha256: null, metrics: { fixCount: 5, quality: 'no_track' } })).toBe(false);
    expect(shouldUploadIgc({ igcSha256: null, metrics: null }, 'sha-a')).toBe(false);
  });

  it('puts the owner first in the object key, which is what the storage policy matches', () => {
    expect(igcObjectPath('user-1', 'flight-9')).toBe('user-1/flight-9.igc');
  });
});

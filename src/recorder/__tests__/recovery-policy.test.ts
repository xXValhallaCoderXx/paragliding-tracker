import {
  deriveCaptureHealth,
  isAutomaticRecoveryEligible,
} from '../recovery-policy';

describe('automatic recovery policy', () => {
  const fifteenMinutes = 15 * 60_000;

  it('includes exactly fifteen minutes and excludes anything older', () => {
    expect(
      isAutomaticRecoveryEligible({
        startedAt: 1,
        lastEligibleFixSourceAt: 100_000,
        now: 100_000 + fifteenMinutes,
        maximumGapMs: fifteenMinutes,
      }),
    ).toBe(true);
    expect(
      isAutomaticRecoveryEligible({
        startedAt: 1,
        lastEligibleFixSourceAt: 100_000,
        now: 100_000 + fifteenMinutes + 1,
        maximumGapMs: fifteenMinutes,
      }),
    ).toBe(false);
  });

  it('uses the session start for a flight that has no fix yet', () => {
    expect(
      isAutomaticRecoveryEligible({
        startedAt: 100_000,
        lastEligibleFixSourceAt: null,
        now: 100_000 + fifteenMinutes,
        maximumGapMs: fifteenMinutes,
      }),
    ).toBe(true);
  });

});

describe('capture health', () => {
  it('does not treat task registration by itself as healthy', () => {
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 1,
        taskRegistered: true,
        lastLocationCallbackAt: 1,
        lastEligibleFixReceiptAt: 1,
        now: 20_000,
        staleAfterMs: 15_000,
      }),
    ).toBe('stale');
  });

  it('requires both a recent callback and recent valid fix', () => {
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 1,
        taskRegistered: true,
        lastLocationCallbackAt: 10_000,
        lastEligibleFixReceiptAt: 10_000,
        now: 20_000,
        staleAfterMs: 15_000,
      }),
    ).toBe('healthy');
  });

  it('gives a newly armed registered task a first-fix grace period', () => {
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 10_000,
        taskRegistered: true,
        lastLocationCallbackAt: null,
        lastEligibleFixReceiptAt: null,
        now: 20_000,
        staleAfterMs: 15_000,
      }),
    ).toBe('starting');
  });

  it('trusts fresh fixes over an unreliable task-registration probe', () => {
    // Android's task registry cannot report back the options we registered with, so
    // taskRegistered is false even while capture is working perfectly. Fixes are direct
    // evidence and must win; when this branch was gated on the probe, health was pinned to
    // 'stale' and the supervisor restarted a healthy GPS task every 5 seconds.
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 1,
        taskRegistered: false,
        lastLocationCallbackAt: 19_500,
        lastEligibleFixReceiptAt: 19_500,
        now: 20_000,
        staleAfterMs: 15_000,
      }),
    ).toBe('healthy');
  });

  it('still reports stale when the evidence really has dried up', () => {
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 1,
        taskRegistered: false,
        lastLocationCallbackAt: 1_000,
        lastEligibleFixReceiptAt: 1_000,
        now: 20_000,
        staleAfterMs: 15_000,
      }),
    ).toBe('stale');
  });

  it('does not claim healthy when only the callback is fresh but no valid fix landed', () => {
    // Callbacks arriving without eligible fixes is the mocked-location / no-lock case.
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 1,
        taskRegistered: true,
        lastLocationCallbackAt: 19_500,
        lastEligibleFixReceiptAt: null,
        now: 20_000,
        staleAfterMs: 15_000,
      }),
    ).toBe('stale');
  });

  it('reports recovering regardless of evidence while a recovery is in flight', () => {
    expect(
      deriveCaptureHealth({
        state: 'recording',
        startedAt: 1,
        taskRegistered: false,
        lastLocationCallbackAt: 19_500,
        lastEligibleFixReceiptAt: 19_500,
        now: 20_000,
        staleAfterMs: 15_000,
        recovering: true,
      }),
    ).toBe('recovering');
  });
});

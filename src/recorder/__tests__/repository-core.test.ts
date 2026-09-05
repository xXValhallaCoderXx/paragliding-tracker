import { mapPendingSessionRecoveryAttemptRow, resolveInterruptedPartialEndAt, resolveSessionCompletionTimestamp } from '../repository-core';

it('clamps partial completion to eligible evidence within the interruption window', () => {
  expect(resolveInterruptedPartialEndAt(1000, 5000, 4000)).toBe(4000);
  expect(resolveInterruptedPartialEndAt(1000, 5000, 9000)).toBe(5000);
  expect(resolveInterruptedPartialEndAt(1000, 5000, 500)).toBe(1000);
  expect(resolveInterruptedPartialEndAt(1000, 5000, null)).toBe(1000);
});
it('makes the durable Stop boundary win and rejects partial completion', () => {
  expect(resolveSessionCompletionTimestamp(1000, 9000, 2000, 'stopped')).toBe(2000);
  expect(resolveSessionCompletionTimestamp(1000, 9000, null, 'stopped')).toBe(9000);
  expect(() => resolveSessionCompletionTimestamp(1000, 9000, 2000, 'interrupted_finalized')).toThrow('reason stopped');
});

const attemptRow = (overrides: Record<string, unknown> = {}) => ({
  attempt_id: 'attempt-1',
  session_id: 'session-1',
  kind: 'automatic' as const,
  attempt_started_at: 2000,
  deadline_at: 22_000,
  maximum_cached_fix_age_ms: 5000,
  baseline_location_sequence: 7,
  proving_fix_sequence: null,
  proving_fix_source_at: null,
  proving_fix_receipt_at: null,
  ...overrides,
});

  it('maps only all-null or same-row complete proof fields', () => {
    expect(mapPendingSessionRecoveryAttemptRow(attemptRow())?.provingFix).toBeNull();
    expect(
      mapPendingSessionRecoveryAttemptRow(
        attemptRow({
          proving_fix_sequence: 8,
          proving_fix_source_at: 1900,
          proving_fix_receipt_at: 2100,
        }),
      )?.provingFix,
    ).toEqual({ sequence: 8, sourceTimestamp: 1900, receiptTimestamp: 2100 });
    expect(() =>
      mapPendingSessionRecoveryAttemptRow(attemptRow({ proving_fix_sequence: 8 })),
    ).toThrow('incomplete proving fix');
  });

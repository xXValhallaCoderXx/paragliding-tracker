import { resolveInterruptedFinalizationTimestamp } from '../recovery';
import type { RecorderEventRecord } from '../types';

function event(
  id: number,
  type: string,
  occurredAt: number,
  payload: Record<string, unknown> = {},
): RecorderEventRecord {
  return { id, sessionId: 'session-1', type, occurredAt, payload };
}

describe('interrupted finalization boundary', () => {
  const session = { id: 'session-1', startedAt: 1000 };

  it('restores the manual stop timestamp recorded after task teardown', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        session,
        [event(1, 'interruption_detected', 2100, { manualStopAt: 2000 })],
        9000,
      ),
    ).toBe(2000);
  });

  it('does not reuse a manual stop boundary after the session was resumed', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        session,
        [
          event(1, 'interruption_detected', 2100, { manualStopAt: 2000 }),
          event(2, 'session_resumed', 3000),
          event(3, 'interruption_detected', 4000),
        ],
        9000,
      ),
    ).toBe(9000);
  });

  it('uses the in-memory boundary when persisting the interruption failed', () => {
    expect(resolveInterruptedFinalizationTimestamp(session, [], 9000, 2500)).toBe(2500);
  });

  it('gives the sticky persisted Stop boundary precedence over later events and fallbacks', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        { ...session, manualStopAt: 2400 },
        [event(1, 'session_resumed', 3000), event(2, 'interruption_detected', 5000, {
          partialEndAt: 4500,
        })],
        9000,
        2600,
      ),
    ).toBe(2400);
  });

  it('uses the durable partial boundary when no manual stop exists', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        session,
        [event(1, 'interruption_detected', 4000, { partialEndAt: 3500 })],
        9000,
      ),
    ).toBe(3500);
  });

  it('gives a valid manual stop precedence over the eligible-fix boundary', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        session,
        [
          event(1, 'interruption_detected', 4000, {
            manualStopAt: 3000,
            partialEndAt: 3500,
          }),
        ],
        9000,
      ),
    ).toBe(3000);
  });

  it('invalidates both boundaries on resume and uses the next interruption boundary', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        session,
        [
          event(1, 'interruption_detected', 4000, {
            manualStopAt: 3000,
            partialEndAt: 3500,
          }),
          event(2, 'session_resumed', 5000),
          event(3, 'interruption_detected', 7000, { partialEndAt: 6500 }),
        ],
        9000,
      ),
    ).toBe(6500);
  });

  it('ignores malformed or pre-start boundaries and clamps an early fallback', () => {
    expect(
      resolveInterruptedFinalizationTimestamp(
        session,
        [
          event(1, 'interruption_detected', 4000, {
            manualStopAt: Number.NaN,
            partialEndAt: 999,
          }),
        ],
        500,
      ),
    ).toBe(1000);
  });
});

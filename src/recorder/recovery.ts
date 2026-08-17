import type { RecorderEventRecord, SessionRecord } from './types';

function validBoundary(value: unknown, startedAt: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= startedAt ? value : null;
}

export function resolveInterruptedFinalizationTimestamp(
  session: Pick<SessionRecord, 'id' | 'startedAt'> &
    Partial<Pick<SessionRecord, 'manualStopAt'>>,
  events: RecorderEventRecord[],
  fallbackAt: number,
  pendingManualStopAt: number | null = null,
): number {
  const durableManualStopAt = validBoundary(session.manualStopAt, session.startedAt);
  if (durableManualStopAt !== null) return durableManualStopAt;

  let interruptionEndAt: number | null = null;
  const orderedEvents = events
    .filter((event) => event.sessionId === session.id)
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt || left.id - right.id,
    );

  for (const event of orderedEvents) {
    if (event.type === 'session_resumed') {
      interruptionEndAt = null;
      continue;
    }
    if (event.type !== 'interruption_detected') continue;
    interruptionEndAt =
      validBoundary(event.payload.manualStopAt, session.startedAt) ??
      validBoundary(event.payload.partialEndAt, session.startedAt);
  }

  if (
    validBoundary(pendingManualStopAt, session.startedAt) !== null
  ) {
    interruptionEndAt = pendingManualStopAt;
  }
  const safeFallbackAt = Number.isFinite(fallbackAt)
    ? Math.max(session.startedAt, fallbackAt)
    : session.startedAt;
  return interruptionEndAt ?? safeFallbackAt;
}

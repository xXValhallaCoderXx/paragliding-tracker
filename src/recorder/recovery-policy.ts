import type { CaptureHealth, RecorderState } from './types';

export interface AutomaticRecoveryInput {
  startedAt: number;
  lastEligibleFixSourceAt: number | null;
  now: number;
  maximumGapMs: number;
}

export interface CaptureHealthInput {
  state: RecorderState;
  startedAt: number | null;
  taskRegistered: boolean;
  lastLocationCallbackAt: number | null;
  lastEligibleFixReceiptAt: number | null;
  now: number;
  staleAfterMs: number;
  recovering?: boolean;
}

export function automaticRecoveryAnchorAt({
  startedAt,
  lastEligibleFixSourceAt,
}: Pick<AutomaticRecoveryInput, 'startedAt' | 'lastEligibleFixSourceAt'>): number {
  return lastEligibleFixSourceAt ?? startedAt;
}

export function isAutomaticRecoveryEligible(input: AutomaticRecoveryInput): boolean {
  const anchorAt = automaticRecoveryAnchorAt(input);
  return anchorAt <= input.now && input.now - anchorAt <= input.maximumGapMs;
}

function isRecent(value: number | null, now: number, maximumAgeMs: number): boolean {
  return value !== null && value <= now && now - value <= maximumAgeMs;
}

export function deriveCaptureHealth(input: CaptureHealthInput): CaptureHealth {
  if (input.recovering) return 'recovering';
  if (input.state === 'arming') return 'starting';
  if (input.state === 'interrupted') return 'failed';
  if (input.state !== 'recording') return 'inactive';

  // Fresh fixes are direct proof that capture is working, so they are evaluated first and
  // outrank `taskRegistered`. That flag is only a probe of the platform's task registry, and a
  // probe must never be able to veto evidence: when it previously gated this branch, an Android
  // quirk that made it permanently false pinned health to 'stale' and had the supervisor
  // restarting a healthy GPS task every 5 seconds. See locationTaskOptionsMatch in
  // recorder-service.native.ts for that quirk.
  if (
    isRecent(input.lastLocationCallbackAt, input.now, input.staleAfterMs) &&
    isRecent(input.lastEligibleFixReceiptAt, input.now, input.staleAfterMs)
  ) {
    return 'healthy';
  }

  // No eligible fix yet, but the session only just started: still acquiring, not degraded.
  if (
    input.taskRegistered &&
    input.lastEligibleFixReceiptAt === null &&
    isRecent(input.startedAt, input.now, input.staleAfterMs)
  ) {
    return 'starting';
  }

  // No recent evidence. Genuinely stale — the supervisor should try to recover, which is the
  // correct response to a task that really has stopped delivering.
  return 'stale';
}

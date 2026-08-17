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

  if (
    input.taskRegistered &&
    input.lastEligibleFixReceiptAt === null &&
    isRecent(input.startedAt, input.now, input.staleAfterMs)
  ) {
    return 'starting';
  }

  return input.taskRegistered &&
    isRecent(input.lastLocationCallbackAt, input.now, input.staleAfterMs) &&
    isRecent(input.lastEligibleFixReceiptAt, input.now, input.staleAfterMs)
    ? 'healthy'
    : 'stale';
}

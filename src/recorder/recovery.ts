import type { RecorderState, SessionRecord } from './types';

export interface RecoveryDecision {
  state: RecorderState;
  action: 'none' | 'mark_interrupted' | 'mark_resumed' | 'stop_stale_task';
}

export function decideRecovery(
  unfinishedStatus: SessionRecord['status'] | null,
  taskRegistered: boolean,
): RecoveryDecision {
  if (unfinishedStatus === 'recording') {
    return taskRegistered
      ? { state: 'recording', action: 'none' }
      : { state: 'interrupted', action: 'mark_interrupted' };
  }
  if (unfinishedStatus === 'interrupted') {
    return taskRegistered
      ? { state: 'recording', action: 'mark_resumed' }
      : { state: 'interrupted', action: 'none' };
  }
  return taskRegistered
    ? { state: 'idle', action: 'stop_stale_task' }
    : { state: 'idle', action: 'none' };
}

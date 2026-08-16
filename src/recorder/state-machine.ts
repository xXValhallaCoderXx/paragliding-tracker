import { RecorderError, type RecorderState } from './types';

export type RecorderEvent =
  | 'arm'
  | 'arm_succeeded'
  | 'arm_failed'
  | 'stop'
  | 'stop_succeeded'
  | 'task_missing'
  | 'resume'
  | 'finalize_interrupted';

const transitions: Partial<Record<RecorderState, Partial<Record<RecorderEvent, RecorderState>>>> = {
  idle: {
    arm: 'arming',
    stop: 'idle',
  },
  arming: {
    arm_succeeded: 'recording',
    arm_failed: 'idle',
  },
  recording: {
    stop: 'stopping',
    task_missing: 'interrupted',
  },
  stopping: {
    stop: 'stopping',
    stop_succeeded: 'completed',
  },
  interrupted: {
    resume: 'arming',
    finalize_interrupted: 'completed',
    task_missing: 'interrupted',
  },
  completed: {
    arm: 'arming',
    stop: 'completed',
  },
};

export function transitionRecorderState(
  state: RecorderState,
  event: RecorderEvent,
): RecorderState {
  const nextState = transitions[state]?.[event];
  if (!nextState) {
    throw new RecorderError(
      'invalid_transition',
      `Cannot apply recorder event "${event}" while state is "${state}".`,
    );
  }
  return nextState;
}

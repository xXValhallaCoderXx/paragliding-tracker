import { transitionRecorderState } from '../state-machine';

describe('recorder state machine', () => {
  it('runs the normal lifecycle and makes stop idempotent', () => {
    expect(transitionRecorderState('idle', 'stop')).toBe('idle');
    expect(transitionRecorderState('idle', 'arm')).toBe('arming');
    expect(transitionRecorderState('arming', 'arm_succeeded')).toBe('recording');
    expect(transitionRecorderState('recording', 'stop')).toBe('stopping');
    expect(transitionRecorderState('stopping', 'stop')).toBe('stopping');
    expect(transitionRecorderState('stopping', 'stop_succeeded')).toBe('completed');
    expect(transitionRecorderState('completed', 'stop')).toBe('completed');
  });

  it('rejects double arm and supports interruption recovery', () => {
    expect(() => transitionRecorderState('arming', 'arm')).toThrow('Cannot apply');
    expect(() => transitionRecorderState('recording', 'arm')).toThrow('Cannot apply');
    expect(transitionRecorderState('recording', 'task_missing')).toBe('interrupted');
    expect(transitionRecorderState('interrupted', 'resume')).toBe('arming');
    expect(transitionRecorderState('interrupted', 'finalize_interrupted')).toBe('completed');
  });
});

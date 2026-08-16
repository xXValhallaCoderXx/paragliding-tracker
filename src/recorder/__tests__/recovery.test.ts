import { decideRecovery } from '../recovery';

describe('cold-launch recovery', () => {
  it('keeps a recording session active when the task is registered', () => {
    expect(decideRecovery('recording', true)).toEqual({ state: 'recording', action: 'none' });
  });

  it('marks a recording session interrupted when the task is absent', () => {
    expect(decideRecovery('recording', false)).toEqual({
      state: 'interrupted',
      action: 'mark_interrupted',
    });
  });

  it('repairs an interrupted checkpoint if the task is still running', () => {
    expect(decideRecovery('interrupted', true)).toEqual({
      state: 'recording',
      action: 'mark_resumed',
    });
  });

  it('stops a stale task when no unfinished session exists', () => {
    expect(decideRecovery(null, true)).toEqual({ state: 'idle', action: 'stop_stale_task' });
  });
});

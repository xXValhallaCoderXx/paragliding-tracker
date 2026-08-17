import {
  captureAgeLabel,
  capturePresentation,
  unfinishedFlightPresentation,
} from '../capture-health';

describe('capturePresentation', () => {
  it('only shows a green recording state when capture health is healthy', () => {
    expect(capturePresentation({ state: 'recording', captureHealth: 'healthy' })).toMatchObject({
      label: 'RECORDING',
      tone: 'good',
    });
    expect(capturePresentation({ state: 'recording', captureHealth: 'stale' })).toMatchObject({
      label: 'GPS STALE',
      tone: 'warning',
    });
    expect(capturePresentation({ state: 'recording', captureHealth: 'inactive' }).tone).toBe(
      'danger',
    );
  });

  it('renders interrupted capture as needing attention', () => {
    expect(
      capturePresentation({ state: 'interrupted', captureHealth: 'failed' }),
    ).toMatchObject({ label: 'NEEDS ATTENTION', tone: 'danger' });
  });

  it('does not claim success while recovery is waiting for a fresh fix', () => {
    expect(
      capturePresentation({ state: 'recording', captureHealth: 'recovering' }),
    ).toMatchObject({ label: 'RECOVERING', tone: 'warning' });
    expect(
      capturePresentation({ state: 'arming', captureHealth: 'recovering' }),
    ).toMatchObject({ label: 'RECOVERING', tone: 'warning' });
  });
});

describe('captureAgeLabel', () => {
  it('distinguishes missing, fresh, seconds-old, and minutes-old evidence', () => {
    expect(captureAgeLabel(null, 120_000)).toBe('none yet');
    expect(captureAgeLabel(119_500, 120_000)).toBe('just now');
    expect(captureAgeLabel(105_000, 120_000)).toBe('15 s ago');
    expect(captureAgeLabel(1_000, 121_000)).toBe('2 min ago');
  });
});

describe('unfinishedFlightPresentation', () => {
  it('makes an interrupted flight an explicit attention state that reopens the recorder', () => {
    expect(unfinishedFlightPresentation('interrupted')).toEqual({
      label: 'Needs attention',
      tone: 'danger',
      opensRecorder: true,
    });
  });

  it('does not claim an unfinished recording is healthy from persisted state alone', () => {
    expect(unfinishedFlightPresentation('recording')).toEqual({
      label: 'Recording in progress',
      tone: 'neutral',
      opensRecorder: true,
    });
    expect(unfinishedFlightPresentation('completed')).toBeNull();
  });
});

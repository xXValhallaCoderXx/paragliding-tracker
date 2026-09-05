import {
  INITIAL_ONBOARDING_STATE,
  abandon,
  acknowledgeDisclaimer,
  advance,
  canLeaveWelcome,
  persistedResult,
  shouldShowOnboarding,
  stepProgress,
  type OnboardingState,
} from '../onboarding-flow';

/** Welcome screen with the disclaimer already accepted — the usual starting point. */
function accepted(): OnboardingState {
  return acknowledgeDisclaimer(INITIAL_ONBOARDING_STATE);
}

/** Walks the machine forward, returning every step it visits. */
function walk(from: OnboardingState): string[] {
  const visited: string[] = [];
  let state: OnboardingState | null = from;
  while (state) {
    visited.push(state.step);
    state = advance(state, 'continue');
  }
  return visited;
}

describe('the welcome gate', () => {
  it('refuses to move until the disclaimer is acknowledged', () => {
    // The brief requires this on first run and forbids it being a dismissible toast.
    expect(canLeaveWelcome(INITIAL_ONBOARDING_STATE)).toBe(false);
    expect(advance(INITIAL_ONBOARDING_STATE, 'continue')).toEqual(INITIAL_ONBOARDING_STATE);
    expect(advance(INITIAL_ONBOARDING_STATE, 'skip')).toEqual(INITIAL_ONBOARDING_STATE);
  });

  it('gates skipping too, or skipping would be a way to never see it', () => {
    expect(advance(INITIAL_ONBOARDING_STATE, 'skip')).not.toBeNull();
    expect(advance(accepted(), 'skip')).toBeNull();
  });

  it('has nowhere to go back to', () => {
    expect(advance(accepted(), 'back')).toEqual(accepted());
  });
});

describe('stepping through', () => {
  it('visits every step once, in the order the design draws them', () => {
    expect(walk(accepted())).toEqual(['welcome', 'pilot', 'glider', 'location', 'backup']);
  });


  it('treats skip and continue identically for navigation', () => {
    const skipped: string[] = [];
    let state: OnboardingState | null = accepted();
    while (state) {
      skipped.push(state.step);
      state = advance(state, state.step === 'welcome' ? 'continue' : 'skip');
    }
    expect(skipped).toEqual(walk(accepted()));
  });

  it('goes back a step, and from the first step to welcome', () => {
    const pilot = advance(accepted(), 'continue')!;
    expect(pilot.step).toBe('pilot');
    expect(advance(pilot, 'back')!.step).toBe('welcome');

    const glider = advance(pilot, 'continue')!;
    expect(advance(glider, 'back')!.step).toBe('pilot');
  });

  it('keeps the acknowledgement while navigating', () => {
    const glider = advance(advance(accepted(), 'continue')!, 'continue')!;
    expect(glider.disclaimerAcknowledged).toBe(true);
    expect(advance(glider, 'back')!.disclaimerAcknowledged).toBe(true);
  });
});

describe('stepProgress', () => {
  it('numbers the four steps and leaves welcome out of the count', () => {
    expect(stepProgress('welcome')).toBeNull();
    expect(stepProgress('pilot')).toEqual({ current: 1, total: 4 });
    expect(stepProgress('glider')).toEqual({ current: 2, total: 4 });
    expect(stepProgress('location')).toEqual({ current: 3, total: 4 });
    expect(stepProgress('backup')).toEqual({ current: 4, total: 4 });
  });
});

describe('what gets persisted', () => {
  it('records reaching the end as done, even with every field left blank', () => {
    expect(persistedResult(accepted())).toBe('done');
  });

  it('records an abandoned run as skipped, so the logbook can offer the checklist', () => {
    expect(persistedResult(abandon(accepted()))).toBe('skipped');
  });

  it('shows setup only while pending', () => {
    expect(shouldShowOnboarding('pending')).toBe(true);
    expect(shouldShowOnboarding('done')).toBe(false);
    expect(shouldShowOnboarding('skipped')).toBe(false);
  });
});

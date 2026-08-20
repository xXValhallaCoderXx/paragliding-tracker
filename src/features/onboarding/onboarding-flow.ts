import type { OnboardingState as PersistedOnboardingState } from '@/recorder/types';

/**
 * Pure state machine for first-run setup.
 *
 * Lives in its own `.ts` module so jest covers it — `testMatch` only picks up `.ts`, so
 * nothing decision-shaped may live in the `.tsx` screens. Same split as
 * `@/cloud/otp-policy`, which the sign-in card follows.
 *
 * The whole flow is skippable by design. Recording must work with no account, no signal
 * and no setup, so every step here is an offer rather than a gate — including the
 * location step, which explains why it matters and then still lets the pilot past.
 */

export type OnboardingStep = 'welcome' | 'pilot' | 'glider' | 'location' | 'backup';

/** What the pilot did on a step. `skip` and `continue` both move forward. */
export type StepOutcome = 'continue' | 'skip' | 'back';

export interface OnboardingState {
  step: OnboardingStep;
  /** The "not a certified flight recorder" acknowledgement on the welcome screen. */
  disclaimerAcknowledged: boolean;
  /** True when the pilot took "Skip setup, take me to record" rather than stepping through. */
  abandoned: boolean;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = Object.freeze({
  step: 'welcome',
  disclaimerAcknowledged: false,
  abandoned: false,
});

/** The four numbered steps, in order. `welcome` sits outside the count. */
const STEPS: readonly OnboardingStep[] = ['pilot', 'glider', 'location', 'backup'];

export const ONBOARDING_STEP_COUNT = STEPS.length;

/**
 * The "2/4" indicator. Null on the welcome screen, which is deliberately not numbered —
 * counting it would promise five steps and then show four.
 */
export function stepProgress(step: OnboardingStep): { current: number; total: number } | null {
  const index = STEPS.indexOf(step);
  return index < 0 ? null : { current: index + 1, total: ONBOARDING_STEP_COUNT };
}

export function acknowledgeDisclaimer(state: OnboardingState): OnboardingState {
  return { ...state, disclaimerAcknowledged: true };
}

/**
 * Whether the welcome screen's two CTAs are live.
 *
 * The disclaimer is the one thing that genuinely blocks: the brief requires it on first
 * run and forbids it being a dismissible toast. Skipping setup still has to acknowledge
 * it, or "skip" would become a way to never see it at all.
 */
export function canLeaveWelcome(state: OnboardingState): boolean {
  return state.disclaimerAcknowledged;
}

/** Whether the machine has run past its last step. */
export function isFinished(state: OnboardingState | null): state is null {
  return state === null;
}

/**
 * Moves one step. Returns null when setup is over, so the caller has exactly one
 * "we're done" branch rather than a terminal step that renders nothing.
 *
 * Going `back` from the first step returns to the welcome screen; going back from
 * welcome stays put, because there is nowhere behind it.
 */
export function advance(state: OnboardingState, outcome: StepOutcome): OnboardingState | null {
  if (state.step === 'welcome') {
    if (outcome === 'back') return state;
    if (!canLeaveWelcome(state)) return state;
    if (outcome === 'skip') return null;
    return { ...state, step: STEPS[0]! };
  }

  const index = STEPS.indexOf(state.step);
  if (outcome === 'back') {
    return index <= 0 ? { ...state, step: 'welcome' } : { ...state, step: STEPS[index - 1]! };
  }
  const next = STEPS[index + 1];
  return next ? { ...state, step: next } : null;
}

/** Jumps straight out of setup, recording that it was abandoned rather than completed. */
export function abandon(state: OnboardingState): OnboardingState {
  return { ...state, abandoned: true };
}

/**
 * What to persist once the wizard closes.
 *
 * `skipped` is distinct from `done` because the logbook uses it to decide whether to
 * offer the setup checklist. Reaching the end counts as done even if every field was
 * left blank — the pilot was asked, and nagging them afterwards would be rude.
 */
export function persistedResult(state: OnboardingState): PersistedOnboardingState {
  return state.abandoned ? 'skipped' : 'done';
}

/** Whether first-run setup should be shown at all. */
export function shouldShowOnboarding(persisted: PersistedOnboardingState): boolean {
  return persisted === 'pending';
}

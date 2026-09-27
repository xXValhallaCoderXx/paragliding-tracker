import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  useGetAppSettingsQuery, useGetProfileQuery, useUpdateAppSettingsMutation, useUpdateProfileMutation,
} from '@/store/endpoints';
import {
  INITIAL_ONBOARDING_STATE, abandon, acknowledgeDisclaimer, advance, canLeaveWelcome,
  persistedResult, shouldShowOnboarding, type OnboardingState, type StepOutcome, type SetupDestination,
} from './onboarding-flow';

export type FirstRunStatus = 'loading' | 'required' | 'complete' | 'unavailable';
export type SetupMode = 'first-run' | 'review';

interface FirstRunValue {
  status: FirstRunStatus;
  showWizard: boolean;
  mode: SetupMode;
  destination: SetupDestination | null;
  consumeDestination: () => SetupDestination | null;
  completeSetup: (destination: SetupDestination) => Promise<void>;
  wizard: OnboardingState;
  nameDraft: string;
  setNameDraft: (name: string) => void;
  nameLoading: boolean;
  nameReadFailed: boolean;
  nameError: string | null;
  retryProfile: () => void;
  saving: 'name' | 'completion' | null;
  completionError: string | null;
  acknowledge: () => void;
  navigate: (outcome: StepOutcome) => Promise<void>;
  restartSetup: () => void;
  dismissReplay: () => void;
  retryCompletion: () => Promise<void>;
  continueWithoutSaving: () => void;
}

const FirstRunContext = createContext<FirstRunValue | null>(null);
const SETTINGS_READ_TIMEOUT_MS = 5_000;

/** Session drafts live above the overlay and recorder recovery. Only the saved name survives
 * process death; an unfinished first run starts at Welcome again. Review never resets history. */
export function FirstRunProvider({ children }: { children: ReactNode }) {
  const [destination, setDestination] = useState<SetupDestination | null>(null);
  const destinationRef = useRef<SetupDestination | null>(null);
  const completionSettled = useRef(false);
  const [mode, setMode] = useState<SetupMode>('first-run');
  const [reviewRequested, setReviewRequested] = useState(false);
  const [wizard, setWizard] = useState<OnboardingState>(INITIAL_ONBOARDING_STATE);
  const [nameDraft, setDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState<FirstRunValue['saving']>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<{ state: OnboardingState; destination: SetupDestination } | null>(null);
  const [finished, setFinished] = useState(false);
  const [readTimedOut, setReadTimedOut] = useState(false);
  // State cannot guard two presses in the same frame. The ref owns the operation immediately.
  const inFlight = useRef(false);
  const generation = useRef(0);
  const { data: settings, isError: settingsFailed } = useGetAppSettingsQuery();
  const { data: profile, isError: profileFailed, refetch: refetchProfile } = useGetProfileQuery();
  const [persistSettings] = useUpdateAppSettingsMutation();
  const [persistProfile] = useUpdateProfileMutation();

  // A one-time seed, never an effect copying subsequent cache refreshes over a typed draft.
  if (nameDraft === null && profile) setDraft(profile.pilotName ?? '');

  useEffect(() => {
    const timeout = setTimeout(() => setReadTimedOut(true), SETTINGS_READ_TIMEOUT_MS);
    return () => { clearTimeout(timeout); generation.current += 1; };
  }, []);

  const status: FirstRunStatus = finished ? 'complete' : settings
    ? shouldShowOnboarding(settings.onboardingState) ? 'required' : 'complete'
    : settingsFailed || readTimedOut ? 'unavailable' : 'loading';

  const setNameDraft = useCallback((name: string) => {
    if (inFlight.current) return;
    setDraft(name.slice(0, 60));
    setNameError(null);
  }, []);

  const consumeDestination = useCallback(() => {
    const next = destinationRef.current;
    destinationRef.current = null;
    setDestination(null);
    return next;
  }, []);

  const requestDestination = useCallback((next: SetupDestination) => {
    destinationRef.current = next;
    setDestination(next);
  }, []);

  const dismissReplay = useCallback(() => {
    if (inFlight.current) return;
    generation.current += 1;
    setReviewRequested(false);
    setWizard(INITIAL_ONBOARDING_STATE);
    setNameError(null);
    setCompletionError(null);
    setPendingCompletion(null);
    destinationRef.current = null;
    setDestination(null);
    setMode('first-run');
  }, []);

  const restartSetup = useCallback(() => {
    if (inFlight.current) return;
    generation.current += 1;
    completionSettled.current = false;
    destinationRef.current = null;
    setDestination(null);
    setMode('review');
    setDraft(profile?.pilotName ?? null);
    setNameError(null);
    setCompletionError(null);
    setPendingCompletion(null);
    setWizard({ ...INITIAL_ONBOARDING_STATE, disclaimerAcknowledged: Boolean(settings?.disclaimerAckAt) });
    setReviewRequested(true);
  }, [profile, settings]);

  const finishSetup = useCallback(async (state: OnboardingState, nextDestination: SetupDestination) => {
    if (inFlight.current || completionSettled.current || !canLeaveWelcome(state)) return;
    if (mode === 'review') {
      completionSettled.current = true;
      dismissReplay();
      requestDestination(nextDestination);
      return;
    }
    inFlight.current = true;
    setSaving('completion');
    setCompletionError(null);
    setPendingCompletion({ state, destination: nextDestination });
    const current = generation.current;
    try {
      const now = Date.now();
      await persistSettings({
        onboardingState: persistedResult(state),
        onboardingCompletedAt: settings?.onboardingCompletedAt ?? now,
        disclaimerAckAt: settings?.disclaimerAckAt ?? now,
      }).unwrap();
      if (current === generation.current) {
        completionSettled.current = true;
        setPendingCompletion(null);
        requestDestination(nextDestination);
        setFinished(true);
      }
    } catch {
      if (current === generation.current) {
        setCompletionError('Setup could not be saved on this phone. Retry, or continue without saving. Setup may return next launch.');
      }
    } finally {
      if (current === generation.current) { inFlight.current = false; setSaving(null); }
    }
  }, [mode, dismissReplay, persistSettings, settings, requestDestination]);

  const completeSetup = useCallback(async (nextDestination: SetupDestination) => {
    if (pendingCompletion) return; // Retry must keep the original destination.
    await finishSetup(wizard, nextDestination);
  }, [pendingCompletion, finishSetup, wizard]);

  const navigate = useCallback(async (outcome: StepOutcome) => {
    if (inFlight.current || completionSettled.current) return;
    if (outcome === 'back' && wizard.step === 'welcome' && mode === 'review') {
      dismissReplay(); return;
    }
    const next = advance(wizard, outcome);
    if (next === wizard) return; // Both Welcome exits enforce acknowledgement here too.
    if (next === null) {
      if (pendingCompletion) return;
      await finishSetup(wizard.step === 'welcome' ? abandon(wizard) : wizard, mode === 'review' ? 'return' : 'home');
      return;
    }
    if (wizard.step === 'pilot' && outcome === 'continue') {
      if (!profile) return; // Reading saved values must finish before a name can be replaced.
      const name = (nameDraft ?? '').trim();
      if (name && name !== profile.pilotName) {
        inFlight.current = true;
        setSaving('name');
        setNameError(null);
        const current = generation.current;
        try {
          await persistProfile({ pilotName: name }).unwrap();
          if (current !== generation.current) return;
        } catch {
          if (current === generation.current) setNameError('Your name could not be saved. Your draft is still here. Retry or skip for now.');
          return;
        } finally {
          if (current === generation.current) { inFlight.current = false; setSaving(null); }
        }
      }
    }
    setCompletionError(null);
    setPendingCompletion(null);
    setWizard(next);
  }, [wizard, mode, dismissReplay, finishSetup, profile, nameDraft, persistProfile, pendingCompletion]);

  const acknowledge = useCallback(() => setWizard((state) => acknowledgeDisclaimer(state)), []);
  const retryCompletion = useCallback(async () => {
    if (pendingCompletion) await finishSetup(pendingCompletion.state, pendingCompletion.destination);
  }, [pendingCompletion, finishSetup]);
  const continueWithoutSaving = useCallback(() => {
    if (inFlight.current || completionSettled.current || !completionError || !pendingCompletion || !canLeaveWelcome(pendingCompletion.state)) return;
    completionSettled.current = true;
    requestDestination(pendingCompletion.destination);
    setPendingCompletion(null);
    setFinished(true);
  }, [completionError, pendingCompletion, requestDestination]);
  const retryProfile = useCallback(() => { void refetchProfile(); }, [refetchProfile]);

  const value = useMemo<FirstRunValue>(() => ({
    status, destination, consumeDestination, completeSetup, showWizard: status === 'required' || reviewRequested, mode, wizard,
    nameDraft: nameDraft ?? '', setNameDraft, nameLoading: !profile && !profileFailed,
    nameReadFailed: profileFailed && !profile,
    nameError: nameError ?? (profileFailed && !profile ? 'Saved pilot details could not be read. Retry or skip for now.' : null),
    retryProfile, saving, completionError, acknowledge, navigate, restartSetup, dismissReplay,
    retryCompletion, continueWithoutSaving,
  }), [status, destination, consumeDestination, completeSetup, reviewRequested, mode, wizard, nameDraft, setNameDraft, profile, profileFailed,
    nameError, retryProfile, saving, completionError, acknowledge, navigate, restartSetup,
    dismissReplay, retryCompletion, continueWithoutSaving]);
  return <FirstRunContext.Provider value={value}>{children}</FirstRunContext.Provider>;
}

export function useFirstRun(): FirstRunValue {
  const value = useContext(FirstRunContext);
  if (!value) throw new Error('useFirstRun must be used inside FirstRunProvider.');
  return value;
}

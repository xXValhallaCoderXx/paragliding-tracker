import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { appSettingsRepository } from '@/recorder/flight-repository';

import {
  INITIAL_ONBOARDING_STATE,
  persistedResult,
  shouldShowOnboarding,
  type OnboardingState,
} from './onboarding-flow';

/**
 * Whether first-run setup is owed, and the wizard's own state while it runs.
 *
 * Two things live here rather than in the wizard component, and both are deliberate:
 *
 *  - The step and the pilot's half-typed answers survive any subtree churn. The location
 *    step sends the pilot to Android's settings screen, and returning re-fires
 *    `AppState → 'active'`, which flips `RecorderLifecycleProvider.recovering`
 *    false→true→false. Anything keyed off that would remount the wizard and throw away
 *    the name they just typed.
 *  - Replay from the settings screen is provider state, never a database write. Clearing
 *    the persisted flag to re-enter setup would mean a crash mid-replay drops the pilot
 *    back into first run *and* erases their disclaimer acknowledgement, which is a record
 *    rather than a preference.
 */

export type FirstRunStatus =
  | 'loading'
  /** Setup has never been completed on this device. */
  | 'required'
  | 'complete'
  /** Web, or the settings read failed. Never blocks: the logbook renders. */
  | 'unavailable';

interface FirstRunValue {
  status: FirstRunStatus;
  /** True while the wizard should be on screen, from either first run or a replay. */
  showWizard: boolean;
  wizard: OnboardingState;
  setWizard: (state: OnboardingState) => void;
  /** Re-enters setup without touching the database. */
  restartSetup: () => void;
  /** Records that setup finished, or was abandoned, and closes the wizard. */
  finishSetup: (state: OnboardingState) => Promise<void>;
  /** Backs out of a replay. Writes nothing — it is not a new acknowledgement. */
  dismissReplay: () => void;
}

const FirstRunContext = createContext<FirstRunValue | null>(null);

/**
 * A read that never resolves must not hold the app. The database open behind it can take
 * seconds on a large logbook and can genuinely fail, and failing open — showing the
 * logbook — is always better than locking the pilot out of data sitting intact on disk.
 */
const SETTINGS_READ_TIMEOUT_MS = 5_000;

export function FirstRunProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FirstRunStatus>(
    Platform.OS === 'web' ? 'unavailable' : 'loading',
  );
  const [replayRequested, setReplayRequested] = useState(false);
  const [wizard, setWizard] = useState<OnboardingState>(INITIAL_ONBOARDING_STATE);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;

    const timeout = setTimeout(() => {
      if (mounted) setStatus((current) => (current === 'loading' ? 'unavailable' : current));
    }, SETTINGS_READ_TIMEOUT_MS);

    void (async () => {
      try {
        const settings = await appSettingsRepository.getSettings();
        if (!mounted) return;
        setStatus(shouldShowOnboarding(settings.onboardingState) ? 'required' : 'complete');
      } catch (error) {
        // A settings row we cannot read is not something the pilot can act on, and it
        // must never stand between them and their logbook.
        if (__DEV__) console.warn('First-run settings read failed', error);
        if (mounted) setStatus('unavailable');
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  const restartSetup = useCallback(() => {
    setWizard(INITIAL_ONBOARDING_STATE);
    setReplayRequested(true);
  }, []);

  const dismissReplay = useCallback(() => {
    setReplayRequested(false);
    setWizard(INITIAL_ONBOARDING_STATE);
  }, []);

  const finishSetup = useCallback(async (state: OnboardingState) => {
    // Close first, write second. The pilot is done either way, and a slow or failed
    // write must not leave them staring at a wizard they have already finished.
    setReplayRequested(false);
    setStatus('complete');
    setWizard(INITIAL_ONBOARDING_STATE);
    if (Platform.OS === 'web') return;
    try {
      const now = Date.now();
      await appSettingsRepository.updateSettings({
        onboardingState: persistedResult(state),
        onboardingCompletedAt: now,
        ...(state.disclaimerAcknowledged ? { disclaimerAckAt: now } : {}),
      });
    } catch (error) {
      // Worst case the pilot sees setup once more on the next launch, which is a far
      // smaller failure than blocking them here.
      if (__DEV__) console.warn('Recording first-run completion failed', error);
    }
  }, []);

  const value = useMemo<FirstRunValue>(
    () => ({
      status,
      showWizard: status === 'required' || replayRequested,
      wizard,
      setWizard,
      restartSetup,
      finishSetup,
      dismissReplay,
    }),
    [status, replayRequested, wizard, restartSetup, finishSetup, dismissReplay],
  );

  return <FirstRunContext.Provider value={value}>{children}</FirstRunContext.Provider>;
}

export function useFirstRun(): FirstRunValue {
  const value = useContext(FirstRunContext);
  if (!value) throw new Error('useFirstRun must be used inside FirstRunProvider.');
  return value;
}

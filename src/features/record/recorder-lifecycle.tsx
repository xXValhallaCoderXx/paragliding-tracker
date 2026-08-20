import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { recorderService } from '@/recorder/recorder-service';

interface RecorderLifecycleState {
  ready: boolean;
  recovering: boolean;
  recoveryError: string | null;
}

const RecorderLifecycleContext = createContext<RecorderLifecycleState | null>(null);

let recoveryInFlight: Promise<void> | null = null;

function recoverRecorderOnce(): Promise<void> {
  if (!recoveryInFlight) {
    recoveryInFlight = recorderService
      .recover()
      .then(() => undefined)
      .finally(() => {
        recoveryInFlight = null;
      });
  }
  return recoveryInFlight;
}

export function RecorderLifecycleProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const recover = async () => {
      if (mounted) {
        setRecovering(true);
        setRecoveryError(null);
      }
      try {
        await recoverRecorderOnce();
      } catch (error) {
        if (mounted) {
          setRecoveryError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (mounted) {
          setReady(true);
          setRecovering(false);
        }
      }
    };

    void recover();
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void recover();
    });

    return () => {
      mounted = false;
      appStateSubscription.remove();
    };
  }, []);

  const value = useMemo(
    () => ({ ready, recovering, recoveryError }),
    [ready, recovering, recoveryError],
  );

  return (
    <RecorderLifecycleContext.Provider value={value}>
      {children}
    </RecorderLifecycleContext.Provider>
  );
}

export function useRecorderLifecycle(): RecorderLifecycleState {
  const value = useContext(RecorderLifecycleContext);
  if (!value) {
    throw new Error('useRecorderLifecycle must be used inside RecorderLifecycleProvider.');
  }
  return value;
}

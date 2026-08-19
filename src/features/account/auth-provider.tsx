import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { cloudAuthService, initialAuthSnapshot } from '@/cloud/auth-service';
import { cloudConfigured } from '@/cloud/config';
import type { AuthSnapshot } from '@/cloud/types';

interface CloudAuthState extends AuthSnapshot {
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const CloudAuthContext = createContext<CloudAuthState | null>(null);

// Module-level and therefore stable, so the useMemo below has honest dependencies.
// (Inline closures would make the memo lie, which React Compiler is strict about.)
const requestOtp = (email: string) => cloudAuthService.requestOtp(email);
const verifyOtp = (email: string, code: string) => cloudAuthService.verifyOtp(email, code);
const signOut = () => cloudAuthService.signOut();
const deleteAccount = () => cloudAuthService.deleteAccount();

/**
 * Cloud identity, if there is one.
 *
 * Mirrors `RecorderLifecycleProvider`. Note what it deliberately does *not* do: it never
 * gates a route. Signing in is optional, so the logbook and the recorder render exactly
 * the same signed in or out — there is no `Stack.Protected` anywhere in this app.
 */
export function CloudAuthProvider({ children }: { children: ReactNode }) {
  // A lazy initialiser, so the very first render is already the correct state and no
  // effect has to set-state during mount to correct it.
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(initialAuthSnapshot);

  useEffect(() => {
    if (Platform.OS === 'web' || !cloudConfigured) return;
    const unsubscribe = cloudAuthService.subscribe(setSnapshot);
    void cloudAuthService.restore();
    return unsubscribe;
  }, []);

  const value = useMemo(
    () => ({ ...snapshot, requestOtp, verifyOtp, signOut, deleteAccount }),
    [snapshot],
  );

  return <CloudAuthContext.Provider value={value}>{children}</CloudAuthContext.Provider>;
}

export function useCloudAuth(): CloudAuthState {
  const value = useContext(CloudAuthContext);
  if (!value) {
    throw new Error('useCloudAuth must be used inside CloudAuthProvider.');
  }
  return value;
}

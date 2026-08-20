import type { ReactNode } from 'react';

import { LoadingScreen } from '@/components/ui';

import { useFirstRun } from '../first-run-provider';
import { OnboardingOverlay } from './onboarding-overlay';

/**
 * Draws first-run setup over the navigator, never in place of it.
 *
 * While the settings read is in flight this renders a `LoadingScreen` rather than
 * holding the native splash: the read sits behind `openDatabase()` and the schema
 * migration, which copies the whole database file first and can take seconds on a large
 * logbook. Branded feedback beats a frozen splash, and a read that fails renders the
 * logbook rather than nothing — the provider's `unavailable` status fails open on
 * purpose, because a schema problem must never lock a pilot out of data sitting intact
 * on disk.
 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const firstRun = useFirstRun();

  if (firstRun.status === 'loading') return <LoadingScreen label="Opening your logbook…" />;

  return (
    <>
      {children}
      {firstRun.showWizard ? <OnboardingOverlay /> : null}
    </>
  );
}

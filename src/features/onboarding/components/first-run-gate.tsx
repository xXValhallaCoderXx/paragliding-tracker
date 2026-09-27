import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Modal } from 'react-native';

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
  const router = useRouter();
  useEffect(() => {
    if (firstRun.homeRequested) router.replace('/');
  }, [firstRun.homeRequested, router]);


  const covered = firstRun.status === 'loading' || firstRun.showWizard;

  return (
    <View style={styles.fill}>
      <View style={styles.fill} collapsable={false} pointerEvents={covered ? 'none' : 'auto'}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      <Modal visible={covered} transparent animationType="none" statusBarTranslucent navigationBarTranslucent
        // Native-stack styles the Activity. Apply again once Android registers the Modal's own Window.
        onShow={() => StatusBar.setStyle('dark')}
        onRequestClose={() => { if (firstRun.showWizard) void firstRun.navigate('back'); }}>
        <StatusBar style="dark" />
        {firstRun.showWizard ? <OnboardingOverlay /> : <LoadingScreen label="Opening Home…" />}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

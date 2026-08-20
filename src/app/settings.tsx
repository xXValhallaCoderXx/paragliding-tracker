import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';

import {
  Card,
  Disclaimer,
  ListRow,
  Notice,
  Screen,
  SectionLabel,
  TopBar,
  UnsupportedScreen,
} from '@/components/ui';
import {
  ACCOUNT_DELETION_URL,
  PRIVACY_POLICY_URL,
  privacyPolicyReady,
} from '@/features/account/legal';
import { useFirstRun } from '@/features/onboarding/first-run-provider';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { readinessRows } from '@/features/record/recorder-presentation';
import { openSystemScreen } from '@/lib/system-settings';
import { formatAirtimeShort } from '@/lib/format/flight-format';
import { RECORDER_CONFIG } from '@/recorder/config';
import { recorderService } from '@/recorder/recorder-service';
import type { RecorderCapabilities } from '@/recorder/types';
import { useGetFlightsQuery } from '@/store/endpoints';
import { DATA_AVAILABLE } from '@/store/hooks';
import { TAB_BAR_HEIGHT } from '@/ui/theme';

/**
 * Instruments, storage, legal and version.
 *
 * Scoped to what this app actually has. The design brief's S6 also lists Bluetooth vario
 * pairing and an XContest account link — neither exists here, and a settings screen full
 * of rows that do nothing is worse than a short one that is honest.
 *
 * Capabilities come from a one-shot `getCapabilities()`, never `recorderService.subscribe`:
 * subscribing starts a 1 Hz poll that only stops when the last listener leaves, and this
 * screen has no reason to hold it open.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const firstRun = useFirstRun();
  const recorderLifecycle = useRecorderLifecycle();
  // Gated on `ready` like every other reader. Without it this screen could populate the
  // shared flights cache mid-recovery, and the logbook would then read that entry with
  // `isFetching: false` the instant it unskipped — a stale list presented as settled.
  const skip = !DATA_AVAILABLE || !recorderLifecycle.ready;
  // Shared with the logbook and the account screen rather than read again: this screen
  // only needs a count and a total, and it used to pay for a full table read to get them.
  const { data: flights } = useGetFlightsQuery(undefined, { skip });

  // Capabilities stay a direct read. They are about system settings the pilot may have
  // changed while they were away, so focus is the correct trigger; a cache with its own
  // lifetime would still be showing "denied" right after a permission was granted.
  const [capabilities, setCapabilities] = useState<RecorderCapabilities | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      void recorderService
        .getCapabilities()
        .then(setCapabilities)
        .catch(() => setCapabilities(null));
    }, []),
  );

  if (Platform.OS === 'web') return <UnsupportedScreen />;

  const flightCount = flights?.length ?? null;
  const airtimeMs =
    flights?.reduce((total, flight) => total + (flight.metrics?.durationMs ?? 0), 0) ?? 0;
  const rows = capabilities
    ? readinessRows({ capabilities, batteryLevel: null, batteryOptimizationEnabled: null })
    : [];

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.block}>
          <SectionLabel>Recorder</SectionLabel>
          <Card className="px-[16px] py-[4px]">
            {rows.length === 0 ? (
              <ListRow label="Checking sensors…" mono={false} last />
            ) : (
              rows.map((row, index) => (
                <ListRow
                  key={row.key}
                  label={row.label}
                  value={row.value}
                  tone={row.tone}
                  showDot
                  detail={row.detail}
                  action={
                    row.action
                      ? {
                          label: 'Open settings',
                          onPress: () =>
                            void openSystemScreen(row.action!).catch(() => undefined),
                        }
                      : null
                  }
                  last={index === rows.length - 1}
                />
              ))
            )}
          </Card>
        </View>

        <View style={styles.block}>
          <SectionLabel>This phone</SectionLabel>
          <Card className="px-[16px] py-[4px]">
            <ListRow
              label="Flights stored"
              value={flightCount === null ? '—' : String(flightCount)}
            />
            <ListRow label="Airtime recorded" value={formatAirtimeShort(airtimeMs)} />
            <ListRow
              label="Units"
              value="Metric"
              detail="Metres, kilometres and km/h throughout. There is no other option yet."
              last
            />
          </Card>
        </View>

        <View style={styles.block}>
          <SectionLabel>Setup</SectionLabel>
          <Card className="px-[16px] py-[4px]">
            <ListRow
              label="Replay setup"
              detail="Walk through the first-run questions again. Nothing is reset."
              action={{ label: 'Start', onPress: firstRun.restartSetup }}
              last
            />
          </Card>
        </View>

        <View style={styles.block}>
          <SectionLabel>Legal</SectionLabel>
          <Notice tone="warning" title="This is not a certified flight recorder">
            Never fly with it as your only recorder. Long-duration and locked-screen recording are
            still being validated.
          </Notice>
          <Card className="px-[16px] py-[4px]">
            <ListRow
              label="Privacy policy"
              action={
                privacyPolicyReady
                  ? {
                      label: 'Open',
                      onPress: () => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL),
                    }
                  : null
              }
              value={privacyPolicyReady ? undefined : 'Not published yet'}
              mono={false}
            />
            <ListRow
              label="Delete your account"
              detail="Also available from the Account screen while signed in."
              action={
                ACCOUNT_DELETION_URL.length > 0
                  ? {
                      label: 'Open',
                      onPress: () => void WebBrowser.openBrowserAsync(ACCOUNT_DELETION_URL),
                    }
                  : null
              }
              value={ACCOUNT_DELETION_URL.length > 0 ? undefined : 'Not published yet'}
              mono={false}
              last
            />
          </Card>
        </View>

        <View style={styles.block}>
          <SectionLabel>Version</SectionLabel>
          <Card className="px-[16px] py-[4px]">
            {/* From expo-constants rather than expo-application: the version in app.json is
                what we need, and it costs no extra native module. */}
            <ListRow label="App" value={Constants.expoConfig?.version ?? '—'} />
            <ListRow
              label="Runtime"
              value={Constants.expoConfig?.slug ?? '—'}
            />
            <ListRow
              label="Recorder schema"
              value={`v${RECORDER_CONFIG.schemaVersion}`}
              detail="The local database format. Useful when reporting a problem."
              last
            />
          </Card>
        </View>

        <Disclaimer align="left">
          Bluetooth varios and XContest linking are not in this build.
        </Disclaimer>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 + TAB_BAR_HEIGHT },
  block: { paddingHorizontal: 18, paddingTop: 10, gap: 10 },
});

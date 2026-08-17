import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BusyRow,
  Button,
  Card,
  Chip,
  Disclaimer,
  Hairline,
  LinkButton,
  ListRow,
  Notice,
  SectionLabel,
  StateLabel,
  StatusPill,
  TopBar,
} from '@/components/ui';
import { InstrumentView } from '@/features/record/components/instrument';
import type { RecorderCapabilities, RecorderSnapshot } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

/**
 * Visual QA harness. Not a product route — it exists so `dist/visual/shot.sh` can render the
 * component kit through react-native-web and headless Chromium at a 392 px frame, since no
 * Android emulator is available on this machine and the product routes short-circuit to
 * `UnsupportedScreen` on web.
 *
 * Usage: `expo start --port 8091` then `dist/visual/shot.sh <name> 392x<h> <set>`.
 * Sets: `kit` (every primitive and variant), `instrument` (the in-flight recorder view).
 *
 * Delete before handoff — it is a development fixture, not shipped UI.
 */

const CAPABILITIES: RecorderCapabilities = {
  platform: 'android',
  supported: true,
  taskManagerAvailable: true,
  locationServicesEnabled: true,
  gpsAvailable: true,
  preciseLocation: true,
  pressureAvailable: false,
  batteryAvailable: true,
  sharingAvailable: true,
  foregroundPermission: 'granted',
  backgroundPermission: 'granted',
};

// Fixed timestamps: the React Compiler lint rules forbid Date.now() in render, and stable
// values keep screenshots byte-comparable between runs.
const NOW = 1_760_000_000_000;

const SNAPSHOT: RecorderSnapshot = {
  capturedAt: NOW,
  state: 'recording',
  flightId: 'flight-fixture',
  sessionId: 'session-fixture',
  startedAt: NOW - 4_215_000,
  endedAt: null,
  lastFixAt: NOW - 1_000,
  lastFixReceivedAt: NOW - 1_000,
  lastLocationCallbackAt: NOW - 1_000,
  captureHealth: 'healthy',
  durationMs: 4_215_000,
  fixCount: 4198,
  pressureCount: 0,
  gpsAltitude: 1847,
  speed: 9.7,
  horizontalAccuracy: 4.2,
  pressure: null,
  batteryLevel: 0.62,
  lowPowerMode: false,
  batteryOptimizationEnabled: false,
  taskRegistered: true,
  capabilities: CAPABILITIES,
  lastError: null,
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionLabel>{title}</SectionLabel>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

function KitPreview() {
  const noop = () => undefined;
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      <TopBar onBack={noop} title="Component kit" right={<Chip label="preview" tone="muted" />} />

      <Group title="Buttons">
        <Button label="Primary xl" variant="primary" size="xl" leadingDot onPress={noop} />
        <Button label="Primary lg" variant="primary" size="lg" onPress={noop} />
        <Button label="Secondary" variant="secondary" onPress={noop} />
        <Button label="Ghost" variant="ghost" onPress={noop} />
        <Button label="Dark" variant="dark" onPress={noop} />
        <Button label="Danger" variant="danger" onPress={noop} />
        <Button label="Disabled" variant="secondary" disabled onPress={noop} />
        <Button label="Busy" variant="primary" busy onPress={noop} />
        <LinkButton label="Open Android settings ›" onPress={noop} />
      </Group>

      <Group title="Chips">
        <View style={styles.row}>
          <Chip label="good" tone="good" />
          <Chip label="altitude" tone="altitude" />
          <Chip label="muted" tone="muted" />
        </View>
        <View style={styles.row}>
          <Chip label="warning" tone="warning" />
          <Chip label="danger" tone="danger" />
          <Chip label="thermal" tone="thermal" />
        </View>
      </Group>

      <Group title="State labels">
        <StateLabel label="All good" tone="good" />
        <StateLabel label="Needs attention" tone="warning" />
        <StateLabel label="Blocked" tone="danger" />
        <StateLabel label="Idle" tone="neutral" />
      </Group>

      <Group title="Status pills">
        <View style={styles.row}>
          <StatusPill label="REC" tone="good" emphasis />
          <StatusPill label="GPS stale" tone="warning" />
        </View>
        <View style={styles.row}>
          <StatusPill label="Not running" tone="danger" />
          <StatusPill label="Phone sensors · 62%" tone="neutral" />
        </View>
      </Group>

      <Group title="Surfaces">
        <Card className="p-[14px]">
          <Text style={styles.cardText}>Default card</Text>
        </Card>
        <Card variant="dark" className="p-[14px]">
          <Text style={styles.cardTextOnDark}>Dark card</Text>
        </Card>
        <Card className="p-[14px]">
          <ListRow label="Location services" value="On" tone="good" showDot />
          <ListRow label="Barometer" value="Not available" tone="warning" showDot
            detail="Altitude comes from GPS only." />
          <ListRow label="Battery optimisation" value="Restricted" tone="danger" showDot
            action={{ label: 'Open settings', onPress: noop }} last />
        </Card>
        <Hairline />
      </Group>

      <Group title="Notices">
        <Notice tone="info" title="Information">Body copy for an informational notice.</Notice>
        <Notice tone="good" title="All good">Capture is healthy and fixes are landing.</Notice>
        <Notice tone="warning" title="No valid GPS fix for 12 s">
          Fixes already recorded are safe.
        </Notice>
        <Notice tone="danger" title="That did not work">The recorder could not start.</Notice>
        <BusyRow label="Saving flight…" />
      </Group>

      <Group title="Typography">
        <Text style={styles.cardText}>Body text sample</Text>
        <Disclaimer>Not a certified flight recorder. Never fly with this as your only recorder.</Disclaimer>
      </Group>
    </ScrollView>
  );
}

function InstrumentPreview({ compact }: { compact: boolean }) {
  const noop = () => undefined;
  return (
    <InstrumentView
      snapshot={SNAPSHOT}
      capture={{ label: 'REC', tone: 'good', title: 'Capture healthy', description: '' }}
      notices={
        compact
          ? [
              {
                key: 'stale',
                tone: 'warning',
                title: 'No valid GPS fix for 12 s',
                body: 'Fixes already recorded are safe.',
              },
            ]
          : []
      }
      busyLabel={null}
      actionsDisabled={false}
      errorMessage={null}
      recoveryError={null}
      onBack={noop}
      onStop={noop}
      onRetrySave={noop}
    />
  );
}

export default function PreviewRoute() {
  const { set } = useLocalSearchParams<{ set?: string }>();
  if (set === 'instrument') return <InstrumentPreview compact={false} />;
  if (set === 'instrument-degraded') return <InstrumentPreview compact />;
  return <KitPreview />;
}

const styles = StyleSheet.create({
  kitScreen: { flex: 1, backgroundColor: paper.background },
  kit: { paddingBottom: 40 },
  group: { paddingHorizontal: 18, paddingTop: 22, gap: 10 },
  groupBody: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardText: { fontFamily: fonts.sans, fontSize: 13.5, color: paper.text },
  cardTextOnDark: { fontFamily: fonts.sans, fontSize: 13.5, color: paper.onDark },
});

import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BusyRow,
  Button,
  Card,
  Disclaimer,
  LinkButton,
  ListRow,
  Notice,
  Screen,
  StateLabel,
  TopBar,
} from '@/components/flight-ui';
import { TEST_BUILD_WARNING } from '@/recorder/config';
import type { RecorderSnapshot } from '@/recorder/types';
import {
  readinessRows,
  readinessSummary,
  type ReadinessAction,
} from '@/ui/recorder-presentation';
import { fonts, paper } from '@/ui/theme';

export interface PreflightViewProps {
  snapshot: RecorderSnapshot;
  busyLabel: string | null;
  actionsDisabled: boolean;
  recovering: boolean;
  errorMessage: string | null;
  recoveryError: string | null;
  lastFlightId: string | null;
  onBack: () => void;
  onStart: () => void;
  onOpenLastFlight: (flightId: string) => void;
  onReadinessAction: (action: ReadinessAction) => void;
}

const ACTION_LABELS: Record<ReadinessAction, string> = {
  open_app_settings: 'Open Android settings',
  open_location_settings: 'Open location settings',
  open_battery_settings: 'Battery settings',
};

/** S2 — the pre-flight readiness screen (recorder idle / completed). */
export function PreflightView({
  snapshot,
  busyLabel,
  actionsDisabled,
  recovering,
  errorMessage,
  recoveryError,
  lastFlightId,
  onBack,
  onStart,
  onOpenLastFlight,
  onReadinessAction,
}: PreflightViewProps) {
  const rows = readinessRows(snapshot);
  const summary = readinessSummary(rows);
  const { capabilities } = snapshot;
  const hardBlocked = !capabilities.taskManagerAvailable || !capabilities.locationServicesEnabled;
  const permissionDenied = rows.some(
    (row) => row.tone === 'danger' && row.action === 'open_app_settings',
  );
  const tone =
    summary.level === 'blocked' ? 'danger' : summary.level === 'degraded' ? 'warning' : 'good';
  const startLabel =
    summary.level === 'degraded'
      ? 'Start anyway'
      : permissionDenied
        ? 'Ask for permission again'
        : 'Start recording';

  const seenActions = new Set<ReadinessAction>();
  const actionFor = (row: (typeof rows)[number]) => {
    if (!row.action || seenActions.has(row.action)) return null;
    seenActions.add(row.action);
    const action = row.action;
    return { label: ACTION_LABELS[action], onPress: () => onReadinessAction(action) };
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TopBar onBack={onBack} backLabel="Back to logbook" title="Pre-flight" />

        <View style={styles.headline}>
          <StateLabel label={summary.label} tone={tone} />
          <Text style={styles.title}>{summary.title}</Text>
          <Text style={styles.body}>{summary.body}</Text>
        </View>

        <Card style={styles.card}>
          {rows.map((row, index) => (
            <ListRow
              key={row.key}
              label={row.label}
              value={row.value}
              tone={row.tone}
              showDot
              detail={row.tone === 'good' ? null : row.detail}
              action={actionFor(row)}
              last={index === rows.length - 1}
            />
          ))}
        </Card>

        {errorMessage || recoveryError || snapshot.lastError ? (
          <View style={styles.notices}>
            {errorMessage ? (
              <Notice tone="danger" title="Could not start">
                {errorMessage}
              </Notice>
            ) : null}
            {recoveryError ? (
              <Notice tone="danger" title="Recorder recovery failed">
                {recoveryError}
              </Notice>
            ) : null}
            {snapshot.lastError &&
            !(errorMessage && snapshot.lastError.message.includes(errorMessage)) ? (
              <Notice tone="warning" title="Last recorder message">
                {snapshot.lastError.message}
              </Notice>
            ) : null}
          </View>
        ) : null}

        {lastFlightId && snapshot.state === 'completed' ? (
          <View style={styles.lastFlight}>
            <Text style={styles.lastFlightText}>Your last flight is saved in the logbook.</Text>
            <LinkButton label="Open it ›" onPress={() => onOpenLastFlight(lastFlightId)} />
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.startNote}>
            There is no takeoff detection yet — tap start before you launch and it runs until you
            stop it.
          </Text>
          {hardBlocked ? (
            <Button
              label={
                capabilities.locationServicesEnabled
                  ? 'Background recording unavailable'
                  : ACTION_LABELS.open_location_settings
              }
              variant="dark"
              size="xl"
              disabled={capabilities.locationServicesEnabled}
              onPress={() => onReadinessAction('open_location_settings')}
            />
          ) : (
            <Button
              label={busyLabel ?? startLabel}
              variant="primary"
              size="xl"
              leadingDot={!busyLabel}
              busy={Boolean(busyLabel)}
              disabled={actionsDisabled}
              onPress={onStart}
              accessibilityHint="Starts GPS recording of a new flight"
            />
          )}
          {recovering ? <BusyRow label="Checking recorder health…" /> : null}
          <Disclaimer style={styles.disclaimer}>{TEST_BUILD_WARNING}</Disclaimer>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 28, gap: 12 },
  headline: { paddingHorizontal: 22, paddingTop: 12, gap: 8 },
  title: { fontFamily: fonts.sansBold, fontSize: 27, lineHeight: 32, color: paper.ink, marginTop: 4 },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 21, color: paper.text },
  card: { marginHorizontal: 16, paddingHorizontal: 16, paddingVertical: 2 },
  notices: { marginHorizontal: 16, gap: 8 },
  lastFlight: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  lastFlightText: { fontFamily: fonts.sans, fontSize: 12.5, color: paper.text, flexShrink: 1 },
  footer: { marginTop: 'auto', paddingHorizontal: 20, paddingTop: 18, gap: 12 },
  startNote: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    lineHeight: 17,
    color: paper.muted,
    textAlign: 'center',
  },
  disclaimer: { marginTop: 2 },
});

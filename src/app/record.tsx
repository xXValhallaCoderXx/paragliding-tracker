import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActionButton,
  BackButton,
  BusyRow,
  Card,
  LoadingScreen,
  MetricTile,
  Notice,
  ScreenHeader,
  StatusChip,
  UnsupportedScreen,
  palette,
} from '@/components/flight-ui';
import { useRecorderLifecycle } from '@/components/recorder-lifecycle';
import { TEST_BUILD_WARNING } from '@/recorder/config';
import { recorderService } from '@/recorder/recorder-service';
import type { RecorderSnapshot } from '@/recorder/types';
import { captureAgeLabel, capturePresentation } from '@/ui/capture-health';
import {
  formatAccuracy,
  formatAltitude,
  formatDuration,
  formatGroundSpeed,
} from '@/ui/flight-format';

export default function RecordFlightScreen() {
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const [snapshot, setSnapshot] = useState<RecorderSnapshot | null>(null);
  const [activeFlightId, setActiveFlightId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;
    const unsubscribe = recorderService.subscribe((nextSnapshot) => {
      if (!mounted) return;
      setSnapshot(nextSnapshot);
      if (nextSnapshot.flightId) setActiveFlightId(nextSnapshot.flightId);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const notices = useMemo(() => {
    if (!snapshot) return [];
    const next: { message: string; tone: 'warning' | 'error' }[] = [];
    if (!snapshot.capabilities.taskManagerAvailable) {
      next.push({
        tone: 'error',
        message: 'Background recording is unavailable. Open the installed development build, not Expo Go.',
      });
    }
    if (!snapshot.capabilities.locationServicesEnabled) {
      next.push({ tone: 'error', message: 'Turn on Location in Android settings before starting.' });
    }
    if (snapshot.capabilities.foregroundPermission === 'denied') {
      next.push({ tone: 'error', message: 'Precise location permission is required to record.' });
    }
    if (snapshot.capabilities.backgroundPermission === 'denied') {
      next.push({
        tone: 'error',
        message: 'Allow location all the time so recording can continue with the screen locked.',
      });
    }
    if (snapshot.batteryOptimizationEnabled) {
      next.push({
        tone: 'warning',
        message: 'Android battery optimization may interrupt a long or locked-screen flight.',
      });
    }
    if (snapshot.lastError) {
      next.push({ tone: 'error', message: snapshot.lastError.message });
    }
    return next;
  }, [snapshot]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  function handleBack() {
    if (snapshot?.state !== 'recording') {
      goBack();
      return;
    }
    Alert.alert(
      'Recording will continue',
      'You can return to the flight list without stopping. Come back here when you are ready to stop and save.',
      [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Back to flights', onPress: goBack },
      ],
    );
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setBusy(null);
    }
  }

  async function startRecording() {
    const result = await recorderService.arm();
    setActiveFlightId(result.flightId);
  }

  async function finishRecording() {
    const knownFlightId = snapshot?.flightId ?? activeFlightId;
    await recorderService.stop();
    openFlight(knownFlightId);
  }

  async function finalizePartial() {
    if (!snapshot?.sessionId) return;
    const knownFlightId = snapshot.flightId ?? activeFlightId;
    await recorderService.finalizeInterrupted(snapshot.sessionId);
    openFlight(knownFlightId);
  }

  function openFlight(flightId: string | null) {
    if (!flightId) throw new Error('The flight was saved, but its logbook entry could not be opened.');
    router.replace(`/flights/${flightId}` as Href);
  }

  if (Platform.OS === 'web') return <UnsupportedScreen />;
  if (!snapshot || !recorderLifecycle.ready) {
    return <LoadingScreen label="Opening recorder…" />;
  }

  const isRecording = snapshot.state === 'recording';
  const isInterrupted = snapshot.state === 'interrupted';
  const isStopping = snapshot.state === 'stopping';
  const canStart = snapshot.state === 'idle' || snapshot.state === 'completed';
  const capture = capturePresentation(snapshot);
  const actionsDisabled = Boolean(busy) || recorderLifecycle.recovering;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackButton onPress={handleBack} />
        <ScreenHeader
          eyebrow="FLIGHT RECORDER"
          title={capture.title}
          body={capture.description}
          action={
            <StatusChip
              label={capture.label}
              tone={capture.tone}
            />
          }
        />

        <Notice tone="warning">{TEST_BUILD_WARNING}</Notice>

        <Card style={styles.liveCard}>
          <Text style={styles.elapsedLabel}>Elapsed time</Text>
          <Text style={styles.elapsed}>{formatDuration(snapshot.durationMs)}</Text>
          <View style={styles.metricsGrid}>
            <MetricTile label="GPS fixes" value={String(snapshot.fixCount)} />
            <MetricTile label="Altitude" value={formatAltitude(snapshot.gpsAltitude)} />
            <MetricTile label="Ground speed" value={formatGroundSpeed(snapshot.speed)} />
            <MetricTile label="GPS accuracy" value={formatAccuracy(snapshot.horizontalAccuracy)} />
          </View>
          {isRecording || isInterrupted ? (
            <View style={styles.captureEvidence}>
              <EvidenceRow
                label="Location callback"
                value={captureAgeLabel(snapshot.lastLocationCallbackAt, snapshot.capturedAt)}
              />
              <EvidenceRow
                label="Valid fix received"
                value={captureAgeLabel(snapshot.lastFixReceivedAt, snapshot.capturedAt)}
              />
            </View>
          ) : (
            <Text style={styles.fixStatus}>GPS starts when you begin recording.</Text>
          )}
        </Card>

        {isRecording && capture.tone !== 'good' && capture.tone !== 'neutral' ? (
          <Notice tone={capture.tone === 'danger' ? 'error' : 'warning'}>
            {capture.description}
          </Notice>
        ) : null}
        {isInterrupted ? (
          <Notice tone="warning">
            Resume if you are still flying. If you have landed, save the fixes already recorded as
            a partial flight.
          </Notice>
        ) : null}
        {notices.map((notice, index) => (
          <Notice key={`${notice.message}-${index}`} tone={notice.tone}>
            {notice.message}
          </Notice>
        ))}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}
        {recorderLifecycle.recoveryError ? (
          <Notice tone="error">
            Recorder recovery failed: {recorderLifecycle.recoveryError}
          </Notice>
        ) : null}

        <View style={styles.actions}>
          {canStart ? (
            <ActionButton
              label="Start recording"
              tone="primary"
              disabled={actionsDisabled}
              onPress={() => void runAction('Starting recorder…', startRecording)}
            />
          ) : null}
          {isRecording ? (
            <ActionButton
              label="Stop and save flight"
              tone="danger"
              disabled={actionsDisabled}
              onPress={() =>
                Alert.alert('Stop recording?', 'Use this after you have landed.', [
                  { text: 'Keep recording', style: 'cancel' },
                  {
                    text: 'Stop and save',
                    style: 'destructive',
                    onPress: () => void runAction('Saving flight…', finishRecording),
                  },
                ])
              }
            />
          ) : null}
          {isStopping && !busy ? (
            <ActionButton
              label="Retry saving stopped flight"
              tone="primary"
              disabled={actionsDisabled}
              onPress={() => void runAction('Retrying save…', finishRecording)}
            />
          ) : null}
          {isInterrupted && snapshot.sessionId ? (
            <>
              <ActionButton
                label="Resume recording"
                tone="primary"
                disabled={actionsDisabled}
                onPress={() =>
                  void runAction('Resuming recorder…', () =>
                    recorderService.resume(snapshot.sessionId!),
                  )
                }
              />
              <ActionButton
                label="Save as partial flight"
                tone="danger"
                disabled={actionsDisabled}
                onPress={() =>
                  Alert.alert(
                    'Save partial flight?',
                    'The fixes already recorded will be kept. You cannot resume after finalizing.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Save partial',
                        onPress: () => void runAction('Saving partial flight…', finalizePartial),
                      },
                    ],
                  )
                }
              />
            </>
          ) : null}
        </View>

        {busy ? <BusyRow label={busy} /> : null}
        {!busy && recorderLifecycle.recovering ? (
          <BusyRow label="Checking recorder health…" />
        ) : null}

        <Text style={styles.footer}>
          This alpha records GPS automatically after you press Start. It does not detect takeoff or
          landing, and it is not yet a replacement for a certified or proven flight instrument.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.evidenceRow}>
      <Text style={styles.evidenceLabel}>{label}</Text>
      <Text style={styles.evidenceValue}>{value}</Text>
    </View>
  );
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  liveCard: { alignItems: 'stretch' },
  elapsedLabel: {
    color: '#7890ad',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  elapsed: {
    color: palette.text,
    fontSize: 48,
    fontWeight: '300',
    letterSpacing: 1,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: 6,
  },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 19 },
  fixStatus: { color: palette.textMuted, fontSize: 12, textAlign: 'center', marginTop: 14 },
  captureEvidence: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    marginTop: 15,
    paddingTop: 9,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 5,
  },
  evidenceLabel: { color: palette.textMuted, fontSize: 12 },
  evidenceValue: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  actions: { gap: 10, marginTop: 2 },
  footer: { color: palette.textQuiet, fontSize: 11, lineHeight: 17, marginTop: 6 },
});

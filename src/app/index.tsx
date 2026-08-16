import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TEST_BUILD_WARNING } from '@/recorder/config';
import { recorderService } from '@/recorder/recorder-service';
import type { ExportArtifact, RecorderSnapshot } from '@/recorder/types';
import { deriveRecorderNotices } from '@/recorder/ui-state';

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatValue(value: number | null, digits: number, suffix: string): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}${suffix}`;
}

function StatusPill({ label, good }: { label: string; good: boolean }) {
  return (
    <View style={[styles.pill, good ? styles.pillGood : styles.pillBad]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export default function RecorderScreen() {
  const [snapshot, setSnapshot] = useState<RecorderSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>('recover');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = recorderService.subscribe(setSnapshot);
    void recorderService
      .recover()
      .catch((error: unknown) => {
        setActionMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(null));
    return unsubscribe;
  }, []);

  const notices = useMemo(
    () => (snapshot ? deriveRecorderNotices(snapshot) : []),
    [snapshot],
  );

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setActionMessage(null);
    try {
      await action();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function exportAndShare(kind: ExportArtifact['kind']) {
    if (!snapshot?.sessionId) return;
    const artifact =
      kind === 'igc'
        ? await recorderService.exportIgc(snapshot.sessionId)
        : await recorderService.exportDiagnostics(snapshot.sessionId);
    setActionMessage(
      `${kind === 'igc' ? 'IGC' : 'Diagnostics'} written (${artifact.sha256.slice(0, 12)}…).`,
    );
    await recorderService.shareArtifact(artifact);
  }

  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.unsupported}>
        <Text style={styles.eyebrow}>XC RECORDER LAB</Text>
        <Text style={styles.unsupportedTitle}>Recorder unavailable on web</Text>
        <Text style={styles.unsupportedBody}>
          Use an Android or iOS development build. The web bundle exists only as a buildability check.
        </Text>
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{TEST_BUILD_WARNING}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!snapshot) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#fbbf24" size="large" />
        <Text style={styles.loadingText}>Opening recorder database…</Text>
      </SafeAreaView>
    );
  }

  const capabilities = snapshot.capabilities;
  const canArm = snapshot.state === 'idle' || snapshot.state === 'completed';
  const canExport =
    snapshot.fixCount > 0 &&
    Boolean(snapshot.sessionId) &&
    (snapshot.state === 'completed' || snapshot.state === 'interrupted');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>XC RECORDER LAB</Text>
            <Text style={styles.title}>Feasibility recorder</Text>
          </View>
          <View style={styles.stateBadge}>
            <View
              style={[
                styles.stateDot,
                snapshot.state === 'recording' && styles.stateDotRecording,
              ]}
            />
            <Text style={styles.stateText}>{snapshot.state.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{TEST_BUILD_WARNING}</Text>
        </View>

        <View style={styles.statusRow}>
          <StatusPill
            label={`Precise: ${capabilities.foregroundPermission}`}
            good={capabilities.preciseLocation}
          />
          <StatusPill
            label={`Background: ${capabilities.backgroundPermission}`}
            good={capabilities.backgroundPermission === 'granted'}
          />
          <StatusPill
            label={`GPS: ${capabilities.gpsAvailable === false ? 'off' : 'available'}`}
            good={capabilities.locationServicesEnabled && capabilities.gpsAvailable !== false}
          />
          <StatusPill
            label={`Task: ${snapshot.taskRegistered ? 'registered' : 'absent'}`}
            good={snapshot.taskRegistered === (snapshot.state === 'recording')}
          />
          <StatusPill
            label={`Pressure: ${capabilities.pressureAvailable ? 'available' : 'absent'}`}
            good={capabilities.pressureAvailable}
          />
        </View>

        <View style={styles.primaryCard}>
          <Text style={styles.duration}>{formatDuration(snapshot.durationMs)}</Text>
          <Text style={styles.sessionLabel} numberOfLines={1}>
            {snapshot.sessionId ? `Session ${snapshot.sessionId}` : 'No session'}
          </Text>
          <View style={styles.metricsGrid}>
            <Metric label="GPS fixes" value={String(snapshot.fixCount)} />
            <Metric label="Pressure samples" value={String(snapshot.pressureCount)} />
            <Metric label="Last-fix age" value={formatValue(snapshot.lastFixAt ? Math.max(0, snapshot.capturedAt - snapshot.lastFixAt) / 1000 : null, 0, ' s')} />
            <Metric label="Battery" value={formatValue(snapshot.batteryLevel === null ? null : snapshot.batteryLevel * 100, 0, '%')} />
            <Metric label="GPS altitude" value={formatValue(snapshot.gpsAltitude, 1, ' m')} />
            <Metric label="Speed" value={formatValue(snapshot.speed, 1, ' m/s')} />
            <Metric label="Accuracy" value={formatValue(snapshot.horizontalAccuracy, 1, ' m')} />
            <Metric label="Pressure" value={formatValue(snapshot.pressure, 2, ' hPa')} />
          </View>
        </View>

        {notices.map((notice, index) => (
          <View
            key={`${notice.message}-${index}`}
            style={[
              styles.notice,
              notice.tone === 'error' ? styles.noticeError : styles.noticeWarning,
            ]}>
            <Text style={styles.noticeText}>{notice.message}</Text>
          </View>
        ))}
        {actionMessage ? (
          <View style={[styles.notice, styles.noticeInfo]}>
            <Text style={styles.noticeText}>{actionMessage}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {canArm ? (
            <ActionButton
              label="Arm recorder"
              disabled={Boolean(busy)}
              primary
              onPress={() => runAction('arm', async () => void (await recorderService.arm()))}
            />
          ) : null}
          {snapshot.state === 'recording' ? (
            <ActionButton
              label="Stop recording"
              disabled={Boolean(busy)}
              danger
              onPress={() => runAction('stop', () => recorderService.stop())}
            />
          ) : null}
          {snapshot.state === 'interrupted' && snapshot.sessionId ? (
            <>
              <ActionButton
                label="Resume session"
                disabled={Boolean(busy)}
                primary
                onPress={() =>
                  runAction('resume', () => recorderService.resume(snapshot.sessionId!))
                }
              />
              <ActionButton
                label="Finalize partial"
                disabled={Boolean(busy)}
                danger
                onPress={() =>
                  runAction('finalize', () =>
                    recorderService.finalizeInterrupted(snapshot.sessionId!),
                  )
                }
              />
            </>
          ) : null}
          <ActionButton
            label="Export unsigned IGC"
            disabled={Boolean(busy) || !canExport}
            onPress={() => runAction('export-igc', () => exportAndShare('igc'))}
          />
          <ActionButton
            label="Export diagnostics JSON"
            disabled={Boolean(busy) || !canExport}
            onPress={() => runAction('export-diagnostics', () => exportAndShare('diagnostics'))}
          />
        </View>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#fbbf24" />
            <Text style={styles.busyText}>Working: {busy}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          Pressure continuity with a locked screen is under test. Removing the app from Recents or
          force-stopping it can terminate location capture; committed rows must still survive.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  disabled,
  onPress,
  primary = false,
  danger = false,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        danger && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <Text style={[styles.buttonText, primary && styles.buttonPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07111f' },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: '#fbbf24', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#f8fafc', fontSize: 26, fontWeight: '800', marginTop: 3 },
  stateBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#172033', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 },
  stateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#94a3b8' },
  stateDotRecording: { backgroundColor: '#ef4444' },
  stateText: { color: '#e2e8f0', fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  warningBanner: { backgroundColor: '#7c2d12', borderColor: '#fb923c', borderWidth: 1, borderRadius: 12, padding: 13 },
  warningText: { color: '#ffedd5', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  pillGood: { backgroundColor: '#052e2b', borderColor: '#0f766e' },
  pillBad: { backgroundColor: '#3f1d2e', borderColor: '#9f1239' },
  pillText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  primaryCard: { backgroundColor: '#101b2d', borderColor: '#263653', borderWidth: 1, borderRadius: 18, padding: 18 },
  duration: { color: '#f8fafc', fontSize: 47, fontVariant: ['tabular-nums'], fontWeight: '300', letterSpacing: 1, textAlign: 'center' },
  sessionLabel: { color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 4 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18, gap: 8 },
  metric: { width: '48%', minWidth: 135, flexGrow: 1, backgroundColor: '#0b1424', borderRadius: 11, padding: 12 },
  metricLabel: { color: '#7890ad', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue: { color: '#f1f5f9', fontSize: 19, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  notice: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  noticeError: { backgroundColor: '#3f1720', borderColor: '#be123c' },
  noticeWarning: { backgroundColor: '#3a2c0c', borderColor: '#a16207' },
  noticeInfo: { backgroundColor: '#0c2d48', borderColor: '#0369a1' },
  noticeText: { color: '#e2e8f0', fontSize: 12, lineHeight: 17 },
  actions: { gap: 10, marginTop: 2 },
  button: { alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#526581', backgroundColor: '#17243a', paddingVertical: 14, paddingHorizontal: 18 },
  buttonPrimary: { backgroundColor: '#fbbf24', borderColor: '#fbbf24' },
  buttonDanger: { backgroundColor: '#451a22', borderColor: '#e11d48' },
  buttonDisabled: { opacity: 0.38 },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: '#f8fafc', fontWeight: '800', fontSize: 14 },
  buttonPrimaryText: { color: '#1c1917' },
  busyRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  busyText: { color: '#94a3b8', fontSize: 12 },
  footer: { color: '#64748b', fontSize: 11, lineHeight: 17, marginTop: 5 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#07111f' },
  loadingText: { color: '#cbd5e1', fontSize: 13 },
  unsupported: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 28, backgroundColor: '#07111f' },
  unsupportedTitle: { color: '#f8fafc', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  unsupportedBody: { color: '#94a3b8', fontSize: 15, lineHeight: 23, maxWidth: 560, textAlign: 'center' },
});

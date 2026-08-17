import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { flightRepository } from '@/recorder/flight-repository';
import { recorderService } from '@/recorder/recorder-service';
import type {
  ExportArtifact,
  FlightDetail,
  FlightMetadataPatch,
} from '@/recorder/types';
import {
  flightDisplayName,
  formatAltitude,
  formatDistance,
  formatDuration,
  formatFlightDate,
  formatGap,
  formatGroundSpeed,
  qualityLabel,
} from '@/ui/flight-format';

export default function FlightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [flight, setFlight] = useState<FlightDetail | null>(null);
  const [title, setTitle] = useState('');
  const [site, setSite] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const loadFlight = useCallback(async () => {
    if (Platform.OS === 'web' || !id) return;
    setLoading(true);
    setMessage(null);
    try {
      const nextFlight = await flightRepository.getFlight(id);
      if (!nextFlight) {
        setFlight(null);
        setMessage({ text: 'This flight no longer exists on this phone.', tone: 'error' });
        return;
      }
      setFlight(nextFlight);
      setTitle(nextFlight.title ?? '');
      setSite(nextFlight.site ?? '');
      setNotes(nextFlight.notes ?? '');
    } catch (error) {
      setMessage({ text: messageFrom(error), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void loadFlight();
    }, [loadFlight]),
  );

  const patch = useMemo<FlightMetadataPatch>(
    () => ({ title: optionalText(title), site: optionalText(site), notes: optionalText(notes) }),
    [notes, site, title],
  );
  const dirty = Boolean(
    flight &&
      (patch.title !== flight.title || patch.site !== flight.site || patch.notes !== flight.notes),
  );

  function leaveDetail() {
    const leave = () => {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    };
    if (!dirty) {
      leave();
      return;
    }
    Alert.alert('Discard unsaved changes?', 'Your recorded track will not be affected.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: leave },
    ]);
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ text: messageFrom(error), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails() {
    if (!flight) return;
    await flightRepository.updateFlight(flight.id, patch);
    await loadFlight();
    setMessage({ text: 'Flight details saved.', tone: 'info' });
  }

  async function exportAndShare(kind: ExportArtifact['kind']) {
    if (!flight) return;
    const artifact =
      kind === 'igc'
        ? await recorderService.exportIgc(flight.recordingSessionId)
        : await recorderService.exportDiagnostics(flight.recordingSessionId);
    await recorderService.shareArtifact(artifact);
    setMessage({
      text: kind === 'igc' ? 'IGC export opened in the share sheet.' : 'Diagnostics opened in the share sheet.',
      tone: 'info',
    });
  }

  function confirmDelete() {
    if (!flight) return;
    Alert.alert(
      'Delete this flight permanently?',
      'The recorded track, notes, stats, and generated export files will be removed from this phone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: () =>
            void runAction('Deleting flight…', async () => {
              await flightRepository.deleteFlight(flight.id);
              router.replace('/');
            }),
        },
      ],
    );
  }

  if (Platform.OS === 'web') return <UnsupportedScreen />;
  if (loading && !flight) return <LoadingScreen label="Opening flight…" />;

  if (!flight) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.missingContent}>
          <BackButton onPress={leaveDetail} />
          <Notice tone="error">{message?.text ?? 'Flight not found.'}</Notice>
          <ActionButton label="Back to flights" tone="primary" onPress={() => router.replace('/')} />
        </View>
      </SafeAreaView>
    );
  }

  const metrics = flight.metrics;
  const duration =
    metrics?.durationMs ??
    (flight.endedAt === null ? 0 : Math.max(0, flight.endedAt - flight.startedAt));
  const canDelete = flight.status === 'completed' || flight.status === 'partial';
  const canExportIgc = Boolean(metrics && metrics.fixCount > 0 && canDelete);
  const canExportDiagnostics = canDelete;
  const status = detailStatus(flight);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <BackButton onPress={leaveDetail} />
          <ScreenHeader
            eyebrow="FLIGHT LOG"
            title={flightDisplayName(flight.title, flight.site)}
            body={formatFlightDate(flight.startedAt, flight.timezoneOffsetMinutes)}
            action={<StatusChip label={status.label} tone={status.tone} />}
          />

          {flight.status === 'processing' || !metrics ? (
            <Notice>Flight saved. Its summary stats are still being calculated.</Notice>
          ) : null}
          {flight.status === 'partial' || metrics?.quality === 'partial' ? (
            <Notice tone="warning">
              This is a partial flight. The stats below use only the track points that were saved.
            </Notice>
          ) : null}
          {metrics?.quality === 'gaps' ? (
            <Notice tone="warning">
              This track has timing gaps. Distance and maximum values may be incomplete.
            </Notice>
          ) : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

          <View style={styles.statsGrid}>
            <MetricTile label="Flight time" value={formatDuration(duration)} />
            <MetricTile label="Track distance" value={formatDistance(metrics?.trackDistanceMetres ?? null)} />
            <MetricTile label="Max altitude" value={formatAltitude(metrics?.maxGpsAltitude ?? null)} />
            <MetricTile label="Max ground speed" value={formatGroundSpeed(metrics?.maxGroundSpeed ?? null)} />
            <MetricTile label="Min altitude" value={formatAltitude(metrics?.minGpsAltitude ?? null)} />
            <MetricTile label="GPS fixes" value={metrics ? String(metrics.fixCount) : '—'} />
          </View>

          <Card>
            <Text style={styles.sectionTitle}>About this flight</Text>
            <Text style={styles.sectionBody}>
              These details are optional. Add whatever will help you remember the flight later.
            </Text>
            <View style={styles.form}>
              <Field
                label="Title"
                value={title}
                placeholder="Evening ridge flight"
                maxLength={80}
                onChangeText={setTitle}
              />
              <Field
                label="Site"
                value={site}
                placeholder="Launch or flying site"
                maxLength={120}
                onChangeText={setSite}
              />
              <Field
                label="Notes"
                value={notes}
                placeholder="Conditions, wing, company, or anything memorable"
                maxLength={2_000}
                multiline
                onChangeText={setNotes}
              />
            </View>
            <ActionButton
              label={dirty ? 'Save flight details' : 'Details saved'}
              tone="primary"
              disabled={!dirty || Boolean(busy)}
              onPress={() => void runAction('Saving details…', saveDetails)}
            />
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>Flight file</Text>
            <Text style={styles.sectionBody}>
              Export the recorded track as an unsigned IGC file for your own archive or another
              compatible app.
            </Text>
            <ActionButton
              label={canExportIgc ? 'Export and share IGC' : 'No GPS track to export'}
              disabled={!canExportIgc || Boolean(busy)}
              onPress={() => void runAction('Preparing IGC…', () => exportAndShare('igc'))}
            />
          </Card>

          <View style={styles.advancedSection}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: advancedOpen }}
              onPress={() => setAdvancedOpen((open) => !open)}
              style={({ pressed }) => [styles.advancedToggle, pressed && styles.pressed]}>
              <Text style={styles.advancedTitle}>Advanced diagnostics</Text>
              <Text style={styles.advancedChevron}>{advancedOpen ? '−' : '+'}</Text>
            </Pressable>
            {advancedOpen ? (
              <Card style={styles.advancedCard}>
                <DiagnosticRow label="Track assessment" value={metrics ? qualityLabel(metrics.quality) : 'Pending'} />
                <DiagnosticRow label="Median GPS gap" value={formatGap(metrics?.medianSourceGapMs ?? null)} />
                <DiagnosticRow label="95th percentile gap" value={formatGap(metrics?.p95SourceGapMs ?? null)} />
                <DiagnosticRow label="Longest GPS gap" value={formatGap(metrics?.maxSourceGapMs ?? null)} />
                <DiagnosticRow label="Metrics algorithm" value={metrics ? `v${metrics.algorithmVersion}` : '—'} />
                <DiagnosticRow label="Recorder status" value={flight.session.status} />
                <DiagnosticRow label="Session" value={flight.recordingSessionId} mono />
                <ActionButton
                  label="Export diagnostics JSON"
                  tone="quiet"
                  disabled={!canExportDiagnostics || Boolean(busy)}
                  onPress={() =>
                    void runAction('Preparing diagnostics…', () => exportAndShare('diagnostics'))
                  }
                />
              </Card>
            ) : null}
          </View>

          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>Delete flight</Text>
            <Text style={styles.dangerBody}>
              This permanently removes the local recording. There is no cloud copy to recover.
            </Text>
            <ActionButton
              label={canDelete ? 'Delete flight permanently' : 'Flight cannot be deleted while processing'}
              tone="danger"
              disabled={!canDelete || Boolean(busy)}
              onPress={confirmDelete}
            />
          </View>

          {busy ? <BusyRow label={busy} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  placeholder,
  maxLength,
  multiline = false,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="sentences"
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        selectionColor={palette.amber}
        style={[styles.input, multiline && styles.notesInput]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

function DiagnosticRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.diagnosticRow}>
      <Text style={styles.diagnosticLabel}>{label}</Text>
      <Text style={[styles.diagnosticValue, mono && styles.mono]} selectable={mono}>
        {value}
      </Text>
    </View>
  );
}

function detailStatus(flight: FlightDetail): {
  label: string;
  tone: 'neutral' | 'good' | 'warning' | 'danger';
} {
  if (flight.sessionStatus === 'interrupted') {
    return { label: 'NEEDS ATTENTION', tone: 'danger' };
  }
  if (flight.sessionStatus === 'recording') {
    return { label: 'IN PROGRESS', tone: 'neutral' };
  }
  if (flight.status === 'partial') return { label: 'PARTIAL', tone: 'warning' };
  if (flight.status === 'processing') return { label: 'PROCESSING', tone: 'neutral' };
  if (flight.metrics?.quality === 'no_track') return { label: 'NO TRACK', tone: 'danger' };
  if (flight.metrics?.quality === 'gaps') return { label: 'TRACK GAPS', tone: 'warning' };
  return { label: 'SAVED', tone: 'good' };
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  keyboardView: { flex: 1 },
  content: { padding: 20, paddingBottom: 56, gap: 15 },
  missingContent: { flex: 1, padding: 20, gap: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  sectionBody: { color: palette.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 16 },
  form: { gap: 14, marginBottom: 17 },
  field: { gap: 7 },
  fieldLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  input: {
    minHeight: 48,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surfaceQuiet,
    color: palette.text,
    fontSize: 15,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  notesInput: { minHeight: 116, lineHeight: 21 },
  advancedSection: { gap: 9 },
  advancedToggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  advancedTitle: { color: '#cbd5e1', fontSize: 14, fontWeight: '800' },
  advancedChevron: { color: palette.amber, fontSize: 24, fontWeight: '400' },
  advancedCard: { gap: 0 },
  diagnosticRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
    paddingVertical: 11,
  },
  diagnosticLabel: { flex: 1, color: palette.textMuted, fontSize: 12 },
  diagnosticValue: { flex: 1.2, color: palette.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  mono: { fontFamily: Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' }) },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: palette.errorBorder,
    paddingTop: 18,
    marginTop: 8,
  },
  dangerTitle: { color: '#fecdd3', fontSize: 16, fontWeight: '800' },
  dangerBody: { color: palette.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 14 },
  pressed: { opacity: 0.72 },
});

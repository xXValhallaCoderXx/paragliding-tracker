import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { EvidenceBlock } from '@/components/flight-detail/evidence';
import { FlightHero, type DetailStatus, type SavedContext } from '@/components/flight-detail/hero';
import { MetadataForm, type MetadataFormValues } from '@/components/flight-detail/metadata-form';
import {
  BusyRow,
  Button,
  Card,
  ListRow,
  LoadingScreen,
  Notice,
  Screen,
  SectionLabel,
  TopBar,
  UnsupportedScreen,
} from '@/components/flight-ui';
import { flightRepository } from '@/recorder/flight-repository';
import { recorderService } from '@/recorder/recorder-service';
import type { ExportArtifact, FlightDetail, FlightMetadataPatch } from '@/recorder/types';
import {
  formatAirtime,
  formatDistance,
  formatGroundSpeed,
  formatMetres,
  formatThousands,
} from '@/ui/flight-format';
import { flightInsight, flightInsightText } from '@/ui/logbook';
import { fonts, paper } from '@/ui/theme';

export default function FlightDetailScreen() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const router = useRouter();
  const [flight, setFlight] = useState<FlightDetail | null>(null);
  const [form, setForm] = useState<MetadataFormValues>({ title: '', site: '', notes: '' });
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'danger' } | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const loadFlight = useCallback(async () => {
    if (Platform.OS === 'web' || !id) return;
    setLoading(true);
    setMessage(null);
    try {
      const nextFlight = await flightRepository.getFlight(id);
      if (!nextFlight) {
        setFlight(null);
        setMessage({ text: 'This flight no longer exists on this phone.', tone: 'danger' });
        return;
      }
      setFlight(nextFlight);
      setForm({
        title: nextFlight.title ?? '',
        site: nextFlight.site ?? '',
        notes: nextFlight.notes ?? '',
      });
      try {
        const all = await flightRepository.listFlights();
        const found = flightInsight(nextFlight, all);
        setInsight(found ? flightInsightText(found) : null);
      } catch {
        setInsight(null);
      }
    } catch (error) {
      setMessage({ text: messageFrom(error), tone: 'danger' });
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
    () => ({
      title: optionalText(form.title),
      site: optionalText(form.site),
      notes: optionalText(form.notes),
    }),
    [form],
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
    Alert.alert('Discard unsaved details?', 'Your recorded track is not affected.', [
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
      setMessage({ text: messageFrom(error), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails() {
    if (!flight) return;
    await flightRepository.updateFlight(flight.id, patch);
    await loadFlight();
    setMessage({ text: 'Flight details saved.', tone: 'good' });
  }

  async function exportAndShare(kind: ExportArtifact['kind']) {
    if (!flight) return;
    const artifact =
      kind === 'igc'
        ? await recorderService.exportIgc(flight.recordingSessionId)
        : await recorderService.exportDiagnostics(flight.recordingSessionId);
    await recorderService.shareArtifact(artifact);
    setMessage({
      text:
        kind === 'igc'
          ? 'Unsigned IGC opened in the share sheet.'
          : 'Diagnostics JSON opened in the share sheet.',
      tone: 'good',
    });
  }

  function confirmDelete() {
    if (!flight) return;
    Alert.alert(
      'Delete this flight permanently?',
      'The recorded track, stats, notes, and generated files are removed from this phone. There is no cloud copy, so this cannot be undone.',
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
      <Screen>
        <TopBar onBack={leaveDetail} backLabel="Back to logbook" title="Flight" />
        <View style={styles.missing}>
          <Notice tone="danger" title="Flight not found">
            {message?.text ?? 'This flight is not in the logbook any more.'}
          </Notice>
          <Button label="Back to logbook" variant="dark" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  const metrics = flight.metrics;
  const durationMs =
    metrics?.durationMs ??
    (flight.endedAt === null ? null : Math.max(0, flight.endedAt - flight.startedAt));
  const isOpen = flight.sessionStatus === 'recording' || flight.sessionStatus === 'interrupted';
  const isProcessing = !isOpen && (flight.status === 'processing' || !metrics);
  const isFinished = flight.status === 'completed' || flight.status === 'partial';
  const hasTrack = Boolean(metrics && metrics.fixCount > 0 && metrics.quality !== 'no_track');
  const canExportIgc = isFinished && hasTrack;
  const canExportDiagnostics = isFinished;
  const canDelete = isFinished;
  const status = detailStatus(flight);
  const savedContext: SavedContext =
    saved === 'stopped' || saved === 'partial' ? (saved as SavedContext) : null;
  const heroIsDistance = Boolean(metrics && metrics.trackDistanceMetres > 0);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TopBar onBack={leaveDetail} backLabel="Back to logbook" />

          <FlightHero flight={flight} status={status} saved={savedContext} insight={insight} />

          {isOpen || isProcessing || metrics?.quality !== 'healthy' || message ? (
            <View style={styles.notices}>
              {isOpen ? (
                <Notice tone={flight.sessionStatus === 'interrupted' ? 'danger' : 'info'} title="This flight is still open">
                  {flight.sessionStatus === 'interrupted'
                    ? 'Recording was interrupted. Open the recorder to resume it or save it as a partial flight.'
                    : 'Recording is in progress. Open the recorder to check GPS health or to stop and save.'}
                </Notice>
              ) : null}
              {isOpen ? (
                <Button label="Open recorder" variant="dark" onPress={() => router.push('/record')} />
              ) : null}
              {isProcessing ? (
                <Notice tone="info" title="Finishing the stats">
                  The flight is saved. Its summary stats are still being calculated — pull the
                  logbook to refresh, or come back in a moment.
                </Notice>
              ) : null}
              {!isOpen &&
              savedContext !== 'partial' &&
              (flight.status === 'partial' || metrics?.quality === 'partial') ? (
                <Notice tone="warning" title="Partial flight">
                  Recording was interrupted before you stopped it. Stats cover the recorded part
                  only.
                </Notice>
              ) : null}
              {metrics?.quality === 'gaps' ? (
                <Notice tone="warning" title="Track has timing gaps">
                  Distance and maximum values may be incomplete. The gaps are listed under “How this
                  was recorded”.
                </Notice>
              ) : null}
              {metrics?.quality === 'no_track' ? (
                <Notice tone="danger" title="No usable GPS track">
                  No valid fixes were recorded, so there is nothing to export for this flight.
                </Notice>
              ) : null}
              {message ? (
                <Notice tone={message.tone}>{message.text}</Notice>
              ) : null}
            </View>
          ) : null}

          <Card style={styles.statsCard}>
            {heroIsDistance ? (
              <ListRow label="Airtime" value={durationMs === null ? '—' : formatAirtime(durationMs)} />
            ) : (
              <ListRow label="Track distance" value={formatDistance(metrics?.trackDistanceMetres ?? null)} />
            )}
            <ListRow label="Max altitude" value={formatMetres(metrics?.maxGpsAltitude ?? null)} />
            <ListRow label="Min altitude" value={formatMetres(metrics?.minGpsAltitude ?? null)} />
            <ListRow label="Max ground speed" value={formatGroundSpeed(metrics?.maxGroundSpeed ?? null)} />
            <ListRow label="GPS fixes" value={metrics ? formatThousands(metrics.fixCount) : '—'} last />
          </Card>

          <SectionLabel style={styles.sectionLabel}>About this flight</SectionLabel>
          <MetadataForm
            values={form}
            onChange={setForm}
            dirty={dirty}
            saving={busy === 'Saving details…'}
            disabled={Boolean(busy) && busy !== 'Saving details…'}
            onSave={() => void runAction('Saving details…', saveDetails)}
          />

          <SectionLabel style={styles.sectionLabel}>Recording integrity</SectionLabel>
          <EvidenceBlock
            flight={flight}
            open={evidenceOpen}
            onToggle={() => setEvidenceOpen((open) => !open)}
            exportDisabled={!canExportDiagnostics || Boolean(busy)}
            onExportDiagnostics={() =>
              void runAction('Preparing diagnostics…', () => exportAndShare('diagnostics'))
            }
          />

          <View style={styles.actions}>
            <Button
              label={
                busy === 'Preparing IGC…'
                  ? 'Preparing IGC…'
                  : canExportIgc
                    ? 'Share unsigned IGC file'
                    : isProcessing
                      ? 'IGC available once stats are done'
                      : 'No GPS track to export'
              }
              variant="primary"
              size="lg"
              busy={busy === 'Preparing IGC…'}
              disabled={!canExportIgc || Boolean(busy)}
              onPress={() => void runAction('Preparing IGC…', () => exportAndShare('igc'))}
              accessibilityHint="Opens the Android share sheet with the unsigned IGC file"
            />
            <Text style={styles.actionsNote}>
              Unsigned IGC — fine for your own archive or another app, not valid for competition
              scoring.
            </Text>
          </View>

          {busy && busy !== 'Saving details…' && busy !== 'Preparing IGC…' ? (
            <BusyRow label={busy} />
          ) : null}

          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>Delete flight</Text>
            <Text style={styles.dangerBody}>
              Permanently removes the local recording from this phone. There is no cloud copy to
              recover it from.
            </Text>
            <Button
              label={canDelete ? 'Delete flight permanently' : isOpen ? 'Cannot delete an open flight' : 'Cannot delete while processing'}
              variant="danger"
              disabled={!canDelete || Boolean(busy)}
              onPress={confirmDelete}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function detailStatus(flight: FlightDetail): DetailStatus {
  if (flight.sessionStatus === 'interrupted') return { label: 'Needs attention', tone: 'danger' };
  if (flight.sessionStatus === 'recording') return { label: 'In progress', tone: 'muted' };
  if (flight.status === 'partial') return { label: 'Partial', tone: 'warning' };
  if (flight.status === 'processing' || !flight.metrics) return { label: 'Processing', tone: 'muted' };
  if (flight.metrics.quality === 'no_track') return { label: 'No track', tone: 'danger' };
  if (flight.metrics.quality === 'gaps') return { label: 'Track gaps', tone: 'warning' };
  return { label: 'Good track', tone: 'good' };
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 40 },
  missing: { padding: 16, gap: 12 },
  notices: { marginHorizontal: 16, marginTop: 10, gap: 8 },
  statsCard: { marginHorizontal: 16, marginTop: 14, paddingHorizontal: 16 },
  sectionLabel: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8 },
  actions: { marginHorizontal: 16, marginTop: 20, gap: 10 },
  actionsNote: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: paper.muted,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  dangerZone: {
    marginHorizontal: 16,
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: paper.dangerBorder,
    gap: 8,
  },
  dangerTitle: { fontFamily: fonts.sansSemi, fontSize: 14, color: paper.danger },
  dangerBody: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: paper.text, marginBottom: 6 },
});

import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCloudAuth } from '@/features/account/auth-provider';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import { EvidenceBlock } from '@/features/flights/components/evidence';
import { FlightHero, type DetailStatus, type SavedContext } from '@/features/flights/components/hero';
import { MetadataForm, type MetadataFormValues } from '@/features/flights/components/metadata-form';
import {
  BusyRow,
  Button,
  LoadingScreen,
  Notice,
  Screen,
  SectionLabel,
  TopBar,
} from '@/components/ui';
import { recorderService } from '@/recorder/recorder-service';
import type { ExportArtifact, FlightDetail, FlightMetadataPatch } from '@/recorder/types';
import {
  useDeleteFlightMutation,
  useGetFlightQuery,
  useGetFlightTrackQuery,
  useGetFlightsQuery,
  useUpdateFlightMutation,
} from '@/store/endpoints';
import {
  formatAirtime,
  formatDistanceParts,
  formatGroundSpeed,
  formatMetres,
  formatThousands,
} from '@/lib/format/flight-format';
import { removalGuidance } from '@/features/logbook/guest-capacity';
import { flightInsight, flightInsightText, isFlightProcessing } from '@/features/logbook/logbook';
import { StatGrid } from '@/features/flights/components/stat-grid';
import { TrackPlate } from '@/features/flights/components/track-plate';
import {
  trackPlateAccessibilityLabel,
  trackPlateLabels,
  trackPlateState,
} from '@/features/flights/track-presentation';
import { straightLineMetres } from '@/lib/track/stats';
import type { TrackSegments } from '@/lib/track/types';
import { fonts, paper } from '@/ui/theme';

/** Stable identity, so a default `[]` does not invalidate the plate memo every render. */
const EMPTY_TRACK: TrackSegments = [];

export default function FlightDetailScreen() {
  const { id, saved, intent } = useLocalSearchParams<{
    id: string;
    saved?: string;
    intent?: string;
  }>();
  const router = useRouter();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  // Whether this flight has a copy anywhere but this phone, which changes what the
  // delete confirmation is honestly able to promise.
  const backedUp = auth.status === 'signed_in';
  const [form, setForm] = useState<MetadataFormValues>({
    title: '',
    site: '',
    notes: '',
    siteSource: null,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'danger' } | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const skip = !id;
  const { data: flight = null, isLoading: loading } = useGetFlightQuery(id!, { skip });
  // Its own cache entry, so editing a title does not re-read and re-parse the geometry.
  // This is also the only read that derives a track for a flight recorded before the plate
  // existed, or whose stored shape is at an older algorithm version.
  const { data: track = EMPTY_TRACK } = useGetFlightTrackQuery(id!, { skip });
  // The insight sentence needs the rest of the logbook to rank this flight against. This
  // used to be a second, serial full-table read on every open; it is now the same cache
  // entry the logbook already holds, so arriving from the logbook costs nothing.
  const { data: allFlights } = useGetFlightsQuery(undefined, { skip });
  const [updateFlight] = useUpdateFlightMutation();
  const [deleteFlight] = useDeleteFlightMutation();

  const insight = useMemo(() => {
    if (!flight || !allFlights) return null;
    const found = flightInsight(flight, allFlights);
    return found ? flightInsightText(found) : null;
  }, [flight, allFlights]);

  // Seed the form from whatever the cache holds, and re-seed if the flight changes
  // underneath us — a remote pull can rewrite title/site/notes.
  const [seededId, setSeededId] = useState<string | null>(null);
  const [seededAt, setSeededAt] = useState<number | null>(null);
  if (flight && (seededId !== flight.id || seededAt !== flight.updatedAt)) {
    setSeededId(flight.id);
    setSeededAt(flight.updatedAt);
    setForm({
      title: flight.title ?? '',
      site: flight.site ?? '',
      notes: flight.notes ?? '',
      siteSource: flight.siteSource,
    });
  }

  const patch = useMemo<FlightMetadataPatch>(
    () => ({
      title: optionalText(form.title),
      site: optionalText(form.site),
      notes: optionalText(form.notes),
      siteSource: optionalText(form.site) === null ? null : form.siteSource,
    }),
    [form],
  );
  // siteSource is compared too: picking a launch whose name matches what was already
  // typed changes only the provenance, and without this the Save button would never
  // appear and the credit would never be recorded.
  const dirty = Boolean(
    flight &&
      (patch.title !== flight.title ||
        patch.site !== flight.site ||
        patch.notes !== flight.notes ||
        (patch.siteSource ?? null) !== flight.siteSource),
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
    // The mutation invalidates this flight and the list, so the logbook, account and
    // settings screens all refresh themselves. No manual reload here any more.
    await updateFlight({ flightId: flight.id, patch }).unwrap();
    setMessage({ text: 'Flight details saved.', tone: 'good' });
    // The edit bumped flights.updated_at, which is what makes it dirty for backup.
    sync.requestSync('post-save');
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
      backedUp
        ? 'The recorded track, stats, notes, and generated files are removed from this phone, and the backed-up copy is removed from your account. This cannot be undone.'
        : 'The recorded track, stats, notes, and generated files are removed from this phone. There is no cloud copy, so this cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: () =>
            void runAction('Deleting flight…', async () => {
              await deleteFlight(flight.id).unwrap();
              // The delete left a tombstone; push it before the pilot forgets about it.
              sync.requestSync('post-save');
              router.replace('/');
            }),
        },
      ],
    );
  }

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
  const isProcessing = !isOpen && isFlightProcessing(flight);
  const isFinished = flight.status === 'completed' || flight.status === 'partial';
  const hasTrack = Boolean(metrics && metrics.fixCount > 0 && metrics.quality !== 'no_track');
  const canExportIgc = isFinished && hasTrack;
  const canExportDiagnostics = isFinished;
  const canDelete = isFinished;
  const status = detailStatus(flight);
  const savedContext: SavedContext =
    saved === 'stopped' || saved === 'partial' ? (saved as SavedContext) : null;
  // Only once the flight is actually deletable: pointing a pilot at a delete button the
  // repository would refuse is the failure the capacity banner exists to avoid.
  const removing = intent === 'remove' && canDelete ? removalGuidance(flight) : null;
  const heroIsDistance = Boolean(metrics && metrics.trackDistanceMetres > 0);

  const plateState = trackPlateState(flight, track);
  const plateLabels = trackPlateLabels(flight);
  const straightLine = straightLineMetres(track);
  const distanceParts = formatDistanceParts(metrics?.trackDistanceMetres ?? null);
  const straightParts = formatDistanceParts(straightLine);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TopBar onBack={leaveDetail} backLabel="Back to logbook" />

          {/*
            Full bleed, above everything. The ScrollView carries no horizontal padding of
            its own — every child sets its own — so the plate reaches both edges without
            anything else moving.
          */}
          <TrackPlate
            segments={track}
            variant="hero"
            state={plateState}
            takeoffLabel={plateLabels.takeoff}
            landingLabel={plateLabels.landing}
            describe={(plate) => trackPlateAccessibilityLabel(flight, plate)}
          />

          <FlightHero flight={flight} status={status} saved={savedContext} insight={insight} />

          {isOpen || isProcessing || metrics?.quality !== 'healthy' || message || removing ? (
            <View style={styles.notices}>
              {removing ? (
                // The pilot arrived from the logbook's capacity banner. Say why they are
                // here and point at the export, but never open the delete dialog for
                // them — an unexpected destructive prompt on arrival is worse than the
                // banner that sent them.
                <Notice tone="warning" title={removing.title}>
                  {removing.body}
                </Notice>
              ) : null}
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

          {/*
            The hero already shows whichever of airtime and distance is the headline, so the
            grid takes the other one. Six cells either way, and nothing is stated twice.
          */}
          <StatGrid
            cells={[
              heroIsDistance
                ? { label: 'Airtime', value: durationMs === null ? '—' : formatAirtime(durationMs) }
                : {
                    label: 'Track distance',
                    value: distanceParts?.value ?? '—',
                    unit: distanceParts?.unit ?? null,
                  },
              // Launch to landing, which is not the same number as distance flown — a day
              // spent on one ridge can fly fifty kilometres and land where it started.
              {
                label: 'Straight line',
                value: straightParts?.value ?? '—',
                unit: straightParts?.unit ?? null,
              },
              { label: 'Max altitude', value: formatMetres(metrics?.maxGpsAltitude ?? null) },
              { label: 'Min altitude', value: formatMetres(metrics?.minGpsAltitude ?? null) },
              { label: 'Max ground speed', value: formatGroundSpeed(metrics?.maxGroundSpeed ?? null) },
              { label: 'GPS fixes', value: metrics ? formatThousands(metrics.fixCount) : '—' },
            ]}
          />

          <SectionLabel className="px-[18px] pt-[20px] pb-[8px]">About this flight</SectionLabel>
          <MetadataForm
            // Where this flight actually launched, so the nearby list is about the launch
            // rather than about wherever the phone happens to be days later.
            takeoff={
              flight.takeoffLatitude !== null && flight.takeoffLongitude !== null
                ? { latitude: flight.takeoffLatitude, longitude: flight.takeoffLongitude }
                : null
            }
            values={form}
            onChange={setForm}
            dirty={dirty}
            saving={busy === 'Saving details…'}
            disabled={Boolean(busy) && busy !== 'Saving details…'}
            onSave={() => void runAction('Saving details…', saveDetails)}
          />

          <SectionLabel className="px-[18px] pt-[20px] pb-[8px]">Recording integrity</SectionLabel>
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
              {backedUp
                ? 'Permanently removes the recording from this phone and from your account. There is no other copy to recover it from.'
                : 'Permanently removes the local recording from this phone. There is no cloud copy to recover it from.'}
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

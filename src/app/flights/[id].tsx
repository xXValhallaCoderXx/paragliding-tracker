import { useMemo, useState } from 'react';
import {
  Alert,
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
import { MetadataSheet } from '@/features/flights/components/metadata-sheet';
import { siteAttribution } from '@/features/flights/site-picker';
import { JournalArt } from '@/components/ui/journal-art';
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
import { errorMessage } from '@/lib/format/error-message';
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
  const { id, saved } = useLocalSearchParams<{
    id: string;
    saved?: string;
  }>();
  const router = useRouter();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  // Authentication enables sync; it does not prove a flight has uploaded.
  const signedIn = auth.status === 'signed_in';
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'danger' } | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const skip = !id;
  const { data: flight = null, isLoading: loading, error: loadError, refetch } = useGetFlightQuery(id!, { skip });
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

  function leaveDetail() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails(patch: FlightMetadataPatch) {
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
      signedIn
        ? 'The track, stats, notes and generated files are deleted locally. Deletion of any account copy is queued for sync. This cannot be undone.'
        : 'The track, stats, notes and generated files are deleted locally. Any account deletion must sync when you reconnect. Export anything you want to keep first.',
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
          <Notice tone="danger" title={loadError ? 'Could not open flight' : 'Flight not found'}>
            {loadError ? errorMessage(loadError) : 'This flight is not in the logbook any more.'}
          </Notice>
          {loadError ? <Button label="Try again" variant="primary" onPress={() => void refetch()} /> : null}
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
  const canReview = isFinished && !isOpen && !isProcessing;
  const canExportIgc = canReview && hasTrack;
  const canExportDiagnostics = canReview;
  const canDelete = canReview;
  const status = detailStatus(flight);
  const savedContext: SavedContext =
    saved === 'stopped' || saved === 'partial' ? (saved as SavedContext) : null;
  const heroIsDistance = Boolean(metrics && metrics.trackDistanceMetres > 0);

  const plateState = trackPlateState(flight, track);
  const plateLabels = trackPlateLabels(flight);
  const straightLine = straightLineMetres(track);
  const distanceParts = formatDistanceParts(metrics?.trackDistanceMetres ?? null);
  const straightParts = formatDistanceParts(straightLine);

  return (
    <Screen>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TopBar onBack={leaveDetail} backLabel="Back to logbook" />

          <FlightHero flight={flight} status={status} saved={savedContext} insight={insight} />
          <View style={styles.route}>
          <TrackPlate
            segments={track}
            variant="hero"
            state={plateState}
            takeoffLabel={plateLabels.takeoff}
            landingLabel={plateLabels.landing}
            describe={(plate) => trackPlateAccessibilityLabel(flight, plate)}
          />

          </View>
          {canReview ? (
            <View style={styles.actions}>
              <Button label="Replay flight" variant="primary" size="xl" disabled={Boolean(busy)}
                onPress={() => router.push({ pathname: '/flights/[id]/replay', params: { id: flight.id } })} />
            </View>
          ) : null}

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

          <View style={styles.journalNote}>
            <SectionLabel>From your journal</SectionLabel>
            <Text style={styles.notes}>{flight.notes?.trim() || 'A place for the moments the instruments missed.'}</Text>
            {flight.siteSource === 'paraglidingearth' || flight.siteSource === 'osm' ? (
              <Text style={styles.actionsNote}>{siteAttribution(flight.siteSource)}</Text>
            ) : null}
            <Button label="Edit flight" disabled={Boolean(busy)} onPress={() => setEditing(true)} />
          </View>
          {savedContext ? <View style={styles.actions}><JournalArt scene="landing" height={140} /></View> : null}

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
                    : isOpen
                      ? 'IGC available after saving flight'
                      : isProcessing
                        ? 'IGC available once stats are done'
                        : 'No GPS track to export'
              }
              variant="secondary"
              size="lg"
              busy={busy === 'Preparing IGC…'}
              disabled={!canExportIgc || Boolean(busy)}
              onPress={() => void runAction('Preparing IGC…', () => exportAndShare('igc'))}
              accessibilityHint="Opens the share sheet with the unsigned IGC file"
            />
            <Text style={styles.actionsNote}>
              Unsigned IGC — fine for your own archive or another app, not valid for competition
              scoring.
            </Text>
          </View>

          {busy && busy !== 'Preparing IGC…' ? (
            <BusyRow label={busy} />
          ) : null}

          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>Delete flight</Text>
            <Text style={styles.dangerBody}>
              {signedIn
                ? 'Removes the local recording and queues deletion of any account copy. Export anything you want to keep first.'
                : 'Removes the local recording. If previously backed up, deletion must sync when you reconnect.'}
            </Text>
            <Button
              label={canDelete ? 'Delete flight permanently' : isOpen ? 'Cannot delete an open flight' : 'Cannot delete while processing'}
              variant="danger"
              disabled={!canDelete || Boolean(busy)}
              onPress={confirmDelete}
            />
          </View>
        </ScrollView>
      {editing ? <MetadataSheet key={flight.id} flight={flight} onClose={() => setEditing(false)} onSave={saveDetails} /> : null}
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

const styles = StyleSheet.create({
  route: { margin: 18, overflow: 'hidden', borderRadius: 22 },
  journalNote: { margin: 18, padding: 20, borderRadius: 22, backgroundColor: paper.card, gap: 14 },
  notes: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 25, color: paper.text },
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

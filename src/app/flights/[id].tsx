import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCloudAuth } from '@/features/account/auth-provider';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import { BusyRow, Button, LoadingScreen, Notice, Screen, SectionLabel, TopBar } from '@/components/ui';
import { EvidenceBlock } from '@/features/flights/components/evidence';
import { MetadataSheet } from '@/features/flights/components/metadata-sheet';
import { MetadataForm } from '@/features/flights/components/metadata-form';
import { MetadataConflict } from '@/features/flights/components/metadata-conflict';
import { OwnFlightHero } from '@/features/flights/components/own-flight-hero';
import { OwnFlightStats } from '@/features/flights/components/own-flight-stats';
import { CapturedAircraft } from '@/features/flights/components/captured-aircraft';
import { FlightActionsSheet } from '@/features/flights/components/flight-actions-sheet';
import { FlightMapPreview } from '@/features/flights/components/flight-map-preview';
import { archivedRouteMessage, trackPlateAccessibilityLabel, trackPlateState } from '@/features/flights/track-presentation';
import { ownFlightAvailability, ownFlightInsight, ownFlightMetrics, recordingCoordinate } from '@/features/flights/own-flight-presentation';
import { useFlightDraft } from '@/features/flights/use-flight-draft';
import { siteAttribution } from '@/features/flights/site-picker';
import { PostcardComposer } from '@/features/postcard/postcard-composer';
import { canSharePostcard } from '@/features/postcard/presentation';
import { FlightSharingSection, type FlightSharingEntry } from '@/features/feed/flight-sharing-section';
import { recorderService } from '@/recorder/recorder-service';
import { shareArchivedIgc } from '@/journal/artifacts';
import type { ExportArtifact, FlightDetail, FlightSummary } from '@/recorder/types';
import { useDeleteFlightMutation, useGetFlightQuery, useGetFlightTrackQuery, useGetFlightsQuery, useUpdateFlightMutation } from '@/store/endpoints';
import { formatClockTime } from '@/lib/format/flight-format';
import { errorMessage } from '@/lib/format/error-message';
import { flightMutationGuard, type FlightUpdateRequest } from '@/lib/flight-mutations';
import { assertFlightScope, flightScopeRevision, subscribeFlightScope } from '@/lib/flight-scope';
import type { TrackSegments } from '@/lib/track/types';

const EMPTY_TRACK: TrackSegments = [];
const EMPTY_FLIGHTS: FlightSummary[] = [];

export default function FlightDetailScreen() {
  const { id, saved } = useLocalSearchParams<{ id: string; saved?: string }>();
  const revision = useSyncExternalStore(subscribeFlightScope, flightScopeRevision, flightScopeRevision);
  return <FlightRoute key={`${id}:${revision}`} id={id} saved={saved} />;
}

function FlightRoute({ id, saved }: { id: string; saved?: string }) {
  const router = useRouter();
  const [handoff] = useState(saved === 'stopped' || saved === 'partial');
  const query = useGetFlightQuery(id, { skip: !id });
  const { data: track = EMPTY_TRACK } = useGetFlightTrackQuery(id, { skip: !id });
  const { data: catalogue = EMPTY_FLIGHTS } = useGetFlightsQuery(undefined, { skip: !id });
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };
  if (query.isLoading && !query.data) return <LoadingScreen label="Opening flight…" />;
  if (!query.data) return <Screen>
    <TopBar title="Flight" onBack={back} backLabel="Back to Home" />
    <View className="gap-[14px] p-[18px]">
      <Notice tone="danger" title={query.error ? 'Could not open flight' : 'Flight not found'}>{query.error ? errorMessage(query.error) : 'This flight is no longer in your logbook.'}</Notice>
      {query.error ? <Button label="Try again" onPress={() => void query.refetch()} /> : null}
      <Button label="Back to Home" onPress={() => router.replace('/')} />
    </View>
  </Screen>;
  return <FlightContent flight={query.data} track={track} catalogue={catalogue} handoff={handoff} />;
}

function FlightContent({ flight: stored, track, catalogue, handoff }: { flight: FlightDetail; track: TrackSegments; catalogue: FlightSummary[]; handoff: boolean }) {
  const router = useRouter();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [updateFlight] = useUpdateFlightMutation();
  const [deleteFlight] = useDeleteFlightMutation();
  const [committed, setCommitted] = useState<FlightDetail | null>(null);
  const flight = committed && committed.updatedAt >= stored.updatedAt ? committed : stored;
  const availability = ownFlightAvailability(flight);
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const summary = handoff && !summaryDismissed && availability.finished && flight.source !== 'archive';
  const [guard] = useState(() => flightMutationGuard(flight));
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState<number | null>(null);
  const [postcardOpen, setPostcardOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const active = useRef(true);
  const generation = useRef(0);
  const actionsVisit = useRef(0);
  const confirmation = useRef(false);
  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => {
      active.current = false; generation.current += 1; actionsVisit.current += 1;
      setActionsOpen(null); setEditing(false); setPostcardOpen(false); setSummaryDismissed(true);
    };
  }, [setActionsOpen, setEditing, setPostcardOpen, setSummaryDismissed]));
  const current = () => {
    if (!active.current) return false;
    try { assertFlightScope(guard.scope); return true; } catch { return false; }
  };
  useEffect(() => { if (summary) router.setParams({ saved: undefined }); }, [router, summary]);
  const requestSync = () => { try { sync.requestSync('post-save'); } catch { /* Persistence already committed; normal sync can retry. */ } };
  const exclusive = async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
    if (locked.current || !current()) throw new Error('Another action is finishing, or this flight is no longer open.');
    locked.current = true; setBusy(label); setMessage(null);
    try { return await action(); }
    finally { locked.current = false; if (current()) setBusy(null); }
  };
  const saveDetails = (request: FlightUpdateRequest) => exclusive('Saving details…', async () => {
    const saved = await updateFlight(request).unwrap();
    requestSync();
    if (current()) setCommitted(saved);
    return saved;
  });
  const editor = useFlightDraft(flight, saveDetails);
  const home = () => { if (current()) { Keyboard.dismiss(); generation.current += 1; router.replace('/'); } };
  const leave = () => {
    if (!current() || locked.current || confirmation.current) return;
    if (!summary) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    if (!editor.dirty) { home(); return; }
    const visit = generation.current; confirmation.current = true;
    Alert.alert('Discard unsaved details?', 'The saved flight stays in your logbook. Only these unsaved title or site changes will be discarded.', [
      { text: 'Keep editing', style: 'cancel', onPress: () => { confirmation.current = false; } },
      { text: 'Discard', style: 'destructive', onPress: () => {
        confirmation.current = false; if (visit === generation.current) home();
      } },
    ], { cancelable: true, onDismiss: () => { confirmation.current = false; } });
  };
  useFocusEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) { Keyboard.dismiss(); return true; }
      if (!summary && !locked.current) return false;
      leave(); return true;
    });
    return () => subscription.remove();
  });
  const done = async () => { if (await editor.save()) home(); };
  const beforeSharing = (proceed: () => void) => {
    if (!current() || locked.current || confirmation.current) return;
    const visit = generation.current;
    const continueIfCurrent = () => { if (current() && generation.current === visit) proceed(); };
    if (!summary || !editor.dirty) { continueIfCurrent(); return; }
    confirmation.current = true;
    Alert.alert('Save your details first?', 'Save this title and site before continuing. Sharing still needs your separate confirmation.', [
      { text: 'Keep editing', style: 'cancel', onPress: () => { confirmation.current = false; } },
      { text: 'Save details and continue', onPress: () => {
        confirmation.current = false;
        if (!current() || generation.current !== visit) return;
        void editor.save().then(saved => { if (saved) continueIfCurrent(); });
      } },
    ], { cancelable: true, onDismiss: () => { confirmation.current = false; } });
  };
  const runAction = async (label: string, operation: () => Promise<void>) => {
    const visit = generation.current;
    try { await exclusive(label, operation); }
    catch (error) { if (current() && visit === generation.current) setMessage(errorMessage(error)); }
  };
  const exportAndShare = async (kind: ExportArtifact['kind']) => {
    if (flight.source === 'archive') { await shareArchivedIgc(flight.id, guard.scope); return; }
    const artifact = kind === 'igc' ? await recorderService.exportIgc(flight.recordingSessionId) : await recorderService.exportDiagnostics(flight.recordingSessionId);
    if (!current()) return;
    await recorderService.shareArtifact(artifact);
  };
  const confirmDelete = () => {
    if (!availability.finished || !current() || locked.current || confirmation.current) return;
    const visit = generation.current; confirmation.current = true;
    Alert.alert('Delete this flight permanently?', 'This removes the flight and its recording from this phone immediately. Backup deletion and Hide from friends take effect only after the server confirms them during sync. While offline, friends may still see an already shared flight. Export anything you want to keep first.', [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirmation.current = false; } },
      { text: 'Delete permanently', style: 'destructive', onPress: () => {
        confirmation.current = false;
        if (!current() || generation.current !== visit) return;
        void runAction('Deleting flight…', async () => {
          await deleteFlight(guard).unwrap(); requestSync(); home();
        });
      } },
    ], { cancelable: true, onDismiss: () => { confirmation.current = false; } });
  };
  const closeActions = () => { actionsVisit.current += 1; setActionsOpen(null); };
  const renderActions = (sharing: FlightSharingEntry) => {
    if (!actionsOpen) return null;
    const visit = actionsOpen;
    const choose = (action: () => void) => () => {
      if (!current() || locked.current || visit !== actionsVisit.current) return;
      closeActions(); action();
    };
    return <FlightActionsSheet onClose={closeActions} actions={[
      { ...sharing, onPress: choose(sharing.onPress) },
      { label: 'Edit title, site and notes', reason: availability.editReason, onPress: choose(() => beforeSharing(() => setEditing(true))) },
      { label: 'Replay flight', reason: availability.replayReason, onPress: choose(() => beforeSharing(() => router.push({ pathname: '/flights/[id]/replay', params: { id: flight.id } }))) },
      { label: 'Share postcard', reason: canSharePostcard(flight) && availability.finished ? null : 'Postcards need a finished flight with saved statistics.', onPress: choose(() => beforeSharing(() => setPostcardOpen(true))) },
      { label: flight.source === 'archive' ? 'Share original archived IGC' : 'Share unsigned IGC file', reason: availability.igcReason,
        onPress: choose(() => void runAction('Preparing IGC…', () => exportAndShare('igc'))) },
      { label: 'Delete flight', danger: true, reason: availability.editReason, onPress: choose(confirmDelete) },
    ]} />;
  };
  const measurements = ownFlightMetrics(flight);
  const shareable = availability.finished && flight.metrics !== null;
  const credit = siteAttribution(flight.siteSource);
  return <Screen>
    <TopBar title={summary ? 'Saved flight' : 'Your flight'} onBack={leave} backLabel={summary ? 'Close saved flight' : 'Back to Home'} right={
      <Button label="Flight actions" disabled={Boolean(busy)} onPress={() => { if (!locked.current && current()) { actionsVisit.current += 1; setActionsOpen(actionsVisit.current); } }} />
    } />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={{ paddingBottom: 36, gap: 20 }} keyboardShouldPersistTaps="handled">
        <OwnFlightHero flight={flight} saved={summary} insight={ownFlightInsight(flight, catalogue)} />
        {message ? <View className="px-[18px]"><Notice tone="danger" title="Action needs attention">{message}</Notice></View> : null}
        {availability.open || availability.processing ? <View className="gap-[12px] px-[18px]">
          <Notice title={availability.open ? 'This flight is still open' : 'Finishing the stats'}>{availability.open ? 'Open the recorder to resume an interrupted recording or to stop and save.' : 'The stored recording is still being processed. Return Home to refresh and retry processing.'}</Notice>
          <Button label={availability.open ? 'Open recorder' : 'Back to Home'} onPress={() => availability.open ? router.push('/record') : home()} />
        </View> : null}
        <View className="px-[18px]">
          {flight.source === 'archive' && track.length === 0 ? <Notice>{archivedRouteMessage(flight)}</Notice> : <FlightMapPreview segments={track} variant="hero"
            state={trackPlateState(flight, track)} takeoffLabel={`START ${formatClockTime(flight.startedAt, flight.timezoneOffsetMinutes)}`}
            landingLabel={flight.endedAt === null ? null : `STOP ${formatClockTime(flight.endedAt, flight.timezoneOffsetMinutes)}`}
            describe={plate => trackPlateAccessibilityLabel(flight, plate)} />}
        </View>
        {flight.source === 'archive' && flight.archive.trackState !== 'ready' ? <View className="gap-[10px] px-[18px]">
          <Notice title={flight.archive.downloadedAt !== null ? 'Archive update waiting' : flight.archive.trackState === 'missing' ? 'No archived route' : 'Archived route not ready'}>
            {flight.archive.downloadedAt !== null ? 'The previously verified route remains available for replay and original IGC sharing.' : flight.archive.error ?? 'The saved summary and private notes remain available. Manage route restoration in Pilot.'}
          </Notice>
          {flight.archive.trackState === 'error' && auth.status === 'signed_in' ? <Button label="Retry archived route" onPress={() => sync.retryRestore({ allowMobileData: false })} /> : null}
          <Button label="Open restoration settings" onPress={() => router.push('/account')} />
        </View> : null}
        <OwnFlightStats flight={flight} track={track} />
        {availability.finished ? <View className="gap-[8px] px-[18px]">
          <Button label="Replay flight" variant="primary" size="xl" disabled={Boolean(busy) || Boolean(availability.replayReason)}
            onPress={() => beforeSharing(() => router.push({ pathname: '/flights/[id]/replay', params: { id: flight.id } }))} />
          {availability.replayReason ? <Text className="font-body text-[12px] text-muted">{availability.replayReason}</Text> : null}
        </View> : null}
        {summary ? <View className="gap-[12px] px-[18px]">
          <SectionLabel>Make it yours · optional</SectionLabel>
          <MetadataConflict editor={editor} />
          <MetadataForm quick values={editor.draft} onChange={editor.setDraft} dirty={editor.dirty} saving={editor.saving} onSave={() => void done()}
            disabled={Boolean(busy)} takeoff={recordingCoordinate(flight)} />
        </View> : null}
        {shareable ? <FlightSharingSection flightId={flight.id} preview={{ title: flight.title, site: flight.site, startedAt: flight.startedAt,
          timezoneOffsetMinutes: flight.timezoneOffsetMinutes, durationMs: flight.metrics!.durationMs, distanceMetres: measurements.distanceMetres, routePreview: track }}
          blocked={Boolean(busy)} beforeOpen={beforeSharing} runExclusive={action => exclusive('Updating sharing…', action)} extraActions={renderActions} />
          : <UnavailableSharingActions renderActions={renderActions} />}
        <View className="px-[18px]"><CapturedAircraft flight={flight} /></View>
        {!summary ? <View className="gap-[10px] px-[18px]">
          <SectionLabel>Private notes</SectionLabel>
          <Text className="font-body text-[16px] leading-[24px] text-ink">{flight.notes?.trim() || 'A place for the moments the instruments missed.'}</Text>
          {credit ? <Text className="font-body text-[12px] text-muted">{credit}</Text> : null}
          <Button label="Edit flight" disabled={Boolean(busy) || Boolean(availability.editReason)} onPress={() => { if (current() && !locked.current) setEditing(true); }} />
        </View> : null}
        <View className="gap-[10px]">
          <SectionLabel className="px-[18px]">Recording evidence</SectionLabel>
          <EvidenceBlock flight={flight} open={evidenceOpen} onToggle={() => setEvidenceOpen(!evidenceOpen)} exportDisabled={!availability.diagnostics || Boolean(busy)}
            onExportDiagnostics={() => void runAction('Preparing diagnostics…', () => exportAndShare('diagnostics'))} />
        </View>
        {busy ? <BusyRow label={busy} /> : null}
        {summary ? <View className="gap-[12px] px-[18px]">
          <Button label="Done" variant="primary" size="lg" busy={editor.saving} disabled={Boolean(busy) || Boolean(editor.conflict)} onPress={() => void done()} />
          <Text className="font-body text-[13px] text-muted">Saved on this phone. Backup status is separate; check Pilot for progress or any action needed.</Text>
          <Button label="Check backup in Pilot" onPress={() => beforeSharing(() => router.push('/account'))} disabled={Boolean(busy)} />
        </View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
    {editing ? <MetadataSheet flight={flight} onClose={() => setEditing(false)} onSave={saveDetails} onDelete={confirmDelete} busy={Boolean(busy)} actionError={message} /> : null}
    {postcardOpen ? <PostcardComposer flightId={flight.id} onClose={() => setPostcardOpen(false)} /> : null}
  </Screen>;
}

function UnavailableSharingActions({ renderActions }: { renderActions: (entry: FlightSharingEntry) => React.ReactNode }) {
  return renderActions({ label: 'Share with friends', reason: 'Sharing needs a finished flight with saved statistics.', onPress: () => undefined });
}

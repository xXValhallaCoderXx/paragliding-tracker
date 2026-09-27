import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View, type SectionListProps } from 'react-native';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';

import {
  BusyRow,
  Button,
  Notice,
  Screen,
  SectionLabel,
} from '@/components/ui';
import { EmptyLogbook } from '@/features/logbook/components/empty-logbook';
import { SetupChecklistCard } from '@/features/logbook/components/setup-checklist-card';
import { FlightCard } from '@/features/logbook/components/flight-card';
import { OpenFlightCard } from '@/features/logbook/components/open-flight-card';
import { RecordFab } from '@/features/logbook/components/record-fab';
import { JournalSummaryCard } from '@/features/logbook/components/journal-summary-card';
import { JournalFilterSheet } from '@/features/logbook/components/journal-filter-sheet';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { recorderService } from '@/recorder/recorder-service';
import type { FlightSummary, RecorderCapabilities } from '@/recorder/types';
import {
  useGetAppSettingsQuery,
  useGetEquipmentInventoryQuery,
  useGetFlightsQuery,
  useGetFlightTracksQuery,
  useGetProfileQuery,
} from '@/store/endpoints';
import { aircraftName, currentAircraft } from '@/features/equipment/presentation';
import { errorMessage } from '@/lib/format/error-message';
import type { TrackSegments } from '@/lib/track/types';
import { setupChecklist, type ChecklistKey } from '@/features/logbook/setup-checklist';
import {
  activeFilterCount, defaultJournalCriteria, journalFilterChips, removeJournalFilter,
  selectJournal, JOURNAL_SORT_OPTIONS, type JournalCriteria,
} from '@/features/logbook/journal-query';
import { applyJournalCriteria } from '@/store/journal-view';
import { useAppDispatch, useAppSelector, useAppStore } from '@/store/hooks';
import { OfflineCoverageContext } from '@/offline-maps/coverage-context';
import { fonts, paper } from '@/ui/theme';

/** Stable identity: a fresh `[]` default would break every memo that depends on it. */
const EMPTY_FLIGHTS: FlightSummary[] = [];

/** Stable identity, so a default `{}` does not remount every thumbnail on each render. */
const EMPTY_TRACKS: Record<string, TrackSegments> = {};

const PREVIEW_VIEWABILITY = { itemVisiblePercentThreshold: 1 };

export default function LogbookScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const recorderLifecycle = useRecorderLifecycle();
  const sync = useCloudSync();
  const coverage = useContext(OfflineCoverageContext);
  const dispatch = useAppDispatch();
  const viewStore = useAppStore();
  const { criteria, revision } = useAppSelector((state) => state.journalView);
  const [sheetRevision, setSheetRevision] = useState<number | null>(null);
  const [currentYear] = useState(() => new Date().getFullYear());
  const listRef = useRef<SectionList<FlightSummary>>(null);
  const [visibleFlightIds, setVisibleFlightIds] = useState<ReadonlySet<string>>(() => new Set());
  const onViewableItemsChanged = useCallback<NonNullable<SectionListProps<FlightSummary>['onViewableItemsChanged']>>(
    ({ viewableItems }) => {
      // Section headers also produce tokens; only actual visible flight rows may load maps.
      const next = new Set<string>(viewableItems
        .filter((token) => token.isViewable && token.index !== null && typeof token.item?.id === 'string')
        .map((token) => token.item.id));
      setVisibleFlightIds((previous) => previous.size === next.size && [...next].every((id) => previous.has(id))
        ? previous : next);
    }, [],
  );

  // The recorder writes flights outside Redux, and recovery can flip a session's status,
  // so these stay skipped until the lifecycle says the database is settled.
  const skip = !recorderLifecycle.ready || recorderLifecycle.recovering;
  const {
    data: flights = EMPTY_FLIGHTS,
    isLoading,
    isFetching,
    error: flightsError,
    fulfilledTimeStamp,
    refetch,
  } = useGetFlightsQuery(undefined, { skip });
  const { data: profile = null } = useGetProfileQuery(undefined, { skip });
  const { data: equipment } = useGetEquipmentInventoryQuery(undefined, { skip });
  const current = equipment ? currentAircraft(equipment) : null;
  // Only to decide whether the setup card is owed at all — see `setupChecklist`.
  const { data: appSettings = null } = useGetAppSettingsQuery(undefined, { skip });
  // One read for the whole list rather than a hook per card, and its own cache entry so
  // editing a flight's title does not re-read and re-parse every flight's geometry.
  const { data: tracks = EMPTY_TRACKS, refetch: refetchTracks } = useGetFlightTracksQuery(
    undefined,
    { skip },
  );
  // Not cached, deliberately: capabilities describe system settings the pilot may have
  // changed while away, so focus is the right trigger. A TTL cache here would still say
  // "denied" immediately after the first-run wizard granted location.
  const [capabilities, setCapabilities] = useState<RecorderCapabilities | null>(null);

  // The screen was written against these names; deriving them here keeps the rest of the
  // file unchanged and the diff about data flow rather than renaming.
  const loading = isLoading;
  const refreshing = isFetching && !isLoading;
  const error = flightsError ? errorMessage(flightsError) : null;
  // What "3 min ago" on the open-flight card is relative to. RTK Query stamps this when
  // the read resolved, which is exactly what the old `loadedAt` state held — and it keeps
  // Date.now() out of render, which React Compiler rejects.
  const loadedAt = fulfilledTimeStamp ?? null;

  // Depends on the function, not the whole sync object. The object gets a new identity on
  // every engine publish — three to five times per cycle — and depending on it would make
  // this effect re-run on each one.
  const requestSync = sync.requestSync;
  useFocusEffect(
    useCallback(() => {
      // The refetch is not about freshness — tag invalidation covers that. It is the
      // repair loop: `listFlights` is the ONLY thing that re-finalizes a flight stuck in
      // `processing` (flight-repository.native.ts:78-100), and DIRTY_FLIGHTS_SQL excludes
      // `processing` from backup entirely. Let this become cache-only and a flight whose
      // stats failed once silently never backs up again. The other three screens read the
      // shared entry for free; this one screen keeps the cadence that repairs it.
      // RTK Query rejects refetch() while this hook is skipped. That is the normal state
      // during recorder startup/recovery, and the query starts by itself once `skip`
      // becomes false, so there is nothing to refetch yet.
      if (!skip) void refetch();
      // The same trigger, for a different reason: opening a flight derives its track if it
      // had none, so this is what makes the thumbnail appear on the way back.
      if (!skip) void refetchTracks();
      void recorderService
        .getCapabilities()
        .then(setCapabilities)
        .catch(() => setCapabilities(null));
      // Cheapest reliable post-flight trigger: the recorder navigates here after a save.
      // Subscribing to recorderService instead would start its 1 Hz poll permanently.
      requestSync('logbook-focus');
    }, [refetch, refetchTracks, requestSync, skip]),
  );

  const layout = useMemo(() => selectJournal(flights, criteria, currentYear), [flights, criteria, currentYear]);
  const sections = useMemo(() => layout.sections.map((section) => ({
    key: section.key, title: section.title, data: section.flights,
  })), [layout.sections]);
  const listExtraData = useMemo(() => ({ tracks, focused, visibleFlightIds }), [tracks, focused, visibleFlightIds]);
  const filterCount = activeFilterCount(criteria);
  const chips = journalFilterChips(criteria, layout.facets);
  const sortLabel = JOURNAL_SORT_OPTIONS.find((option) => option.value === criteria.sort)!.label;
  const applyCriteria = (next: JournalCriteria, expectedRevision = revision) => {
    // Check current identity before any UI effect, including closing a newer sheet.
    if (viewStore.getState().journalView.revision !== expectedRevision) return;
    dispatch(applyJournalCriteria({ criteria: next, revision: expectedRevision }));
    setSheetRevision(null);
    if (expectedRevision === revision) listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: false });
  };
  const checklist = useMemo(
    () =>
      profile && capabilities && equipment
        ? setupChecklist({
            profile,
            capabilities,
            hasAircraft: equipment.aircraft.some((item) => !item.value.archived),
            onboardingState: appSettings?.onboardingState ?? null,
          })
        : null,
    [profile, capabilities, appSettings, equipment],
  );

  const recorderBusy = !recorderLifecycle.ready || recorderLifecycle.recovering;
  const openFlight = layout.open;
  const openRecorder = () => router.push('/record');
  const openWithIntent = (intent: 'resume' | 'finalize') =>
    router.push({ pathname: '/record', params: { intent } });
  const isEmpty = !skip && !loading && !error && flights.length === 0 && filterCount === 0;
  const noMatches = !skip && !loading && !error && layout.matchedCount === 0 && filterCount > 0;
  const pilotFirstName = profile?.pilotName?.trim().split(/\s+/)[0];
  const showRecordFab = !loading && !isEmpty && openFlight?.sessionStatus !== 'interrupted';

  return (
    <Screen edges={['top', 'left', 'right']}>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(flight) => flight.id}
        extraData={listExtraData}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        stickySectionHeadersEnabled={false}
        viewabilityConfig={PREVIEW_VIEWABILITY}
        onViewableItemsChanged={onViewableItemsChanged}
        renderSectionHeader={({ section }) => <View style={styles.section}>
          <SectionLabel className="px-[18px] pt-[10px] pb-[8px]">
            {section.key === sections[0]?.key && openFlight && (criteria.sort === 'newest' || criteria.sort === 'oldest') ? `Earlier · ${section.title}` : section.title}
          </SectionLabel>
        </View>}
        renderItem={({ item: flight }) => <View style={styles.card}>
          <FlightCard
            flight={flight}
            track={tracks[flight.id]}
            mapPreviewEnabled={focused && visibleFlightIds.has(flight.id)}
            onPress={() => router.push({ pathname: '/flights/[id]', params: { id: flight.id } })}
          />
        </View>}
        ItemSeparatorComponent={FlightCardSeparator}
        contentContainerStyle={[styles.content, showRecordFab && styles.contentWithRecorder]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={paper.thermal}
            colors={[paper.thermal]}
            progressBackgroundColor={paper.card}
            onRefresh={() => {
              if (!skip) void refetch();
              // A deliberate pull is a manual trigger, so it bypasses the throttle.
              sync.requestSync('manual');
            }}
          />
        }
        ListHeaderComponent={<>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>YOUR FLIGHT JOURNAL</Text>
            <Text style={styles.title}>
              {pilotFirstName ? `${pilotFirstName}’s logbook` : 'Days in the sky'}
            </Text>
          </View>
        </View>

        <View style={[styles.block, styles.gap]}>
          <View style={styles.toolbar}>
            <Button
              label={filterCount ? `Filters (${filterCount})` : 'Filters'}
              variant="secondary"
              disabled={skip || loading || Boolean(error && flights.length === 0)}
              onPress={() => setSheetRevision(revision)}
            />
            <Button label={sortLabel} variant="ghost" disabled={skip || loading || Boolean(error && flights.length === 0)} onPress={() => setSheetRevision(revision)} />
          </View>
          {chips.length ? <View style={styles.chips}>
            {chips.map((chip) => <Pressable
              key={`${chip.category}:${chip.value}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${chip.label} filter`}
              style={styles.filterChip}
              onPress={() => applyCriteria(removeJournalFilter(criteria, chip))}>
              <Text style={styles.filterChipText}>{chip.label} ×</Text>
            </Pressable>)}
          </View> : null}
          {(filterCount > 0 || criteria.sort !== 'newest') ? (
            <Button label="Clear all" variant="ghost" onPress={() => applyCriteria(defaultJournalCriteria())} />
          ) : null}
        </View>

        {coverage?.network === 'offline' ? <View style={styles.block}>
          <Notice title="You’re offline">
            Saved flights and filters still work. Map imagery may be unavailable.
          </Notice>
          <Button label="Backup status in Pilot" variant="ghost" onPress={() => router.push('/account')} />
        </View> : null}

        {recorderLifecycle.recovering ? (
          <View style={styles.block}>
            <BusyRow label="Checking recorder health…" />
          </View>
        ) : null}
        {recorderLifecycle.recoveryError ? (
          <View style={styles.block}>
            <Notice tone="danger" title="Recorder recovery failed">
              {recorderLifecycle.recoveryError}
            </Notice>
          </View>
        ) : null}
        {error ? (
          <View style={[styles.block, styles.gap]}>
            <Notice tone="danger" title="Could not open your logbook">
              {error}
            </Notice>
            <Button
              label="Try again"
              variant="secondary"
              disabled={skip}
              onPress={() => {
                if (!skip) void refetch();
              }}
            />
          </View>
        ) : null}

        {loading && !error && !recorderLifecycle.recovering ? (
          <View style={styles.block}>
            <BusyRow label="Opening your logbook…" />
          </View>
        ) : null}

        {openFlight ? (
          <View style={styles.block}>
            <OpenFlightCard
              flight={openFlight}
              now={loadedAt ?? openFlight.updatedAt}
              disabled={recorderBusy}
              onOpenRecorder={openRecorder}
              onResume={() => openWithIntent('resume')}
              onFinalize={() => openWithIntent('finalize')}
            />
          </View>
        ) : null}

        {!skip && !loading && !error && (layout.totalCount > 0 || filterCount > 0) ? (
          <View style={styles.block}>
            <JournalSummaryCard
              summary={layout.summary}
              scopeLabel={`${filterCount ? 'Filtered flights' : 'All time'}${criteria.year === null ? '' : ` · ${criteria.year}`} · On this phone`}
            />
            {filterCount > 0 ? <Text style={styles.resultCount} accessibilityLiveRegion="polite">
              {layout.matchedCount} of {layout.totalCount} saved flights
            </Text> : null}
          </View>
        ) : null}

        {checklist && !loading && !error && !recorderLifecycle.recovering ? (
          <View style={styles.block}>
            <SetupChecklistCard
              checklist={checklist}
              onSelect={(key: ChecklistKey) =>
                // Location is the one item the pilot cannot fix from the account screen;
                // it needs the recorder's own permission flow on the record screen.
                key === 'location' ? router.push('/record') : router.push('/account')
              }
            />
          </View>
        ) : null}

        </>}
        ListEmptyComponent={isEmpty ? (
          <EmptyLogbook
            pilotName={profile?.pilotName ?? null}
            gliderType={current ? aircraftName(current.value) : null}
            locationReady={
              capabilities?.foregroundPermission === 'granted' &&
              capabilities?.backgroundPermission === 'granted'
            }
            hasSetup={checklist === null}
            onRecord={openRecorder}
            disabled={recorderBusy}
            busyLabel={recorderLifecycle.recovering ? 'Checking recorder…' : null}
          />
        ) : noMatches ? (
          <View style={[styles.emptyResults, styles.gap]}>
            <Text style={styles.emptyTitle}>No flights match these filters</Text>
            <Text style={styles.emptyBody}>Try another selection or clear the filters to see your saved flights.</Text>
            <Button label="Edit filters" variant="primary" onPress={() => setSheetRevision(revision)} />
            <Button label="Clear filters" onPress={() => applyCriteria(defaultJournalCriteria())} />
          </View>
        ) : null}
      />

      {sheetRevision === revision ? <JournalFilterSheet
        key={revision}
        flights={flights}
        criteria={criteria}
        onClose={() => setSheetRevision(null)}
        onApply={(next) => applyCriteria(next, sheetRevision)}
      /> : null}

      {showRecordFab ? (
        <RecordFab
          label={
            recorderLifecycle.recovering
              ? 'Checking…'
              : openFlight
                ? 'Open recorder'
                : 'Record'
          }
          dot={!openFlight}
          disabled={recorderBusy}
          onPress={openRecorder}
        />
      ) : null}
    </Screen>
  );
}

function FlightCardSeparator() { return <View style={styles.cardSeparator} />; }

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  // Only the floating recorder overlaps the list: 56dp button + 16dp offset + 16dp gap.
  contentWithRecorder: { paddingBottom: 88 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
  },
  heading: { flex: 1, gap: 7 },
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 12, letterSpacing: 1.4, color: paper.muted },
  title: { fontFamily: fonts.sansBold, fontSize: 30, letterSpacing: -0.8, color: paper.ink },
  block: { paddingHorizontal: 16, paddingTop: 10 },
  gap: { gap: 10 },
  section: { paddingTop: 10 },
  card: { paddingHorizontal: 16 },
  cardSeparator: { height: 10 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: paper.thermalSoft, borderRadius: 22, maxWidth: '100%' },
  filterChipText: { color: paper.thermalInk, fontFamily: fonts.sansSemi, fontSize: 14 },
  resultCount: { color: paper.muted, fontFamily: fonts.monoMedium, fontSize: 12, marginTop: 12 },
  emptyResults: { padding: 24 },
  emptyTitle: { color: paper.ink, fontFamily: fonts.sansBold, fontSize: 23 },
  emptyBody: { color: paper.text, fontFamily: fonts.sans, fontSize: 15, lineHeight: 24 },
});

import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  BusyRow,
  Button,
  Disclaimer,
  LinkButton,
  Notice,
  Screen,
  SectionLabel,
} from '@/components/ui';
import { EmptyLogbook } from '@/features/logbook/components/empty-logbook';
import { SetupChecklistCard } from '@/features/logbook/components/setup-checklist-card';
import { FlightCard } from '@/features/logbook/components/flight-card';
import { OpenFlightCard } from '@/features/logbook/components/open-flight-card';
import { RecordFab } from '@/features/logbook/components/record-fab';
import { SeasonCard } from '@/features/logbook/components/season-card';
import { useCloudAuth } from '@/features/account/auth-provider';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { recorderService } from '@/recorder/recorder-service';
import type { FlightSummary, RecorderCapabilities } from '@/recorder/types';
import { useGetFlightsQuery, useGetFlightTracksQuery, useGetProfileQuery } from '@/store/endpoints';
import { errorMessage } from '@/lib/format/error-message';
import type { TrackSegments } from '@/lib/track/types';
import { setupChecklist, type ChecklistKey } from '@/features/logbook/setup-checklist';
import {
  countSavedFlights,
  evaluateGuestCapacity,
  guestCapacityNotice,
  oldestRemovableFlight,
} from '@/features/logbook/guest-capacity';
import { buildLogbookLayout, seasonSummary } from '@/features/logbook/logbook';
import { fonts, paper, TAB_BAR_HEIGHT } from '@/ui/theme';

/** Stable identity: a fresh `[]` default would break every memo that depends on it. */
const EMPTY_FLIGHTS: FlightSummary[] = [];

/** Stable identity, so a default `{}` does not remount every thumbnail on each render. */
const EMPTY_TRACKS: Record<string, TrackSegments> = {};

export default function LogbookScreen() {
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  // The saved-flight count at which the pilot dismissed the capacity warning. A count
  // rather than a flag, so dismissing at 8 does not silence 9; a count rather than a
  // timestamp, so Date.now() stays out of render. Deliberately not persisted: it should
  // die with the process, which is why this feature needs no schema change.
  const [dismissedAtCount, setDismissedAtCount] = useState<number | null>(null);

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

  const layout = useMemo(() => buildLogbookLayout(flights), [flights]);
  const season = useMemo(() => seasonSummary(flights), [flights]);
  const capacity = useMemo(
    () =>
      evaluateGuestCapacity({
        savedFlights: countSavedFlights(layout),
        authStatus: auth.status,
        linkedUserId: sync.linkedUserId,
      }),
    [layout, auth.status, sync.linkedUserId],
  );
  const checklist = useMemo(
    () =>
      profile && capabilities ? setupChecklist({ profile, capabilities }) : null,
    [profile, capabilities],
  );
  const capacityNotice = useMemo(
    () => guestCapacityNotice(capacity, oldestRemovableFlight(layout)),
    [capacity, layout],
  );

  const recorderBusy = !recorderLifecycle.ready || recorderLifecycle.recovering;
  const openFlight = layout.open;
  const openRecorder = () => router.push('/record');
  const openWithIntent = (intent: 'resume' | 'finalize') =>
    router.push({ pathname: '/record', params: { intent } });
  const isEmpty = !loading && !error && flights.length === 0;
  // Never while the list is stale: loading and the recovery path both leave `flights`
  // holding whatever was there before, and a count taken from that would be a lie.
  const showCapacity =
    capacityNotice !== null &&
    !loading &&
    !error &&
    !recorderLifecycle.recovering &&
    (!capacityNotice.dismissible || dismissedAtCount !== capacity.saved);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.content, isEmpty && styles.contentEmpty]}
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
        }>
        <View style={styles.header}>
          <Text style={styles.title}>Logbook</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={12}
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.gear, pressed && styles.gearPressed]}>
            <Text style={styles.gearGlyph}>⚙</Text>
          </Pressable>
        </View>

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

        {season ? (
          <View style={styles.block}>
            <SeasonCard summary={season} />
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

        {showCapacity && capacityNotice ? (
          <View style={[styles.block, styles.gap]}>
            <Notice tone={capacityNotice.tone} title={capacityNotice.title}>
              {capacityNotice.body}
            </Notice>
            <Button
              label={capacityNotice.primaryLabel}
              variant="primary"
              onPress={() => router.push('/account')}
            />
            {capacityNotice.remove ? (
              // Navigate rather than delete here. The pilot should see the flight, and
              // the IGC share button only exists on that screen.
              <Button
                label={capacityNotice.remove.label}
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/flights/[id]',
                    params: { id: capacityNotice.remove!.flightId, intent: 'remove' },
                  })
                }
              />
            ) : null}
            {capacityNotice.dismissible ? (
              <LinkButton label="Not now" onPress={() => setDismissedAtCount(capacity.saved)} />
            ) : null}
          </View>
        ) : null}

        {isEmpty ? (
          <EmptyLogbook
            pilotName={profile?.pilotName ?? null}
            hasSetup={checklist === null}
            onRecord={openRecorder}
            disabled={recorderBusy}
            busyLabel={recorderLifecycle.recovering ? 'Checking recorder…' : null}
          />
        ) : null}

        {layout.sections.map((section, sectionIndex) => (
          <View key={section.key} style={styles.section}>
            <SectionLabel className="px-[18px] pt-[10px] pb-[8px]">
              {sectionIndex === 0 && openFlight ? `Earlier · ${section.title}` : section.title}
            </SectionLabel>
            <View style={styles.cards}>
              {section.flights.map((flight) => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  track={tracks[flight.id]}
                  onPress={() =>
                    router.push({ pathname: '/flights/[id]', params: { id: flight.id } })
                  }
                />
              ))}
            </View>
          </View>
        ))}

        {!isEmpty ? (
          <Disclaimer className="mt-[26px] px-[32px]">
            Personal alpha. Not a certified flight recorder — never fly with this as your only
            recorder. Long-duration and locked-screen recording are still being validated.
          </Disclaimer>
        ) : null}
      </ScrollView>

      {!loading && !isEmpty && openFlight?.sessionStatus !== 'interrupted' ? (
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


const styles = StyleSheet.create({
  // The tab bar overlays the scroll view, so its height has to be reserved here.
  content: { paddingBottom: 120 + TAB_BAR_HEIGHT },
  contentEmpty: { paddingBottom: 40 + TAB_BAR_HEIGHT },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  gear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  gearPressed: { opacity: 0.5 },
  gearGlyph: { fontSize: 18, color: paper.muted },
  title: { fontFamily: fonts.sansBold, fontSize: 15, letterSpacing: -0.1, color: paper.ink },
  block: { paddingHorizontal: 16, paddingTop: 10 },
  gap: { gap: 10 },
  section: { paddingTop: 10 },
  cards: { paddingHorizontal: 16, gap: 10 },
});

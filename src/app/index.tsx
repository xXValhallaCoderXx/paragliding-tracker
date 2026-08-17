import { useCallback, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  BusyRow,
  Button,
  Disclaimer,
  Notice,
  Screen,
  SectionLabel,
  UnsupportedScreen,
} from '@/components/flight-ui';
import { EmptyLogbook } from '@/components/logbook/empty-logbook';
import { FlightCard } from '@/components/logbook/flight-card';
import { OpenFlightCard } from '@/components/logbook/open-flight-card';
import { RecordFab } from '@/components/logbook/record-fab';
import { SeasonCard } from '@/components/logbook/season-card';
import { useRecorderLifecycle } from '@/components/recorder-lifecycle';
import { flightRepository } from '@/recorder/flight-repository';
import type { FlightSummary } from '@/recorder/types';
import { buildLogbookLayout, seasonSummary } from '@/ui/logbook';
import { fonts, paper } from '@/ui/theme';

export default function LogbookScreen() {
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFlights = useCallback(
    async (refresh = false) => {
      if (Platform.OS === 'web' || !recorderLifecycle.ready || recorderLifecycle.recovering) {
        return;
      }
      if (refresh) setRefreshing(true);
      setError(null);
      try {
        const nextFlights = await flightRepository.listFlights();
        setFlights(nextFlights);
        setLoadedAt(Date.now());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [recorderLifecycle.ready, recorderLifecycle.recovering],
  );

  useFocusEffect(
    useCallback(() => {
      void loadFlights();
    }, [loadFlights]),
  );

  const layout = useMemo(() => buildLogbookLayout(flights), [flights]);
  const season = useMemo(() => seasonSummary(flights), [flights]);

  if (Platform.OS === 'web') return <UnsupportedScreen />;

  const recorderBusy = !recorderLifecycle.ready || recorderLifecycle.recovering;
  const openFlight = layout.open;
  const openRecorder = () => router.push('/record');
  const openWithIntent = (intent: 'resume' | 'finalize') =>
    router.push({ pathname: '/record', params: { intent } });
  const isEmpty = !loading && !error && flights.length === 0;

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
            onRefresh={() => void loadFlights(true)}
          />
        }>
        <View style={styles.header}>
          <Text style={styles.title}>Logbook</Text>
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
            <Button label="Try again" variant="secondary" onPress={() => void loadFlights(true)} />
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

        {isEmpty ? (
          <EmptyLogbook
            onRecord={openRecorder}
            disabled={recorderBusy}
            busyLabel={recorderLifecycle.recovering ? 'Checking recorder…' : null}
          />
        ) : null}

        {layout.sections.map((section, sectionIndex) => (
          <View key={section.key} style={styles.section}>
            <SectionLabel style={styles.sectionLabel}>
              {sectionIndex === 0 && openFlight ? `Earlier · ${section.title}` : section.title}
            </SectionLabel>
            <View style={styles.cards}>
              {section.flights.map((flight) => (
                <FlightCard
                  key={flight.id}
                  flight={flight}
                  onPress={() =>
                    router.push({ pathname: '/flights/[id]', params: { id: flight.id } })
                  }
                />
              ))}
            </View>
          </View>
        ))}

        {!isEmpty ? (
          <Disclaimer style={styles.footer}>
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
  content: { paddingBottom: 120 },
  contentEmpty: { paddingBottom: 40 },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
  title: { fontFamily: fonts.sansBold, fontSize: 15, letterSpacing: -0.1, color: paper.ink },
  block: { paddingHorizontal: 16, paddingTop: 10 },
  gap: { gap: 10 },
  section: { paddingTop: 10 },
  sectionLabel: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 },
  cards: { paddingHorizontal: 16, gap: 10 },
  footer: { marginTop: 26, paddingHorizontal: 32 },
});

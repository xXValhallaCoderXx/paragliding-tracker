import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActionButton,
  BusyRow,
  Notice,
  ScreenHeader,
  StatusChip,
  UnsupportedScreen,
  palette,
} from '@/components/flight-ui';
import { useRecorderLifecycle } from '@/components/recorder-lifecycle';
import { flightRepository } from '@/recorder/flight-repository';
import type { FlightSummary } from '@/recorder/types';
import {
  flightDisplayName,
  formatAltitude,
  formatDistance,
  formatDuration,
  formatFlightDate,
  qualityLabel,
} from '@/ui/flight-format';
import { unfinishedFlightPresentation } from '@/ui/capture-health';

export default function FlightsScreen() {
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFlights = useCallback(async (refresh = false) => {
    if (
      Platform.OS === 'web' ||
      !recorderLifecycle.ready ||
      recorderLifecycle.recovering
    ) {
      return;
    }
    if (refresh) setRefreshing(true);
    setError(null);
    try {
      setFlights(await flightRepository.listFlights());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [recorderLifecycle.ready, recorderLifecycle.recovering]);

  useFocusEffect(
    useCallback(() => {
      void loadFlights();
    }, [loadFlights]),
  );

  if (Platform.OS === 'web') return <UnsupportedScreen />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={palette.amber}
            colors={[palette.amber]}
            onRefresh={() => void loadFlights(true)}
          />
        }>
        <ScreenHeader
          eyebrow="YOUR LOGBOOK"
          title="Flights"
          body="Recorded on this phone. No account or cloud connection required."
        />

        <ActionButton
          label={recorderLifecycle.recovering ? 'Checking active flight…' : 'Record a flight'}
          tone="primary"
          disabled={!recorderLifecycle.ready || recorderLifecycle.recovering}
          onPress={() => router.push('/record' as Href)}
        />

        {recorderLifecycle.recovering ? (
          <BusyRow label="Checking recorder health…" />
        ) : null}

        {error ? <Notice tone="error">Could not open your logbook: {error}</Notice> : null}
        {recorderLifecycle.recoveryError ? (
          <Notice tone="error">
            Recorder recovery failed: {recorderLifecycle.recoveryError}
          </Notice>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent flights</Text>
          {!loading ? (
            <Text style={styles.flightCount}>
              {flights.length} {flights.length === 1 ? 'flight' : 'flights'}
            </Text>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Opening your logbook…</Text>
          </View>
        ) : flights.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>△</Text>
            <Text style={styles.emptyTitle}>Your first flight starts here</Text>
            <Text style={styles.emptyBody}>
              Tap Record a flight before launch. When you stop, the flight and its useful stats
              will be saved here.
            </Text>
          </View>
        ) : (
          <View style={styles.flightList}>
            {flights.map((flight) => (
              <FlightCard
                key={flight.id}
                flight={flight}
                onPress={() => {
                  if (unfinishedFlightPresentation(flight.sessionStatus)?.opensRecorder) {
                    router.push('/record' as Href);
                    return;
                  }
                  router.push(`/flights/${flight.id}` as Href);
                }}
              />
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Personal alpha. Keep using your usual trusted flight instrument while we validate
          long-duration and locked-screen recording.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function FlightCard({ flight, onPress }: { flight: FlightSummary; onPress: () => void }) {
  const metrics = flight.metrics;
  const duration =
    metrics?.durationMs ??
    (flight.endedAt === null ? null : Math.max(0, flight.endedAt - flight.startedAt));
  const name = flightDisplayName(flight.title, flight.site);
  const isPartial = flight.status === 'partial' || metrics?.quality === 'partial';
  const isProcessing = flight.status === 'processing';
  const unfinished = unfinishedFlightPresentation(flight.sessionStatus);
  const needsAttention = unfinished?.tone === 'danger';
  const activelyRecording = unfinished?.tone === 'neutral';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.flightCard, pressed && styles.flightCardPressed]}>
      <View style={styles.flightCardHeader}>
        <View style={styles.flightCardCopy}>
          <Text style={styles.flightName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.flightDate}>
            {formatFlightDate(flight.startedAt, flight.timezoneOffsetMinutes)}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>

      {flight.title?.trim() && flight.site?.trim() ? (
        <Text style={styles.site} numberOfLines={1}>
          {flight.site.trim()}
        </Text>
      ) : null}

      <View style={styles.summaryMetrics}>
        <SummaryMetric
          label="Time"
          value={
            duration === null
              ? needsAttention
                ? 'Unfinished'
                : 'In progress'
              : formatDuration(duration)
          }
        />
        <SummaryMetric label="Distance" value={formatDistance(metrics?.trackDistanceMetres ?? null)} />
        <SummaryMetric label="Max altitude" value={formatAltitude(metrics?.maxGpsAltitude ?? null)} />
      </View>

      <View style={styles.chips}>
        {unfinished ? <StatusChip label={unfinished.label} tone={unfinished.tone} /> : null}
        {isProcessing ? <StatusChip label="Finishing stats" tone="neutral" /> : null}
        {isPartial ? <StatusChip label="Partial flight" tone="warning" /> : null}
        {!needsAttention && !activelyRecording && !isProcessing && !isPartial && metrics ? (
          <StatusChip
            label={qualityLabel(metrics.quality)}
            tone={metrics.quality === 'healthy' ? 'good' : metrics.quality === 'gaps' ? 'warning' : 'danger'}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryMetric}>
      <Text style={styles.summaryMetricLabel}>{label}</Text>
      <Text style={styles.summaryMetricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, paddingBottom: 48, gap: 18 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  flightCount: { color: palette.textQuiet, fontSize: 12, fontWeight: '700' },
  flightList: { gap: 12 },
  flightCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 17,
    padding: 16,
  },
  flightCardPressed: { opacity: 0.74, borderColor: palette.borderStrong },
  flightCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flightCardCopy: { flex: 1 },
  flightName: { color: palette.text, fontSize: 19, fontWeight: '800' },
  flightDate: { color: palette.textMuted, fontSize: 12, marginTop: 5 },
  chevron: { color: palette.amber, fontSize: 31, lineHeight: 32, fontWeight: '300' },
  site: { color: '#cbd5e1', fontSize: 13, marginTop: 10 },
  summaryMetrics: { flexDirection: 'row', gap: 7, marginTop: 15 },
  summaryMetric: { flex: 1, minWidth: 0 },
  summaryMetricLabel: {
    color: '#7890ad',
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  summaryMetricValue: {
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  emptyCard: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 26,
  },
  emptyIcon: { color: palette.amber, fontSize: 35, marginBottom: 12 },
  emptyTitle: { color: palette.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  emptyBody: {
    color: palette.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 9,
  },
  footer: { color: palette.textQuiet, fontSize: 11, lineHeight: 17, marginTop: 4 },
});

import { StyleSheet, Text, View } from 'react-native';

import { Button, LinkButton, PulseDot } from '@/components/ui';
import type { FlightSummary } from '@/recorder/types';
import { flightLocalDate, formatClockTime } from '@/lib/format/flight-format';
import { fonts, paper } from '@/ui/theme';

/**
 * Pinned card for the single unfinished flight. Persisted state alone cannot
 * prove a recording is healthy, so the recording variant stays neutral and
 * the interrupted variant is an explicit attention state.
 */
export function OpenFlightCard({
  flight,
  now,
  onOpenRecorder,
  onResume,
  onFinalize,
  disabled = false,
}: {
  flight: FlightSummary;
  /** Timestamp captured outside render (e.g. when the list loaded). */
  now: number;
  onOpenRecorder: () => void;
  onResume: () => void;
  onFinalize: () => void;
  disabled?: boolean;
}) {
  const interrupted = flight.sessionStatus === 'interrupted';
  const startedLabel = formatClockTime(flight.startedAt, flight.timezoneOffsetMinutes);
  const startedToday = isSameLocalDay(flight.startedAt, now, flight.timezoneOffsetMinutes);
  const whose = startedToday ? "Today's flight" : 'A flight';

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={interrupted ? 'Interrupted flight' : 'Recording in progress'}
      style={[styles.card, interrupted ? styles.cardInterrupted : styles.cardRecording]}>
      <View style={styles.labelRow}>
        <PulseDot color={interrupted ? paper.danger : paper.ink} size={8} pulse={false} />
        <Text style={[styles.label, { color: interrupted ? paper.danger : paper.text }]}>
          {interrupted ? 'RECORDING INTERRUPTED' : 'RECORDING IN PROGRESS'}
        </Text>
      </View>
      <Text style={styles.title}>
        {interrupted ? `${whose} is waiting for you` : `${whose} is being recorded`}
      </Text>
      <Text style={styles.body}>
        {interrupted
          ? `Recording stopped unexpectedly after starting at ${startedLabel}. You can resume or save the samples stored on this phone as a partial flight.`
          : `Started at ${startedLabel}. Open the recorder to check GPS health, or to stop and save when you have landed.`}
      </Text>
      <View style={styles.actions}>
        {interrupted ? (
          <>
            <Button
              label="Resume recording"
              variant="primary"
              onPress={onResume}
              disabled={disabled}
              className="flex-1"
            />
            <Button
              label="Save partial flight"
              variant="secondary"
              onPress={onFinalize}
              disabled={disabled}
              className="flex-1 border-attention-border"
            />
          </>
        ) : (
          <Button label="Open recorder" variant="dark" onPress={onOpenRecorder} className="flex-1" />
        )}
      </View>
      {interrupted ? (
        <LinkButton label="Look at the recorder first ›" onPress={onOpenRecorder} className="self-center mt-[4px] mb-[-6px]" />
      ) : null}
    </View>
  );
}

function isSameLocalDay(
  timestamp: number,
  now: number,
  timezoneOffsetMinutes: number | null,
): boolean {
  const flightDay = flightLocalDate(timestamp, timezoneOffsetMinutes);
  const today = flightLocalDate(now, timezoneOffsetMinutes);
  return (
    flightDay.year === today.year &&
    flightDay.monthIndex === today.monthIndex &&
    flightDay.day === today.day
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, borderWidth: 1.5 },
  cardInterrupted: { backgroundColor: paper.attentionSoft, borderColor: paper.thermal },
  cardRecording: { backgroundColor: paper.card, borderColor: paper.ink },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 1.2 },
  title: { fontFamily: fonts.sansSemi, fontSize: 16.5, lineHeight: 21, color: paper.ink, marginTop: 9 },
  body: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18.5, color: paper.attentionInk, marginTop: 7 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
});

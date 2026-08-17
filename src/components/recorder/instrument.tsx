import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BusyRow,
  Button,
  Disclaimer,
  Hairline,
  Notice,
  Screen,
  StatusPill,
  TopBar,
} from '@/components/flight-ui';
import { HoldToStop } from '@/components/recorder/hold-to-stop';
import { TEST_BUILD_WARNING } from '@/recorder/config';
import type { RecorderSnapshot } from '@/recorder/types';
import { captureAgeLabel, type CapturePresentation } from '@/ui/capture-health';
import {
  formatAccuracy,
  formatAirtime,
  formatBattery,
  formatThousands,
} from '@/ui/flight-format';
import type { InFlightNotice } from '@/ui/recorder-presentation';
import { fonts, night } from '@/ui/theme';

export interface InstrumentViewProps {
  snapshot: RecorderSnapshot;
  capture: CapturePresentation;
  notices: InFlightNotice[];
  busyLabel: string | null;
  actionsDisabled: boolean;
  errorMessage: string | null;
  recoveryError: string | null;
  onBack: () => void;
  onStop: () => void;
  onRetrySave: () => void;
}

/**
 * S3 — the in-flight instrument view. Three large values, a state pill that
 * only reads "REC" while capture is verifiably healthy, and a hold-to-stop.
 * Climb rate is not shown: this build has no vario and no pressure-derived
 * climb, so ground speed takes the third slot.
 */
export function InstrumentView({
  snapshot,
  capture,
  notices,
  busyLabel,
  actionsDisabled,
  errorMessage,
  recoveryError,
  onBack,
  onStop,
  onRetrySave,
}: InstrumentViewProps) {
  const healthy = snapshot.state === 'recording' && snapshot.captureHealth === 'healthy';
  const stopping = snapshot.state === 'stopping' || snapshot.state === 'completed';
  const battery = formatBattery(snapshot.batteryLevel);
  const pillLabel = healthy ? 'REC' : capture.label;
  const pillTone = healthy ? 'good' : capture.tone;
  const altitude = snapshot.gpsAltitude;
  const speedKmh =
    snapshot.speed === null || !Number.isFinite(snapshot.speed)
      ? null
      : Math.max(0, snapshot.speed * 3.6);
  // With degraded-state cards on screen, the values shrink so the stop control
  // stays within reach, as in the design's degraded frame.
  const compact = notices.length > 0 || Boolean(recoveryError) || Boolean(errorMessage);

  return (
    <Screen scheme="night">
      <ScrollView contentContainerStyle={styles.content}>
        <TopBar
          scheme="night"
          onBack={onBack}
          backLabel="Back to logbook, recording continues"
          right={
            <StatusPill
              label={battery ? `Phone sensors · ${battery}` : 'Phone sensors'}
              tone="neutral"
            />
          }
        />
        <View style={styles.pillRow}>
          <StatusPill label={pillLabel} tone={pillTone} emphasis={healthy} pulse={healthy} />
        </View>

        {notices.length > 0 || recoveryError || errorMessage ? (
          <View style={styles.notices}>
            {errorMessage ? (
              <Notice scheme="night" tone="danger" title="That did not work">
                {errorMessage}
              </Notice>
            ) : null}
            {notices.map((notice) => (
              <Notice key={notice.key} scheme="night" tone={notice.tone} title={notice.title}>
                {notice.body}
              </Notice>
            ))}
            {recoveryError ? (
              <Notice scheme="night" tone="danger" title="Recorder recovery failed">
                {recoveryError}
              </Notice>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.values, compact && styles.valuesCompact]}>
          <View style={styles.value}>
            <Text style={styles.valueLabel}>{stopping ? 'AIRTIME · STOPPED' : 'AIRTIME'}</Text>
            <Text
              style={[styles.airtime, compact && styles.airtimeCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {formatAirtime(snapshot.durationMs)}
            </Text>
          </View>
          <Hairline scheme="night" style={[styles.divider, compact && styles.dividerCompact]} />
          <View style={styles.value}>
            <View style={styles.valueLabelRow}>
              <Text style={styles.valueLabel}>GPS ALTITUDE</Text>
              {snapshot.capabilities.pressureAvailable ? null : (
                <Text style={styles.valueTag}>NO BAROMETER</Text>
              )}
            </View>
            <View style={styles.bigRow}>
              <Text style={[styles.big, compact && styles.bigCompact]} numberOfLines={1} adjustsFontSizeToFit>
                {altitude === null || !Number.isFinite(altitude) ? '—' : String(Math.round(altitude))}
              </Text>
              <Text style={[styles.unit, compact && styles.unitCompact]}>m</Text>
            </View>
          </View>
          <Hairline scheme="night" style={[styles.divider, compact && styles.dividerCompact]} />
          <View style={styles.value}>
            <Text style={styles.valueLabel}>GROUND SPEED</Text>
            <View style={styles.bigRow}>
              <Text style={[styles.big, compact && styles.bigCompact]} numberOfLines={1} adjustsFontSizeToFit>
                {speedKmh === null ? '—' : String(Math.round(speedKmh))}
              </Text>
              <Text style={[styles.unit, compact && styles.unitCompact]}>km/h</Text>
            </View>
          </View>
        </View>

        <View style={styles.evidence} accessibilityLabel="Capture evidence">
          <Text style={styles.evidenceText}>
            {formatThousands(snapshot.fixCount)} {snapshot.fixCount === 1 ? 'fix' : 'fixes'}
            {' · '}
            {formatAccuracy(snapshot.horizontalAccuracy)}
          </Text>
          <Text style={styles.evidenceText}>
            {'last fix '}
            {captureAgeLabel(snapshot.lastFixReceivedAt, snapshot.capturedAt)}
            {' · callback '}
            {captureAgeLabel(snapshot.lastLocationCallbackAt, snapshot.capturedAt)}
          </Text>
        </View>

        <View style={styles.footer}>
          <Disclaimer scheme="night">{TEST_BUILD_WARNING}</Disclaimer>
          {stopping ? (
            busyLabel ? (
              <BusyRow scheme="night" label={busyLabel} />
            ) : (
              <Button
                label="Retry saving stopped flight"
                variant="primary"
                size="lg"
                scheme="night"
                disabled={actionsDisabled}
                onPress={onRetrySave}
              />
            )
          ) : busyLabel ? (
            <BusyRow scheme="night" label={busyLabel} />
          ) : (
            <HoldToStop onConfirm={onStop} disabled={actionsDisabled} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 26 },
  pillRow: { flexDirection: 'row', paddingHorizontal: 18, paddingTop: 8 },
  notices: { paddingHorizontal: 18, paddingTop: 14, gap: 8 },
  values: { paddingTop: 30 },
  valuesCompact: { paddingTop: 20 },
  value: { paddingHorizontal: 24 },
  valueLabelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  valueLabel: { fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 2.2, color: night.label },
  valueTag: { fontFamily: fonts.monoMedium, fontSize: 9.5, letterSpacing: 0.6, color: night.warnInk },
  airtime: {
    fontFamily: fonts.monoSemi,
    fontSize: 58,
    lineHeight: 62,
    letterSpacing: -2.4,
    color: night.text,
    marginTop: 8,
  },
  airtimeCompact: { fontSize: 48, lineHeight: 52, letterSpacing: -2, marginTop: 6 },
  bigRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 8 },
  big: {
    fontFamily: fonts.monoSemi,
    fontSize: 68,
    lineHeight: 70,
    letterSpacing: -3,
    color: night.text,
    flexShrink: 1,
  },
  bigCompact: { fontSize: 56, lineHeight: 58, letterSpacing: -2.4 },
  unit: { fontFamily: fonts.sansMedium, fontSize: 22, color: night.label, paddingBottom: 9 },
  unitCompact: { fontSize: 19, paddingBottom: 7 },
  divider: { marginHorizontal: 24, marginVertical: 26 },
  dividerCompact: { marginVertical: 18 },
  evidence: { paddingHorizontal: 24, marginTop: 24, gap: 3 },
  evidenceText: { fontFamily: fonts.monoMedium, fontSize: 10.5, letterSpacing: 0.4, color: night.dim },
  footer: { marginTop: 'auto', paddingHorizontal: 20, paddingTop: 26, gap: 14 },
});

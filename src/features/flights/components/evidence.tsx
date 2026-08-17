import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { gapSummary } from '@/features/flights/flight-detail';
import { RECORDER_CONFIG } from '@/recorder/config';
import type { FlightDetail } from '@/recorder/types';
import { formatBattery, formatGap, formatThousands, qualityLabel } from '@/lib/format/flight-format';
import { fonts, paper } from '@/ui/theme';

/**
 * "How this was recorded" — the recording-integrity block. Collapsed by
 * default; the diagnostics JSON export lives inside it as an advanced action.
 */
export function EvidenceBlock({
  flight,
  open,
  onToggle,
  onExportDiagnostics,
  exportDisabled,
}: {
  flight: FlightDetail;
  open: boolean;
  onToggle: () => void;
  onExportDiagnostics: () => void;
  exportDisabled: boolean;
}) {
  const metrics = flight.metrics;
  const session = flight.session;
  const summary = metrics
    ? [
        `${formatThousands(metrics.fixCount)} fixes`,
        gapSummary(metrics.quality, metrics.maxSourceGapMs),
        'GPS altitude',
      ].join(' · ')
    : 'Stats pending';
  const appVersion = typeof session.appMetadata.version === 'string' ? session.appMetadata.version : null;
  const startBattery = formatBattery(session.startPower.batteryLevel);
  const endBattery = session.endPower ? formatBattery(session.endPower.batteryLevel) : null;

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="How this was recorded"
        onPress={onToggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>How this was recorded</Text>
          <Text style={styles.headerSummary}>{summary}</Text>
        </View>
        <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Row label="Fixes">
            {metrics
              ? `${formatThousands(metrics.fixCount)} valid GPS fixes · median gap ${formatGap(metrics.medianSourceGapMs)} · p95 ${formatGap(metrics.p95SourceGapMs)} · longest ${formatGap(metrics.maxSourceGapMs)}`
              : 'Not calculated yet'}
          </Row>
          <Row label="Track">{metrics ? qualityLabel(metrics.quality) : 'Pending'}</Row>
          <Row label="Altitude">
            {`GPS altitude (WGS84 ellipsoid). ${
              session.pressureSequence > 0
                ? `${formatThousands(session.pressureSequence)} barometer samples stored as evidence, not used for altitude.`
                : 'No barometer samples were stored.'
            }`}
          </Row>
          <Row label="Battery">
            {startBattery
              ? `${startBattery} at start${endBattery ? ` → ${endBattery} at the end` : ''}`
              : 'Not available'}
          </Row>
          <Row label="Recorder">
            {`Flight Log Alpha${appVersion ? ` ${appVersion}` : ''} · schema v${RECORDER_CONFIG.schemaVersion} · IGC v${RECORDER_CONFIG.igcArtifactVersion} unsigned`}
          </Row>
          <Row label="Session" mono>
            {`${session.id} · ${session.status}${session.completionReason ? ` (${session.completionReason})` : ''}`}
          </Row>
          <Row label="Note" muted>
            Unsigned IGC files are fine for your own archive or another app; they are not valid for
            competition scoring.
          </Row>
          <Button
            label="Export diagnostics JSON"
            variant="ghost"
            onPress={onExportDiagnostics}
            disabled={exportDisabled}
            className="mt-[4px]"
          />
        </View>
      ) : null}
    </View>
  );
}

function Row({
  label,
  children,
  mono = false,
  muted = false,
}: {
  label: string;
  children: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono, muted && { color: paper.muted }]} selectable={mono}>
        {children}
      </Text>
    </View>
  );
}


const styles = StyleSheet.create({
  block: {
    marginHorizontal: 16,
    backgroundColor: paper.cardAlt,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  headerCopy: { flex: 1 },
  headerTitle: { fontFamily: fonts.sansSemi, fontSize: 12.5, color: paper.ink },
  headerSummary: { fontFamily: fonts.sans, fontSize: 11.5, color: paper.text, marginTop: 2 },
  chevron: { fontFamily: fonts.sansSemi, fontSize: 15, color: paper.muted },
  pressed: { opacity: 0.75 },
  body: {
    borderTopWidth: 1,
    borderTopColor: paper.border,
    backgroundColor: paper.card,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 8,
    gap: 8,
  },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  rowLabel: { width: 64, fontFamily: fonts.monoMedium, fontSize: 10.5, color: paper.ink, paddingTop: 1 },
  rowValue: { flex: 1, fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: paper.text },
  rowValueMono: { fontFamily: fonts.mono, fontSize: 10.5 },
});

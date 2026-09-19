import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  BusyRow,
  Button,
  Disclaimer,
  Hairline,
  Notice,
  Screen,
  StatusPill,
  TopBar,
} from '@/components/ui';
import { HoldToStop } from '@/features/record/components/hold-to-stop';
import { TEST_BUILD_WARNING } from '@/recorder/config';
import type { RecorderSnapshot } from '@/recorder/types';
import { captureAgeLabel, type CapturePresentation } from '@/features/record/capture-health';
import {
  formatAccuracy,
  formatAirtime,
  formatBattery,
  formatThousands,
} from '@/lib/format/flight-format';
import type { InFlightNotice } from '@/features/record/recorder-presentation';
import type { RecordingViewMode } from '../recording-view-intent';

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
  selectedView?: RecordingViewMode;
  onSelectView?: (view: RecordingViewMode) => void;
  mapContent?: ReactNode;
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
  selectedView = 'instruments',
  onSelectView,
  mapContent,
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

  // The large readouts now use the paper hierarchy: ink for the numerals, muted for their
  // labels, faint for the evidence line. Previously these were night.text / night.label /
  // night.dim against a near-black screen.
  const label = 'font-body-semi text-[11px] tracking-[2.2px] text-muted';
  const numeral = compact
    ? 'font-data-semi text-[56px] leading-[58px] tracking-[-2.4px] text-ink shrink'
    : 'font-data-semi text-[68px] leading-[70px] tracking-[-3px] text-ink shrink';
  const unit = compact
    ? 'font-body-medium text-[19px] text-muted pb-[7px]'
    : 'font-body-medium text-[22px] text-muted pb-[9px]';
  const divider = compact ? 'mx-[24px] my-[18px]' : 'mx-[24px] my-[26px]';

  return (
    <Screen>
      <View testID="recording-header" style={{ flexShrink: 0 }}>
        <TopBar
          onBack={onBack}
          backLabel="Back to logbook, recording continues"
          right={
            <StatusPill
              label={battery ? `Phone sensors · ${battery}` : 'Phone sensors'}
              tone="neutral"
            />
          }
        />
        <View className="flex-row px-[18px] pt-[8px] pb-[8px]">
          <StatusPill label={pillLabel} tone={pillTone} emphasis={healthy} pulse={healthy} />
        </View>
        <View accessibilityRole="tablist" className="mx-[18px] mb-[8px] flex-row gap-[8px]">
          {(['instruments', 'map'] as const).map((view) => <Pressable key={view}
            accessibilityRole="tab" accessibilityLabel={view === 'map' ? 'Map' : 'Instruments'}
            accessibilityState={{ selected: selectedView === view, disabled: stopping }}
            disabled={stopping} onPress={() => onSelectView?.(view)}
            className={`min-h-[44px] flex-1 items-center justify-center rounded-[12px] border px-[8px] py-[8px] ${
              selectedView === view ? 'border-thermal bg-thermal-soft' : 'border-border bg-card'
            }`}>
            <Text className="font-body-semi text-[13px] text-ink">{view === 'map' ? 'Map' : 'Instruments'}</Text>
          </Pressable>)}
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {notices.length > 0 || recoveryError || errorMessage ? (
          <ScrollView style={{ flexGrow: 0, maxHeight: '35%' }}
            contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 8, gap: 8 }}
            accessibilityLabel="Recording notices">
            {errorMessage ? (
              <Notice tone="danger" title="That did not work">
                {errorMessage}
              </Notice>
            ) : null}
            {notices.map((notice) => (
              <Notice key={notice.key} tone={notice.tone} title={notice.title}>
                {notice.body}
              </Notice>
            ))}
            {recoveryError ? (
              <Notice tone="danger" title="Recorder recovery failed">
                {recoveryError}
              </Notice>
            ) : null}
          </ScrollView>
        ) : null}
        {selectedView === 'map' ? <>
          <View className="flex-row flex-wrap gap-x-[18px] gap-y-[5px] px-[20px] pb-[8px]"
            accessibilityLabel="Flight instruments">
            <CompactValue label="AIRTIME" value={formatAirtime(snapshot.durationMs)} />
            <CompactValue label="GPS ALTITUDE" value={altitude === null || !Number.isFinite(altitude) ? '—' : `${Math.round(altitude)} m`} />
            <CompactValue label="GROUND SPEED" value={speedKmh === null ? '—' : `${Math.round(speedKmh)} km/h`} />
          </View>
          <View testID="recording-map-region" style={{ flex: 1, minHeight: 0, paddingHorizontal: 16 }}>
            {mapContent}
          </View>
        </> : <ScrollView testID="recording-instruments" contentContainerStyle={{ paddingBottom: 18 }}>
        <View className={compact ? 'pt-[20px]' : 'pt-[30px]'}>
          <View className="px-[24px]">
            <Text className={label}>{stopping ? 'AIRTIME · STOPPED' : 'AIRTIME'}</Text>
            <Text
              className={`font-data-semi text-ink ${
                compact
                  ? 'mt-[6px] text-[48px] leading-[52px] tracking-[-2px]'
                  : 'mt-[8px] text-[58px] leading-[62px] tracking-[-2.4px]'
              }`}
              numberOfLines={1}
              adjustsFontSizeToFit>
              {formatAirtime(snapshot.durationMs)}
            </Text>
          </View>
          <Hairline className={divider} />
          <View className="px-[24px]">
            <View className="flex-row items-baseline gap-[9px]">
              <Text className={label}>GPS ALTITUDE</Text>
              {snapshot.capabilities.pressureAvailable ? null : (
                <Text className="font-data-medium text-[9.5px] tracking-[0.6px] text-warn-ink">
                  NO BAROMETER
                </Text>
              )}
            </View>
            <View className="mt-[8px] flex-row items-end gap-[10px]">
              <Text className={numeral} numberOfLines={1} adjustsFontSizeToFit>
                {altitude === null || !Number.isFinite(altitude) ? '—' : String(Math.round(altitude))}
              </Text>
              <Text className={unit}>m</Text>
            </View>
          </View>
          <Hairline className={divider} />
          <View className="px-[24px]">
            <Text className={label}>GROUND SPEED</Text>
            <View className="mt-[8px] flex-row items-end gap-[10px]">
              <Text className={numeral} numberOfLines={1} adjustsFontSizeToFit>
                {speedKmh === null ? '—' : String(Math.round(speedKmh))}
              </Text>
              <Text className={unit}>km/h</Text>
            </View>
          </View>
        </View>

        <View className="mt-[24px] gap-[3px] px-[24px]" accessibilityLabel="Capture evidence">
          <Text className="font-data-medium text-[10.5px] tracking-[0.4px] text-muted">
            {formatThousands(snapshot.fixCount)} {snapshot.fixCount === 1 ? 'fix' : 'fixes'}
            {' · '}
            {formatAccuracy(snapshot.horizontalAccuracy)}
          </Text>
          <Text className="font-data-medium text-[10.5px] tracking-[0.4px] text-muted">
            {'last fix '}
            {captureAgeLabel(snapshot.lastFixReceivedAt, snapshot.capturedAt)}
            {' · callback '}
            {captureAgeLabel(snapshot.lastLocationCallbackAt, snapshot.capturedAt)}
          </Text>
        </View>
        </ScrollView>}
      </View>
        <View testID="recording-footer" style={{ flexShrink: 0 }} className="gap-[8px] px-[20px] pt-[10px] pb-[8px]">
          <Disclaimer>{TEST_BUILD_WARNING}</Disclaimer>
          {stopping ? (
            busyLabel ? (
              <BusyRow label={busyLabel} />
            ) : (
              <Button
                label="Retry saving stopped flight"
                variant="primary"
                size="lg"
                disabled={actionsDisabled}
                onPress={onRetrySave}
              />
            )
          ) : busyLabel ? (
            <BusyRow label={busyLabel} />
          ) : (
            <HoldToStop onConfirm={onStop} disabled={actionsDisabled} />
          )}
        </View>
    </Screen>
  );
}

function CompactValue({ label, value }: { label: string; value: string }) {
  return <View style={{ flexGrow: 1 }}>
    <Text className="font-body-semi text-[9px] tracking-[0.5px] text-muted">{label}</Text>
    <Text className="font-data-semi text-[19px] text-ink">{value}</Text>
  </View>;
}

import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BusyRow,
  Button,
  Card,
  Disclaimer,
  Notice,
  Screen,
  StateLabel,
  TopBar,
} from '@/components/ui';
import { TEST_BUILD_WARNING } from '@/recorder/config';
import type { RecorderSnapshot } from '@/recorder/types';
import {
  formatAirtime,
  formatAirtimeWords,
  formatClockTime,
  formatMetres,
  formatThousands,
} from '@/lib/format/flight-format';
import { fonts, paper } from '@/ui/theme';

export interface InterruptedViewProps {
  snapshot: RecorderSnapshot;
  busyLabel: string | null;
  actionsDisabled: boolean;
  recovering: boolean;
  errorMessage: string | null;
  recoveryError: string | null;
  onBack: () => void;
  onResume: () => void;
  onFinalize: () => void;
}

/**
 * The interrupted flight, kept honest: it never looks healthy, keeps both
 * Resume and Save Partial, and says exactly what is safe.
 */
export function InterruptedView({
  snapshot,
  busyLabel,
  actionsDisabled,
  recovering,
  errorMessage,
  recoveryError,
  onBack,
  onResume,
  onFinalize,
}: InterruptedViewProps) {
  const lastFixLabel =
    snapshot.lastFixAt === null ? null : formatClockTime(snapshot.lastFixAt, null);
  const recorded = formatAirtimeWords(snapshot.durationMs);
  const fixes = `${formatThousands(snapshot.fixCount)} ${snapshot.fixCount === 1 ? 'fix' : 'fixes'}`;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <TopBar onBack={onBack} backLabel="Back to logbook" title="Recorder" />

        <View style={styles.headline}>
          <StateLabel label="Needs attention" tone="danger" />
          <Text style={styles.title}>Your flight is waiting for you.</Text>
          <Text style={styles.body}>
            Recording stopped before you pressed stop — the app may have been closed, or GPS went
            quiet for longer than the recovery window.{' '}
            {snapshot.fixCount > 0
              ? `This phone has data up to ${lastFixLabel ?? 'the last fix'}: ${recorded} and ${fixes}.`
              : 'No valid GPS fix was recorded before it stopped.'}
          </Text>
        </View>

        <Card variant="dark" className="mx-[16px] px-[16px] pt-[15px] pb-[13px]">
          <View style={styles.statGrid}>
            <DarkStat label="Airtime recorded" value={formatAirtime(snapshot.durationMs)} />
            <DarkStat label="GPS fixes" value={formatThousands(snapshot.fixCount)} />
            <DarkStat label="Last fix" value={lastFixLabel ?? '—'} tone="warn" />
            <DarkStat label="Last altitude" value={formatMetres(snapshot.gpsAltitude)} />
          </View>
          <Text style={styles.statNote}>
            Resume restarts GPS on this same flight and needs a fresh fix within 20 seconds. Saving
            it as partial keeps only what was recorded and cannot be resumed afterwards.
          </Text>
        </Card>

        {errorMessage || recoveryError || snapshot.lastError ? (
          <View style={styles.notices}>
            {errorMessage ? (
              <Notice tone="danger" title="That did not work">
                {errorMessage}
              </Notice>
            ) : null}
            {recoveryError ? (
              <Notice tone="danger" title="Recorder recovery failed">
                {recoveryError}
              </Notice>
            ) : null}
            {snapshot.lastError &&
            !(errorMessage && snapshot.lastError.message.includes(errorMessage)) ? (
              <Notice tone="warning" title="What the recorder reported">
                {snapshot.lastError.message}
              </Notice>
            ) : null}
          </View>
        ) : null}

        <View style={styles.footer}>
          <Button
            label={busyLabel?.startsWith('Resuming') ? busyLabel : 'Resume recording'}
            variant="primary"
            size="lg"
            busy={Boolean(busyLabel?.startsWith('Resuming'))}
            disabled={actionsDisabled}
            onPress={onResume}
            accessibilityHint="Restarts GPS capture on the same flight"
          />
          <Button
            label={busyLabel?.startsWith('Saving') ? busyLabel : 'Save as partial flight'}
            variant="secondary"
            size="lg"
            busy={Boolean(busyLabel?.startsWith('Saving'))}
            disabled={actionsDisabled}
            onPress={onFinalize}
            className="border-attention-border"
            accessibilityHint="Keeps only what was recorded; the flight cannot be resumed afterwards"
          />
          {recovering ? <BusyRow label="Checking recorder health…" /> : null}
          <Disclaimer className="mt-[6px]">{TEST_BUILD_WARNING}</Disclaimer>
        </View>
      </ScrollView>
    </Screen>
  );
}

function DarkStat({ label, value, tone = 'light' }: { label: string; value: string; tone?: 'light' | 'warn' }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.statValue, tone === 'warn' && { color: '#D3A03A' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: 28, gap: 14 },
  headline: { paddingHorizontal: 22, paddingTop: 12, gap: 8 },
  title: { fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 30, color: paper.ink, marginTop: 4 },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: paper.text },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  stat: { width: '50%' },
  statLabel: { fontFamily: fonts.sansSemi, fontSize: 9.5, letterSpacing: 1.4, color: paper.onDarkMuted },
  statValue: { fontFamily: fonts.monoSemi, fontSize: 24, color: paper.onDark, marginTop: 2 },
  statNote: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    lineHeight: 15,
    color: paper.onDarkFaint,
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: paper.onDarkHairline,
  },
  notices: { marginHorizontal: 16, gap: 8 },
  footer: { marginTop: 'auto', paddingHorizontal: 20, paddingTop: 10, gap: 10 },
});

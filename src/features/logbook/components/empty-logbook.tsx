import { JournalArt } from '@/components/ui/journal-art';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Chip, Disclaimer } from '@/components/ui';
import { emptyLogbookChips } from '@/features/logbook/empty-logbook';
import { fonts, paper } from '@/ui/theme';

/** Illustrated first-flight invitation, personalized with the available setup details. */
export function EmptyLogbook({
  pilotName = null,
  gliderType = null,
  locationReady = false,
  hasSetup = true,
  onRecord,
  disabled = false,
  busyLabel,
}: {
  pilotName?: string | null;
  /** Named here so the chips can promise it by name rather than in the abstract. */
  gliderType?: string | null;
  locationReady?: boolean;
  hasSetup?: boolean;
  onRecord: () => void;
  disabled?: boolean;
  busyLabel?: string | null;
}) {
  const chips = emptyLogbookChips({ gliderType, locationReady });
  const title = !hasSetup
    ? 'No flights yet.'
    : pilotName
      ? `Nothing here yet, ${pilotName.split(' ')[0]}.`
      : 'Your logbook starts with one flight.';
  const body = !hasSetup
    ? 'You can record right now — the rest can be filled in when you land.'
    : hasSetup && pilotName
      ? 'Tap record before launch and stop after landing. Add a launch name and a few memories when you save.'
      : 'Tap record before you launch and stop after you land. The track and its stats stay on this phone — no account, no signal needed.';
  return (
    <View style={styles.wrap}>
      <JournalArt scene="launch" height={210} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.chips}>
        {chips.map((chip) => (
          <Chip key={chip.key} label={chip.label} tone={chip.tone} />
        ))}
      </View>
      <View style={styles.cta}>
        <Button
          label={busyLabel ?? 'Record your first flight'}
          variant="primary"
          size="lg"
          leadingDot={!busyLabel}
          onPress={onRecord}
          disabled={disabled}
        />
        <Disclaimer className="px-[8px]">
          Not a certified flight recorder. Never fly with this as your only recorder.
        </Disclaimer>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 24, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 14 },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: 22,
    lineHeight: 28,
    color: paper.ink,
    textAlign: 'center',
    marginTop: 30,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 21,
    color: paper.text,
    textAlign: 'center',
    marginTop: 12,
  },
  cta: { alignSelf: 'stretch', marginTop: 34, gap: 14 },
});

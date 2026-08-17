import { StyleSheet, Text, View } from 'react-native';

import { Button, Disclaimer } from '@/components/flight-ui';
import { fonts, paper } from '@/ui/theme';

export function EmptyLogbook({
  onRecord,
  disabled = false,
  busyLabel,
}: {
  onRecord: () => void;
  disabled?: boolean;
  busyLabel?: string | null;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.placeholder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.placeholderValue}>0:00</Text>
        <Text style={styles.placeholderLabel}>AIRTIME</Text>
      </View>
      <Text style={styles.title}>Your logbook starts with one flight.</Text>
      <Text style={styles.body}>
        Tap record before you launch and stop after you land. The track and its stats stay on this
        phone — no account, no signal needed.
      </Text>
      <View style={styles.cta}>
        <Button
          label={busyLabel ?? 'Record your first flight'}
          variant="primary"
          size="lg"
          leadingDot={!busyLabel}
          onPress={onRecord}
          disabled={disabled}
        />
        <Disclaimer style={styles.disclaimer}>
          Not a certified flight recorder. Never fly with this as your only recorder.
        </Disclaimer>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 30, paddingTop: 44, alignItems: 'center' },
  placeholder: {
    width: 150,
    height: 150,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CFC2A8',
    backgroundColor: '#EFE7D6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  placeholderValue: { fontFamily: fonts.monoSemi, fontSize: 34, letterSpacing: -1, color: paper.faint },
  placeholderLabel: { fontFamily: fonts.sansSemi, fontSize: 9.5, letterSpacing: 1.3, color: paper.faint },
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
  disclaimer: { paddingHorizontal: 8 },
});

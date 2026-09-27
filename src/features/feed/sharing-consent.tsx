import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SectionLabel } from '@/components/ui';
import { paper, radii } from '@/ui/theme';
import { feedStyles as styles } from './styles';

/** The same explicit field boundary appears before manual and automatic sharing. */
export const SHARED_FLIGHT_FIELDS = 'Your flight title, site, date and times, full route including its start and end locations, flight statistics and replay are shared.';
export const PRIVATE_FLIGHT_FIELDS = 'Your notes, private pilot details, registration, original files and recorder diagnostics stay private.';
export const SHARED_FLIGHT_AUDIENCE = 'Current accepted friends can see your shared flights, including friends you add later.';

export function SharingConsent({ automatic = false }: { automatic?: boolean }) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.2;
  return <View style={styles.section}>
    <View style={consent.audience}>
      <SectionLabel>Who sees it</SectionLabel>
      <Text style={styles.name}>Your accepted friends</Text>
    </View>
    <View style={[consent.fields, !stacked && consent.columns]}>
      <View style={[consent.column, !stacked && consent.columnWidth]}><SectionLabel>They see</SectionLabel>
        <Text style={styles.body}>{SHARED_FLIGHT_FIELDS}</Text></View>
      <View style={[consent.column, !stacked && consent.columnWidth, stacked ? consent.dividerTop : consent.dividerLeft]}><SectionLabel>Stays yours</SectionLabel>
        <Text style={styles.body}>{PRIVATE_FLIGHT_FIELDS}</Text></View>
    </View>
    <Text style={styles.body}>{SHARED_FLIGHT_AUDIENCE}</Text>
    {automatic ? <Text style={styles.helper}>Flights recorded after you turn this on will be shared after saving and syncing. Existing flights stay private until you share them. Turning it off stops future posts; flights already shared stay visible until you hide them.</Text>
      : <Text style={styles.helper}>You can hide this flight later. Changes to its title or site appear after backup sync without moving it to the top of the feed.</Text>}
  </View>;
}

const consent = StyleSheet.create({
  audience: { gap: 8, padding: 16, borderWidth: 1, borderColor: paper.border, backgroundColor: paper.card, borderRadius: radii.controlLarge },
  fields: { borderWidth: 1, borderColor: paper.border, borderRadius: radii.controlLarge, backgroundColor: paper.card, overflow: 'hidden' },
  columns: { flexDirection: 'row' },
  column: { padding: 16, gap: 10 },
  columnWidth: { flex: 1 },
  dividerTop: { borderTopWidth: 1, borderTopColor: paper.border },
  dividerLeft: { borderLeftWidth: 1, borderLeftColor: paper.border },
});

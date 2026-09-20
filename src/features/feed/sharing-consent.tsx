import { Text, View } from 'react-native';
import { feedStyles as styles } from './styles';

/** The same explicit field boundary appears before manual and automatic sharing. */
export const SHARED_FLIGHT_FIELDS = 'Your flight title, site, date and times, full route including its start and end locations, flight statistics and replay are shared.';
export const PRIVATE_FLIGHT_FIELDS = 'Your notes, private pilot details, registration, original files and recorder diagnostics stay private.';
export const SHARED_FLIGHT_AUDIENCE = 'Current accepted friends can see your shared flights, including friends you add later.';

export function SharingConsent({ automatic = false }: { automatic?: boolean }) {
  return <View style={styles.section}>
    <Text style={styles.body}>{SHARED_FLIGHT_FIELDS}</Text>
    <Text style={styles.body}>{PRIVATE_FLIGHT_FIELDS}</Text>
    <Text style={styles.body}>{SHARED_FLIGHT_AUDIENCE}</Text>
    {automatic ? <Text style={styles.helper}>Flights recorded after you turn this on will be shared after saving and syncing. Existing flights stay private until you share them. Turning it off stops future posts; flights already shared stay visible until you hide them.</Text>
      : <Text style={styles.helper}>You can hide this flight later. Changes to its title or site appear after backup sync without moving it to the top of the feed.</Text>}
  </View>;
}

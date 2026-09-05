import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui';
import {
  identityName,
  identitySubtitle,
  pilotInitials,
  type AccountStats,
} from '@/features/account/account-identity';
import { formatAirtimeShort } from '@/lib/format/flight-format';
import type { PilotProfile } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

/**
 * Who this pilot is, and what their logbook amounts to.
 *
 * The stats are the reason this card exists rather than a plain header: the point of the
 * Account screen after the rework is to be a summary you are glad to look at, not a form
 * you scroll past.
 */
export function IdentityCard({
  profile,
  stats,
  onEdit,
}: {
  profile: PilotProfile;
  stats: AccountStats;
  onEdit: () => void;
}) {
  const subtitle = identitySubtitle(profile);
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Avatar initials={pilotInitials(profile)} />
        <View style={styles.names}>
          <Text style={styles.name} numberOfLines={2}>
            {identityName(profile)}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : (
            <Text style={styles.subtitlePrompt} numberOfLines={2}>
              No glider set
            </Text>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit pilot details"
          hitSlop={10}
          onPress={onEdit}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}>
          <Text style={styles.editLabel}>Edit</Text>
        </Pressable>
      </View>

      <View style={styles.stats}>
        <Stat label="FLIGHTS" value={String(stats.flightCount)} />
        <Stat label="AIRTIME" value={formatAirtimeShort(stats.airtimeMs)} />
        <Stat label="SINCE" value={stats.sinceLabel ?? '—'} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 14,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  names: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.sansBold, fontSize: 22, letterSpacing: -0.2, color: paper.ink },
  subtitle: { fontFamily: fonts.sans, fontSize: 12, color: paper.text },
  subtitlePrompt: { fontFamily: fonts.sans, fontSize: 12, color: paper.muted },
  edit: {
    borderWidth: 1,
    borderColor: paper.border,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  editLabel: { fontFamily: fonts.sansSemi, fontSize: 11.5, color: paper.ink },
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: paper.hairline,
    paddingTop: 12,
  },
  stat: { flex: 1, gap: 3 },
  statLabel: { fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 1.1, color: paper.muted },
  statValue: { fontFamily: fonts.sansBold, fontSize: 17, letterSpacing: -0.3, color: paper.ink },
});

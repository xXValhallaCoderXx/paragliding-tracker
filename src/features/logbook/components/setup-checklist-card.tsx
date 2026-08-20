import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChecklistKey, SetupChecklist } from '@/features/logbook/setup-checklist';
import { fonts, paper } from '@/ui/theme';

/**
 * The nudge shown to a pilot who skipped first-run setup.
 *
 * Every row is a link and nothing here blocks anything — the empty state underneath
 * still says "You can record right now". It disappears the moment the last item is done,
 * which is why `setupChecklist` returns null rather than an all-done list.
 */
export function SetupChecklistCard({
  checklist,
  onSelect,
}: {
  checklist: SetupChecklist;
  onSelect: (key: ChecklistKey) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{checklist.title}</Text>
        <Text style={styles.progress}>{checklist.progressLabel}</Text>
      </View>

      <View style={styles.track}>
        {checklist.items.map((item) => (
          <View
            key={item.key}
            style={[styles.segment, item.done ? styles.segmentDone : null]}
          />
        ))}
      </View>

      {checklist.items.map((item, index) => (
        <Pressable
          key={item.key}
          accessibilityRole={item.done ? undefined : 'button'}
          accessibilityLabel={item.done ? `${item.label}, done` : item.label}
          accessibilityHint={item.done ? undefined : item.detail}
          disabled={item.done}
          onPress={() => onSelect(item.key)}
          style={({ pressed }) => [
            styles.row,
            index === checklist.items.length - 1 ? styles.rowLast : null,
            pressed && !item.done ? styles.pressed : null,
          ]}>
          <Text style={[styles.tick, item.done ? styles.tickDone : null]}>
            {item.done ? '✓' : '○'}
          </Text>
          <View style={styles.rowText}>
            <Text style={[styles.rowLabel, item.done ? styles.rowLabelDone : null]}>
              {item.label}
            </Text>
            {item.detail ? <Text style={styles.rowDetail}>{item.detail}</Text> : null}
          </View>
          {item.done ? null : <Text style={styles.chevron}>›</Text>}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 4,
    gap: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  title: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: paper.ink, flexShrink: 1 },
  progress: { fontFamily: fonts.monoSemi, fontSize: 9.5, letterSpacing: 1.1, color: paper.muted },
  track: { flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: paper.border },
  segmentDone: { backgroundColor: paper.thermal },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: paper.hairline,
  },
  rowLast: { borderBottomWidth: 0 },
  pressed: { opacity: 0.6 },
  tick: { fontFamily: fonts.sans, fontSize: 14, color: paper.muted, width: 16, textAlign: 'center' },
  tickDone: { color: paper.good },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: paper.ink },
  rowLabelDone: { color: paper.muted },
  rowDetail: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: paper.text },
  chevron: { fontFamily: fonts.sans, fontSize: 17, color: paper.muted },
});

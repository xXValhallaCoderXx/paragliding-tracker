import { StyleSheet } from 'react-native';
import { fonts, paper, radii } from '@/ui/theme';

export const feedLayout = StyleSheet.create({
  header: { gap: 12, marginBottom: 14 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, borderWidth: 1, borderColor: paper.border, backgroundColor: paper.card },
  refresh: { minHeight: 44, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  actionText: { fontFamily: fonts.sansSemi, fontSize: 13, lineHeight: 19, color: paper.ink },
  disabled: { opacity: 0.42 },
  dayHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  dayHeading: { flex: 1, fontFamily: fonts.monoMedium, fontSize: 10, lineHeight: 16, letterSpacing: 1.2,
    color: paper.muted, textTransform: 'uppercase' },
  empty: { gap: 18, paddingBottom: 12 },
  emptyCopy: { gap: 8 },
  emptyActions: { gap: 10 },
  card: { overflow: 'hidden', borderRadius: radii.card },
  identity: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  summary: { gap: 6, paddingHorizontal: 16, paddingVertical: 14 },
  cardFooter: { paddingHorizontal: 16, paddingBottom: 12, borderTopWidth: 1, borderTopColor: paper.hairline },
  kudos: { gap: 6 },
  kudosRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  kudosAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  kudosList: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, marginLeft: 'auto' },
  kudosGiven: { color: paper.thermal },
  audience: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, color: paper.muted },
});

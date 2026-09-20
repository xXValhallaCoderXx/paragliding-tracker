import { StyleSheet } from 'react-native';
import { fonts, paper } from '@/ui/theme';

export const friendsStyles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28, gap: 20 },
  header: { gap: 7 },
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1.4, color: paper.muted },
  title: { fontFamily: fonts.sansBold, fontSize: 30, color: paper.ink, letterSpacing: -0.8 },
  section: { gap: 10 },
  card: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.sansSemi, fontSize: 17, lineHeight: 23, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: paper.text },
  helper: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17, color: paper.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', borderRadius: 10,
    borderWidth: 1, borderColor: paper.border, backgroundColor: paper.card },
  actionText: { fontFamily: fonts.sansSemi, fontSize: 12, color: paper.ink },
  danger: { color: paper.danger },
  disabled: { opacity: 0.45 },
  profile: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  count: { fontFamily: fonts.sansBold, fontSize: 42, color: paper.ink },
  centered: { textAlign: 'center' },
});

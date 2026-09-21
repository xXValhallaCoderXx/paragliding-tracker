import { StyleSheet } from 'react-native';
import { fonts, paper } from '@/ui/theme';

export const feedStyles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 36, gap: 18 },
  section: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1.2, color: paper.muted },
  title: { fontFamily: fonts.sansSemi, fontSize: 30, lineHeight: 38, color: paper.ink },
  heading: { fontFamily: fonts.sansSemi, fontSize: 20, lineHeight: 27, color: paper.ink },
  name: { fontFamily: fonts.sansSemi, fontSize: 16, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: paper.text },
  helper: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
  metrics: { fontFamily: fonts.monoSemi, fontSize: 13, lineHeight: 21, color: paper.ink },
  card: { padding: 18, gap: 14 },
  date: { fontFamily: fonts.monoMedium, fontSize: 11, color: paper.muted },
  detailSection: { paddingHorizontal: 18, paddingTop: 20, gap: 12 },
  detailContent: { paddingBottom: 32 },
  pressed: { opacity: 0.72 },
});

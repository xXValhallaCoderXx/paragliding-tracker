import { useCallback, useEffect, type ReactNode } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { fonts, paper, radii, spacing } from '@/ui/theme';

/** A local confirmation, scoped to the screen that opened it. */
export function SharingSheet({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose(): void; children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  useFocusEffect(useCallback(() => () => onClose(), [onClose]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') onClose();
    });
    return () => subscription.remove();
  }, [onClose]);
  const dismiss = () => { if (!busy) onClose(); };
  return <Modal transparent visible animationType={reducedMotion ? 'none' : 'slide'}
    statusBarTranslucent onRequestClose={dismiss}>
    <View style={[styles.overlay, { paddingTop: insets.top + 24 }]}>
      <Pressable accessibilityLabel="Close sharing" accessibilityRole="button" disabled={busy}
        onPress={dismiss} style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View accessible={false} style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {children}
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: paper.ink, opacity: 0.22 },
  sheet: { maxHeight: '100%', flexShrink: 1, borderTopLeftRadius: radii.cardLarge, borderTopRightRadius: radii.cardLarge,
    backgroundColor: paper.background, overflow: 'hidden' },
  content: { padding: spacing.gutter, paddingTop: 12, gap: 18 },
  handle: { width: 36, height: 4, borderRadius: radii.pill, backgroundColor: paper.border, alignSelf: 'center', marginBottom: 4 },
  title: { fontFamily: fonts.sansBold, fontSize: 25, lineHeight: 32, color: paper.ink },
});

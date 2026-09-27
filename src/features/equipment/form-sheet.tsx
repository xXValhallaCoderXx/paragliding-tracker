import type { ReactNode } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet } from 'react-native';

import { Button, Screen, TopBar } from '@/components/ui';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export function dismissDraft(dirty: boolean, onClose: () => void, busy = false) {
  if (Keyboard.isVisible()) { Keyboard.dismiss(); return; }
  if (busy) {
    Alert.alert('Leave while saving?', 'Your submitted save may still finish. Leaving closes this form; it does not cancel the save.', [
      { text: 'Stay here', style: 'cancel' }, { text: 'Leave', onPress: onClose },
    ]);
    return;
  }
  if (!dirty) { onClose(); return; }
  Alert.alert('Discard your changes?', 'Your unsaved changes will be lost.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onClose },
  ]);
}

/** Mounted only while open: cancelled drafts never leak into the next visit. */
export function FormSheet({ title, dirty, busy, onClose, onSave, children }: {
  title: string; dirty: boolean; busy: boolean; onClose: () => void;
  onSave?: () => void; children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return <Modal visible animationType={reducedMotion ? 'none' : 'slide'}
    onRequestClose={() => dismissDraft(dirty, onClose, busy)}>
    <Screen>
      <TopBar title={title} onBack={() => dismissDraft(dirty, onClose, busy)} backLabel="Cancel"
        right={onSave ? <Button label={busy ? 'Saving…' : 'Save'} busy={busy} onPress={onSave} /> : undefined} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  </Modal>;
}

const styles = StyleSheet.create({ flex: { flex: 1 }, content: { padding: 18, paddingBottom: 36, gap: 18 } });

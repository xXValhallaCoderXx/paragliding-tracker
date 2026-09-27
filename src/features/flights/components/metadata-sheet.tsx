import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Notice, Screen } from '@/components/ui';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { FlightDetail } from '@/recorder/types';
import type { FlightUpdateRequest } from '@/lib/flight-mutations';
import { useFlightDraft } from '../use-flight-draft';
import { recordingCoordinate } from '../own-flight-presentation';
import { MetadataForm } from './metadata-form';
import { MetadataConflict } from './metadata-conflict';
import { CapturedAircraft } from './captured-aircraft';

export function MetadataSheet({ flight, onClose, onSave, onDelete, busy = false, actionError }: {
  flight: FlightDetail; onClose: () => void;
  onSave: (request: FlightUpdateRequest) => Promise<FlightDetail>;
  onDelete?: () => void; busy?: boolean; actionError?: string | null;
}) {
  const editor = useFlightDraft(flight, onSave);
  const reducedMotion = useReducedMotion();
  const close = () => { if (editor.current() && !editor.locked.current && !busy) { Keyboard.dismiss(); onClose(); } };
  const cancel = () => {
    if (!editor.current() || editor.locked.current || busy) return;
    if (!editor.dirty) return close();
    Keyboard.dismiss();
    Alert.alert('Discard unsaved details?', 'The saved flight and its recorded track stay in your logbook.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: close },
    ]);
  };
  const save = async () => { if (await editor.save()) close(); };
  return <Modal visible animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="fullScreen" onRequestClose={() => {
    if (Keyboard.isVisible()) { Keyboard.dismiss(); return; } cancel();
  }}>
    <Screen>
      <View className="gap-[10px] px-[18px] py-[12px]">
        <Text accessibilityRole="header" className="font-body-bold text-[28px] text-ink">Edit flight</Text>
        <Button label="Cancel" disabled={editor.saving || busy} onPress={cancel} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 36, gap: 20 }} keyboardShouldPersistTaps="handled">
          <MetadataConflict editor={editor} />
          {actionError ? <Notice tone="danger" title="Action needs attention">{actionError}</Notice> : null}
          <MetadataForm values={editor.draft} onChange={editor.setDraft} dirty={editor.dirty} saving={editor.saving}
            disabled={editor.saving || busy} onSave={() => void save()} takeoff={recordingCoordinate(flight)} />
          <CapturedAircraft flight={flight} />
          {onDelete ? <Button label="Delete this flight" variant="danger" disabled={editor.saving || busy} onPress={onDelete} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  </Modal>;
}

import { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';

import { Button, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { FlightDetail, FlightMetadataPatch } from '@/recorder/types';
import { flightDraft, flightPatch, hasFlightEdits } from '../metadata-editor';
import { MetadataForm } from './metadata-form';

/** Mounted only while editing: a fresh snapshot on every open, stable throughout edits. */
export function MetadataSheet({ flight, onClose, onSave }: {
  flight: FlightDetail;
  onClose: () => void;
  onSave: (patch: FlightMetadataPatch) => Promise<void>;
}) {
  const [initial] = useState(() => flightDraft(flight));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const dirty = hasFlightEdits(draft, initial);
  const cancel = () => {
    if (savingRef.current) return;
    if (!dirty) return onClose();
    Alert.alert('Discard unsaved details?', 'Your recorded track is not affected.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };
  const save = async () => {
    if (savingRef.current || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(flightPatch(draft, initial));
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal visible animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="fullScreen" onRequestClose={cancel}>
      <Screen>
        <View className="gap-[12px] px-[18px] pt-[12px] pb-[16px]">
          <Text accessibilityRole="header" className="font-body-bold text-[28px] text-ink">Edit flight</Text>
          <Button label="Cancel" disabled={saving} onPress={cancel} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
            {error ? <View className="px-[16px]"><Notice tone="danger" title="Could not save details">{error}</Notice></View> : null}
            <MetadataForm
              values={draft} onChange={setDraft} dirty={dirty} saving={saving} disabled={saving}
              onSave={() => void save()}
              takeoff={flight.takeoffLatitude !== null && flight.takeoffLongitude !== null
                ? { latitude: flight.takeoffLatitude, longitude: flight.takeoffLongitude } : null}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </Modal>
  );
}

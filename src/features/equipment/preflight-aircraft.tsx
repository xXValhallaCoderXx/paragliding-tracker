import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BusyRow, Button, Card, Notice, Screen, TopBar } from '@/components/ui';
import type { EquipmentCaptureIntent, EquipmentInventory } from '@/equipment/types';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { fonts, paper } from '@/ui/theme';
import { aircraftName, captureIntent, currentAircraft, SPORT_LABELS } from './presentation';

export function PreflightAircraft({ inventory, selection, loading, error, disabled, onSelect, onRetry }: {
  inventory?: EquipmentInventory; selection: EquipmentCaptureIntent | null; loading: boolean;
  error: boolean; disabled: boolean; onSelect: (intent: EquipmentCaptureIntent) => void; onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const explicitNone = selection?.aircraftId === null;
  const selected = inventory ? selection ? inventory.aircraft.find((item) => item.id === selection.aircraftId) : currentAircraft(inventory) : null;
  const unavailable = Boolean(selection?.aircraftId && (!selected || selected.value.archived || selected.generation !== selection.expectedGeneration || selection.owner !== inventory?.owner));
  const choose = (intent: EquipmentCaptureIntent) => { onSelect(intent); setOpen(false); };
  return <View style={styles.block}>
    <Card className="gap-[12px] p-[16px]">
      <Text style={styles.label}>AIRCRAFT FOR THIS FLIGHT</Text>
      {!explicitNone && loading ? <>
        <BusyRow label="Loading local aircraft…" />
        <Button label="Record without aircraft details" disabled={disabled} onPress={() => onSelect({ aircraftId: null })} />
      </> : !explicitNone && error ? <>
        <Notice tone="warning" title="Aircraft list unavailable">Retry the local list, or choose to record without aircraft details.</Notice>
        <Button label="Retry aircraft" onPress={onRetry} />
        <Button label="Record without aircraft details" disabled={disabled} onPress={() => onSelect({ aircraftId: null })} />
      </> : <>
        <Text style={styles.title}>{selected ? aircraftName(selected.value) : 'No aircraft selected'}</Text>
        {unavailable ? <Notice tone="warning" title="Review your aircraft">This aircraft changed. Choose it again to review its current details, or record without an aircraft.</Notice> : null}
        <Text style={styles.hint}>Saved with this flight when recording starts. This choice does not change your current aircraft.</Text>
        <Button label="Change aircraft" disabled={disabled || !inventory} onPress={() => setOpen(true)} />
        {!inventory ? <Button label="Retry aircraft" onPress={onRetry} /> : null}
      </>}
    </Card>
    {open && inventory ? <Modal visible animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(false)}>
      <Screen><TopBar title="Aircraft for this flight" onBack={() => setOpen(false)} />
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="No aircraft selected" onPress={() => choose(captureIntent(inventory, null))} />
          {inventory.aircraft.filter((item) => !item.value.archived).map((item) => <Card key={item.id} className="gap-[10px] p-[16px]">
            <Text style={styles.hint}>{SPORT_LABELS[item.value.sport]}{item.id === inventory.selection.value.aircraftId ? ' · Current' : ''}</Text>
            <Button label={aircraftName(item.value)} onPress={() => choose(captureIntent(inventory, item))} />
          </Card>)}
          <Text style={styles.hint}>Add or edit aircraft from Pilot. You can record without equipment.</Text>
        </ScrollView>
      </Screen>
    </Modal> : null}
  </View>;
}

const styles = StyleSheet.create({
  block: { marginHorizontal: 16 }, content: { padding: 18, gap: 12 },
  label: { fontFamily: fonts.monoSemi, fontSize: 12, color: paper.muted, letterSpacing: 1 },
  title: { fontFamily: fonts.sansSemi, fontSize: 18, color: paper.ink },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
});

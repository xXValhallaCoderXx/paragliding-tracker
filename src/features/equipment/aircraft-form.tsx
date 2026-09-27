import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Card, Input, Notice, SectionLabel } from '@/components/ui';
import { SPORTS, type Aircraft, type EquipmentEntity, type EquipmentInventory, type SaveAircraftInput, type Sport } from '@/equipment/types';
import { matchGliders } from '@/features/onboarding/glider-suggestions';
import { errorMessage } from '@/lib/format/error-message';
import { sanitizeIgcHeaderValue } from '@/recorder/igc';
import type { PilotProfile } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';
import { FormSheet } from './form-sheet';
import { AIRCRAFT_LABELS, SPORT_LABELS } from './presentation';

export function AircraftForm({ inventory, aircraft, profile, onSave, onArchive, onReload, onClose }: {
  inventory: EquipmentInventory; aircraft?: EquipmentEntity<Aircraft>; profile: PilotProfile | null;
  onSave: (input: SaveAircraftInput) => Promise<unknown>;
  onArchive: (aircraft: EquipmentEntity<Aircraft>, archived: boolean) => Promise<unknown>;
  onReload: () => Promise<EquipmentInventory>;
  onClose: () => void;
}) {
  const legacy = !aircraft && inventory.aircraft.length === 0;
  const initialModel = aircraft?.value.model ?? (legacy ? profile?.gliderType : null) ?? '';
  const initialRegistration = aircraft?.value.registrationId ?? (legacy ? profile?.gliderId : null) ?? '';
  const initialCurrent = aircraft ? inventory.selection.value.aircraftId === aircraft.id : !inventory.selection.value.aircraftId;
  const [sport, setSport] = useState<Sport | null>(aircraft?.value.sport ?? null);
  const [model, setModel] = useState(initialModel);
  const [size, setSize] = useState(aircraft?.value.size ?? '');
  const [registrationId, setRegistrationId] = useState(initialRegistration);
  const [makeCurrent, setMakeCurrent] = useState(initialCurrent);
  const [identifiers, setIdentifiers] = useState<Partial<Record<Sport, string>>>({});
  const [editingIdentifiers, setEditingIdentifiers] = useState<Partial<Record<Sport, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [basis, setBasis] = useState(inventory);
  const [review, setReview] = useState<EquipmentInventory | null>(null);
  const [failedSave, setFailedSave] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const identity = basis.identities.find((item) => item.value.sport === sport);
  const savedAircraft = basis.aircraft.find((item) => item.id === aircraft?.id);
  const identifier = sport ? identifiers[sport] ?? identity?.value.pilotIdentifier ?? '' : '';
  const editingIdentifier = sport ? editingIdentifiers[sport] || !identity?.value.pilotIdentifier : false;
  const dirty = sport !== (aircraft?.value.sport ?? null) || model !== initialModel || size !== (aircraft?.value.size ?? '') ||
    registrationId !== initialRegistration || makeCurrent !== initialCurrent || Object.keys(identifiers).some((key) =>
      identifiers[key as Sport] !== (inventory.identities.find((item) => item.value.sport === key)?.value.pilotIdentifier ?? ''));

  const perform = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try { await action(); if (mounted.current) onClose(); }
    catch (failure) { if (mounted.current) { setError(errorMessage(failure)); setFailedSave(true); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const save = () => {
    if (inFlight.current) return;
    if (review) { setError('Review the saved details below, then choose Keep my edits before saving.'); return; }
    if (!sport) { setError('Choose a sport for this aircraft.'); return; }
    if (!model.trim()) { setError('Enter the aircraft make and model.'); return; }
    void perform(() => onSave({ owner: inventory.owner, id: aircraft?.id,
      expectedGeneration: savedAircraft?.generation, sport, model: model.trim(), size: size.trim() || null,
      registrationId: registrationId.trim() || null, makeCurrent,
      expectedSelectionGeneration: basis.selection.generation,
      ...(editingIdentifier ? { identity: { pilotIdentifier: identifier.trim() || null, expectedGeneration: identity?.generation ?? 0 } } : {}),
    }));
  };
  const reviewLatest = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setReview(null);
    try {
      const latest = await onReload();
      if (!mounted.current) return;
      if (latest.owner !== inventory.owner) throw new Error('The account changed. This draft cannot be moved to another account. Close this form and reopen Pilot.');
      const target = latest.aircraft.find((item) => item.id === aircraft?.id);
      if (aircraft && (!target || target.value.archived)) throw new Error('This aircraft was archived or removed. Close this form and restore it from Pilot before editing. Your draft is still shown here.');
      if (target?.conflict || latest.selection.conflict || latest.identities.find((item) => item.value.sport === sport)?.conflict) {
        throw new Error('Resolve the other-device equipment conflict on Pilot first. This draft has not replaced either version.');
      }
      setReview(latest); setError(null);
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const keepEdits = () => {
    if (!review) return;
    // Retain even an intentionally blank sport identifier after its saved version changes.
    if (sport && editingIdentifier) {
      setIdentifiers({ ...identifiers, [sport]: identifier });
      setEditingIdentifiers({ ...editingIdentifiers, [sport]: true });
    }
    setBasis(review); setReview(null); setError(null); setFailedSave(false);
  };
  const archive = () => {
    if (!savedAircraft || inFlight.current) return;
    Alert.alert('Archive this aircraft?', basis.selection.value.aircraftId === savedAircraft.id
      ? 'It will leave your active list and clear the current aircraft. Recorded flights keep their equipment. You can restore it later.'
      : 'It will leave your active list. Recorded flights keep their equipment. You can restore it later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void perform(() => onArchive(savedAircraft, true)) },
    ]);
  };
  const suggestions = sport === 'paragliding' && suggesting ? matchGliders(model) : [];
  return <FormSheet title={aircraft ? 'Edit aircraft' : 'Add aircraft'} dirty={dirty} busy={busy} onClose={onClose} onSave={save}>
    {error ? <Notice tone="danger" title="Could not save">{error}</Notice> : null}
    {failedSave && !review ? <Button label="Review latest saved details" disabled={busy} onPress={() => void reviewLatest()} /> : null}
    {review ? <Card className="gap-[12px] p-[16px]">
      <Text style={styles.body}>Review latest saved details</Text>
      <Text style={styles.hint}>{`Saved now: ${reviewDetails(review, aircraft?.id, sport)}`}</Text>
      <Text style={styles.hint}>{`Your edits: ${sport ? SPORT_LABELS[sport] : 'No sport'}; model ${model || 'None'}; size ${size || 'None'}; aircraft ID ${registrationId || 'None'}; ${makeCurrent ? 'use for new flights' : 'not current'}; pilot identifier ${editingIdentifier ? identifier || 'None' : 'unchanged by this form'}.`}</Text>
      <Text style={styles.hint}>Keep my edits preserves this draft against the saved details shown above. Nothing is saved until you tap Save.</Text>
      <Button label="Keep my edits" onPress={keepEdits} />
      <Button label="Back to editing" onPress={() => setReview(null)} />
    </Card> : null}
    <View style={styles.block}>
      <SectionLabel>What kind</SectionLabel>
      <View style={styles.sports}>
        {SPORTS.map((value) => <Pressable key={value} accessibilityRole="radio"
          accessibilityLabel={AIRCRAFT_LABELS[value]} accessibilityState={{ checked: sport === value, disabled: busy }}
          disabled={busy} onPress={() => { setSport(value); setSuggesting(false); }}
          style={[styles.sport, sport === value && styles.selected]}>
          <Text style={[styles.sportLabel, sport === value && styles.selectedLabel]}>{AIRCRAFT_LABELS[value]}</Text>
        </Pressable>)}
      </View>
    </View>
    <Card className="px-[16px] py-[4px]">
      <Input label="Make and model" value={model} placeholder="Aircraft make and model" maxLength={60} editable={!busy}
        onFocus={() => setSuggesting(true)} onChangeText={(value) => { setModel(value); setSuggesting(true); }} />
      {suggestions.map((name) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`Use ${name}`}
        disabled={busy} onPress={() => { setModel(name); setSuggesting(false); }} style={styles.suggestion}>
        <Text style={styles.body}>{name}</Text>
      </Pressable>)}
      <Input label="Size — optional" value={size} placeholder="For example, ML or 155" maxLength={20} editable={!busy}
        onFocus={() => setSuggesting(false)} onChangeText={setSize} />
      <Input label="Aircraft registration / ID — optional" value={registrationId} placeholder="Aircraft registration" maxLength={30}
        editable={!busy} onFocus={() => setSuggesting(false)} onChangeText={setRegistrationId} last />
    </Card>
    {sport ? <View style={styles.block}>
      <SectionLabel>{`${SPORT_LABELS[sport]} pilot identifier`}</SectionLabel>
      {editingIdentifier ? <Card className="px-[16px] py-[4px]">
        <Input label="Pilot identifier — optional" value={identifier} placeholder="APPI, FAI or club number" maxLength={30}
          editable={!busy} onChangeText={(value) => setIdentifiers({ ...identifiers, [sport]: value })}
          hint={`Private and shared by your ${SPORT_LABELS[sport].toLowerCase()} aircraft. Not written into IGC files.`} last />
      </Card> : <Card className="gap-[8px] p-[16px]">
        <Text style={styles.body}>{identifier}</Text>
        <Text style={styles.hint}>{`Already on file for ${SPORT_LABELS[sport].toLowerCase()}.`}</Text>
        <Button label="Edit pilot identifier" disabled={busy} onPress={() => setEditingIdentifiers({ ...editingIdentifiers, [sport]: true })} />
      </Card>}
    </View> : null}
    <View style={styles.toggle}>
      <View style={styles.flex}><Text style={styles.body}>Use for new flights</Text><Text style={styles.hint}>One current aircraft across all sports. You can change it in preflight.</Text></View>
      <Switch accessibilityLabel="Use for new flights" value={makeCurrent} disabled={busy} onValueChange={setMakeCurrent} />
    </View>
    <View style={styles.block}>
      <SectionLabel>IGC equipment headers</SectionLabel>
      <Card className="gap-[5px] p-[16px]">
        <Text style={styles.mono}>HFGTYGLIDERTYPE:{sanitizeIgcHeaderValue(model) ?? 'UNSPECIFIED'}</Text>
        <Text style={styles.mono}>HFGIDGLIDERID:{sanitizeIgcHeaderValue(registrationId) ?? 'UNSPECIFIED'}</Text>
      </Card>
      <Text style={styles.hint}>Equipment is saved when recording starts. Editing this aircraft changes future flights. Recorded flights and existing IGC files keep their equipment.</Text>
    </View>
    {aircraft ? <Button label="Archive aircraft" variant="danger" disabled={busy} onPress={archive} /> : null}
  </FormSheet>;
}

function reviewDetails(inventory: EquipmentInventory, aircraftId: string | undefined, sport: Sport | null): string {
  const aircraft = inventory.aircraft.find((item) => item.id === aircraftId)?.value;
  const current = inventory.aircraft.find((item) => item.id === inventory.selection.value.aircraftId)?.value;
  const identifier = inventory.identities.find((item) => item.value.sport === sport)?.value.pilotIdentifier;
  return `${aircraft ? `${SPORT_LABELS[aircraft.sport]}; model ${aircraft.model}; size ${aircraft.size ?? 'None'}; aircraft ID ${aircraft.registrationId ?? 'None'}` : 'New aircraft, not saved'}; current aircraft ${current?.model ?? 'None'}; ${sport ? SPORT_LABELS[sport] : 'sport'} pilot identifier ${identifier ?? 'None'}.`;
}

const styles = StyleSheet.create({
  block: { gap: 8 }, flex: { flex: 1, gap: 5 }, sports: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sport: { borderWidth: 1, borderColor: paper.border, borderRadius: 16, minHeight: 50, padding: 12, justifyContent: 'center' },
  selected: { backgroundColor: paper.ink, borderColor: paper.ink },
  sportLabel: { fontFamily: fonts.sansSemi, fontSize: 14, color: paper.ink }, selectedLabel: { color: paper.onDark },
  body: { fontFamily: fonts.sansSemi, fontSize: 15, color: paper.ink },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: paper.text },
  suggestion: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});

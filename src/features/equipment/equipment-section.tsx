import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BusyRow, Button, Card, Input, Notice, SectionLabel, StateLabel } from '@/components/ui';
import { equipmentRepository } from '@/equipment/repository';
import { SPORTS, type Aircraft, type EquipmentEntity, type EquipmentInventory, type EquipmentValue, type Sport } from '@/equipment/types';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import { errorMessage } from '@/lib/format/error-message';
import type { PilotProfile } from '@/recorder/types';
import { useGetEquipmentInventoryQuery } from '@/store/endpoints';
import { fonts, paper } from '@/ui/theme';
import { AircraftForm } from './aircraft-form';
import { FormSheet } from './form-sheet';
import { aircraftName, SPORT_LABELS } from './presentation';

export function EquipmentSection({ ready, profile }: { ready: boolean; profile: PilotProfile | null }) {
  const query = useGetEquipmentInventoryQuery(undefined, { skip: !ready });
  const sync = useCloudSync();
  const [editor, setEditor] = useState<{ inventory: EquipmentInventory; aircraft?: EquipmentEntity<Aircraft> } | null>(null);
  const [identityEditor, setIdentityEditor] = useState<{ inventory: EquipmentInventory; sport: Sport } | null>(null);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const inventory = query.data;
  const mutate = async (action: () => Promise<unknown>) => {
    const result = await action();
    sync.requestSync('post-save');
    return result;
  };
  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await mutate(action); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const conflicts = inventory ? [...inventory.aircraft, ...inventory.identities, inventory.selection].filter((item) => item.conflict) : [];
  const resolve = (entity: EquipmentEntity, choice: 'keep_local' | 'use_remote') => {
    if (!inventory || !entity.conflict) return;
    Alert.alert(choice === 'keep_local' ? 'Keep this device’s changes?' : 'Use the other device’s version?',
      `This device: ${describeValue(entity.value, inventory)}\n\nOther device: ${describeValue(entity.conflict.value, inventory)}`,
      [{ text: 'Cancel', style: 'cancel' }, { text: choice === 'keep_local' ? 'Keep this device' : 'Use other device',
        onPress: () => void run(() => equipmentRepository.resolveConflict(inventory.owner, entity.kind, entity.id, choice, { generation: entity.generation, remoteRevision: entity.conflict!.revision })) }]);
  };
  return <View style={styles.section}>
    <SectionLabel>What you fly</SectionLabel>
    {!ready || query.isLoading ? <BusyRow label="Loading aircraft…" /> : null}
    {query.isError ? <View style={styles.section}><Notice tone="danger" title="Could not load aircraft">Your local list could not be read. Try again.</Notice>
      <Button label="Retry aircraft" onPress={() => void query.refetch()} /></View> : null}
    {error ? <Notice tone="danger" title="Could not update aircraft">{error}</Notice> : null}
    {inventory ? <>
      {inventory.aircraft.every((item) => item.value.archived) ? <Card className="gap-[12px] p-[20px]">
        <Text style={styles.title}>Nothing added yet</Text>
        <Text style={styles.body}>Add an aircraft to choose it for future recordings and carry its details into new IGC exports.</Text>
      </Card> : null}
      {SPORTS.map((sport) => {
        const aircraft = inventory.aircraft.filter((item) => item.value.sport === sport && !item.value.archived);
        if (!aircraft.length) return null;
        const identity = inventory.identities.find((item) => item.value.sport === sport);
        return <Card key={sport} className="gap-[8px] p-[16px]">
          <Text style={styles.title}>{SPORT_LABELS[sport]}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${SPORT_LABELS[sport]} pilot identifier`}
            style={styles.identifier} onPress={() => setIdentityEditor({ inventory, sport })}>
            <Text style={styles.hint}>{identity?.value.pilotIdentifier ?? 'Add pilot identifier'}</Text>
            <Text style={styles.link}>Edit</Text>
          </Pressable>
          {aircraft.map((item) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`Edit ${aircraftName(item.value)}${item.id === inventory.selection.value.aircraftId ? ', current aircraft' : ''}`}
            onPress={() => setEditor({ inventory, aircraft: item })} style={styles.aircraft}>
            <View style={styles.flex}>
              <Text style={styles.aircraftName}>{aircraftName(item.value)}</Text>
              {item.value.registrationId ? <Text style={styles.hint}>{item.value.registrationId}</Text> : null}
              {item.id === inventory.selection.value.aircraftId ? <StateLabel label="Current" tone="good" /> : null}
            </View><Text style={styles.chevron}>›</Text>
          </Pressable>)}
        </Card>;
      })}
      <Button label={inventory.aircraft.some((item) => !item.value.archived) ? 'Add another aircraft' : 'Add aircraft'}
        variant="primary" onPress={() => setEditor({ inventory })} />
      {inventory.aircraft.some((item) => item.value.archived) ? <>
        <Button label={archived ? 'Hide archived aircraft' : 'Archived aircraft'} onPress={() => setArchived(!archived)} />
        {archived ? inventory.aircraft.filter((item) => item.value.archived).map((item) => <Card key={item.id} className="gap-[10px] p-[16px]">
          <Text style={styles.aircraftName}>{aircraftName(item.value)}</Text><Text style={styles.hint}>{SPORT_LABELS[item.value.sport]} · Archived</Text>
          <Button label={`Restore ${aircraftName(item.value)}`} disabled={busy}
            onPress={() => void run(() => equipmentRepository.setArchived(inventory.owner, item.id, false, item.generation))} />
        </Card>) : null}
      </> : null}
      {conflicts.map((item) => <View key={`${item.kind}:${item.id}`} style={styles.section}>
        <Notice tone="warning" title="Equipment changed on another device">{`This device: ${describeValue(item.value, inventory)}\nOther device: ${describeValue(item.conflict!.value, inventory)}`}</Notice>
        <Button label="Use other device’s version" disabled={busy} onPress={() => resolve(item, 'use_remote')} />
        <Button label="Review and keep this device’s changes" disabled={busy} onPress={() => resolve(item, 'keep_local')} />
      </View>)}
      {inventory.owner !== 'guest' && [...inventory.aircraft, ...inventory.identities, inventory.selection].some((item) => item.pending) ?
        <Text style={styles.hint}>Equipment changes are saved on this phone. Backup is pending; check Account &amp; backup below.</Text> : null}
      <Text style={styles.hint}>Your aircraft and sport identifiers are private. Recorded flights keep the equipment selected when recording began.</Text>
    </> : null}
    {editor ? <AircraftForm key={`${editor.inventory.owner}:${editor.aircraft?.id ?? 'new'}`} {...editor} profile={profile}
      onReload={() => equipmentRepository.getInventory()}
      onSave={(input) => mutate(() => equipmentRepository.saveAircraft(input))}
      onArchive={(item, value) => mutate(() => equipmentRepository.setArchived(editor.inventory.owner, item.id, value, item.generation))}
      onClose={() => setEditor(null)} /> : null}
    {identityEditor ? <SportIdentityForm {...identityEditor}
      onSave={(value, generation) => mutate(() => equipmentRepository.saveIdentity(identityEditor.inventory.owner, identityEditor.sport, value, generation))}
      onClose={() => setIdentityEditor(null)} /> : null}
  </View>;
}

export function SportIdentityForm({ inventory, sport, onSave, onClose }: {
  inventory: EquipmentInventory; sport: Sport; onSave: (value: string | null, generation?: number) => Promise<unknown>; onClose: () => void;
}) {
  const identity = inventory.identities.find((item) => item.value.sport === sport);
  const [value, setValue] = useState(identity?.value.pilotIdentifier ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(identity?.generation ?? 0);
  const [review, setReview] = useState<EquipmentInventory | null>(null);
  const [failedSave, setFailedSave] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async () => {
    if (inFlight.current) return;
    if (review) { setError('Review the saved identifier below, then choose Keep my edits before saving.'); return; }
    inFlight.current = true; setBusy(true); setError(null);
    try { await onSave(value.trim() || null, generation); if (mounted.current) onClose(); }
    catch (failure) { if (mounted.current) { setError(errorMessage(failure)); setFailedSave(true); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const reviewLatest = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setReview(null);
    try {
      const latest = await equipmentRepository.getInventory();
      if (!mounted.current) return;
      if (latest.owner !== inventory.owner) throw new Error('The account changed. This draft cannot be moved to another account. Close this form and reopen Pilot.');
      if (latest.identities.find((item) => item.value.sport === sport)?.conflict) throw new Error('Resolve the other-device equipment conflict on Pilot first. This draft has not replaced either version.');
      setReview(latest); setError(null);
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <FormSheet title={`${SPORT_LABELS[sport]} identifier`} dirty={value !== (identity?.value.pilotIdentifier ?? '')}
    busy={busy} onClose={onClose} onSave={() => void save()}>
    {error ? <Notice tone="danger" title="Could not save">{error}</Notice> : null}
    {failedSave && !review ? <Button label="Review latest saved details" disabled={busy} onPress={() => void reviewLatest()} /> : null}
    {review ? <Card className="gap-[12px] p-[16px]">
      <Text style={styles.body}>Review latest saved identifier</Text>
      <Text style={styles.hint}>{`Saved now: ${review.identities.find((item) => item.value.sport === sport)?.value.pilotIdentifier ?? 'None'}\nYour edits: ${value || 'None'}`}</Text>
      <Text style={styles.hint}>Keep my edits preserves this draft against the saved identifier shown above. Tap Save afterwards to apply it.</Text>
      <Button label="Keep my edits" onPress={() => {
        setGeneration(review.identities.find((item) => item.value.sport === sport)?.generation ?? 0);
        setReview(null); setError(null); setFailedSave(false);
      }} />
      <Button label="Back to editing" onPress={() => setReview(null)} />
    </Card> : null}
    <Input label="Pilot identifier — optional" value={value} onChangeText={setValue} maxLength={30} editable={!busy}
      placeholder="APPI, FAI or club number" hint="Shared by your aircraft in this sport. Private and not written into IGC files." last />
  </FormSheet>;
}

function describeValue(value: EquipmentValue, inventory: EquipmentInventory): string {
  if ('model' in value) return `${SPORT_LABELS[value.sport]} · ${aircraftName(value)}${value.registrationId ? ` · ${value.registrationId}` : ''}${value.archived ? ' · Archived' : ''}`;
  if ('pilotIdentifier' in value) return `${SPORT_LABELS[value.sport]} identifier: ${value.pilotIdentifier ?? 'None'}`;
  const aircraft = inventory.aircraft.find((item) => item.id === value.aircraftId);
  return `Current aircraft: ${aircraft ? aircraftName(aircraft.value) : value.aircraftId ? 'Aircraft from other device' : 'None'}`;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, title: { fontFamily: fonts.sansBold, fontSize: 19, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: paper.text },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted, flexShrink: 1 },
  identifier: { flexDirection: 'row', alignItems: 'center', gap: 14, justifyContent: 'space-between', minHeight: 48 },
  link: { fontFamily: fonts.sansSemi, color: paper.thermal, fontSize: 13 },
  aircraft: { minHeight: 64, paddingVertical: 12, borderTopWidth: 1, borderTopColor: paper.hairline, flexDirection: 'row', gap: 12, alignItems: 'center' },
  aircraftName: { fontFamily: fonts.sansSemi, fontSize: 16, color: paper.ink }, flex: { flex: 1, gap: 5 },
  chevron: { fontFamily: fonts.sans, fontSize: 25, color: paper.muted },
});

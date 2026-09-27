import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, Input, Notice, SectionLabel } from '@/components/ui';
import { FormSheet } from '@/features/equipment/form-sheet';
import { errorMessage } from '@/lib/format/error-message';
import { sanitizeIgcHeaderValue } from '@/recorder/igc';
import type { PilotProfile, PilotProfilePatch } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

export interface PilotDetailsValues { pilotName: string; registrationId: string }
export function valuesFromProfile(profile: PilotProfile): PilotDetailsValues {
  return { pilotName: profile.pilotName ?? '', registrationId: profile.registrationId ?? '' };
}

/** Mount per visit, keeping unfinished private details entirely local to the sheet. */
export function PilotDetailsSheet({ profile, saving, onCancel, onSave }: {
  profile: PilotProfile; saving: boolean; onCancel: () => void;
  onSave: (patch: PilotProfilePatch) => Promise<unknown>;
}) {
  const [values, setValues] = useState(() => valuesFromProfile(profile));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = values.pilotName !== (profile.pilotName ?? '') || values.registrationId !== (profile.registrationId ?? '');
  const save = async () => {
    if (inFlight.current || saving) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await onSave({ pilotName: values.pilotName.trim(), registrationId: values.registrationId.trim() });
      if (mounted.current) onCancel();
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <FormSheet title="Pilot details" dirty={dirty} busy={busy || saving} onClose={onCancel} onSave={() => void save()}>
    <Text style={styles.body}>Your private pilot details are separate from your Friends profile.</Text>
    {error ? <Notice tone="danger" title="Could not save">{error}</Notice> : null}
    <Card className="px-[16px] py-[4px]">
      <Input label="Pilot name" value={values.pilotName} placeholder="Name for new IGC exports" maxLength={60}
        autoCapitalize="words" autoComplete="name" editable={!busy && !saving}
        onChangeText={(pilotName) => setValues({ ...values, pilotName })} />
      <Input label="General pilot reference — optional" value={values.registrationId} placeholder="Your own reference"
        maxLength={30} editable={!busy && !saving} onChangeText={(registrationId) => setValues({ ...values, registrationId })}
        hint="Kept for your own reference. Not written into IGC files. Sport identifiers are managed with your aircraft." last />
    </Card>
    <View style={styles.preview}>
      <SectionLabel>Pilot header in new IGC exports</SectionLabel>
      <Text style={styles.mono}>HFPLTPILOTINCHARGE:{sanitizeIgcHeaderValue(values.pilotName) ?? 'UNSPECIFIED'}</Text>
      <Text style={styles.hint}>Newly generated exports use your current pilot name. Existing files and restored originals keep their headers. Aircraft headers use the equipment saved when recording began.</Text>
    </View>
  </FormSheet>;
}
const styles = StyleSheet.create({
  preview: { gap: 10 }, body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: paper.text },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: paper.text },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
});

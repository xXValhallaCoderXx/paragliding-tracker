import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Input, SectionLabel } from '@/components/ui';
import type { Coordinate } from '@/sites/types';
import type { SiteSource } from '@/recorder/types';
import { siteAttribution } from '../site-picker';
import { SitePickerSheet } from './site-picker-sheet';

export interface MetadataFormValues {
  title: string;
  site: string;
  notes: string;
  siteSource: SiteSource | null;
}

/** Optional journal details, separate from captured aircraft and recording evidence. */
export function MetadataForm({ values, onChange, dirty, saving, onSave, takeoff = null, disabled = false, quick = false }: {
  values: MetadataFormValues; onChange: (values: MetadataFormValues) => void;
  dirty: boolean; saving: boolean; onSave: () => void;
  takeoff?: Coordinate | null; disabled?: boolean; quick?: boolean;
}) {
  const [pickingSite, setPickingSite] = useState(false);
  const credit = siteAttribution(values.siteSource);
  return <>
    <Card className="px-[16px] py-[4px]">
      <Input label="Title" value={values.title} placeholder="Name this flight" maxLength={120}
        onChangeText={title => onChange({ ...values, title })} editable={!disabled} />
      <View className="gap-[8px] py-[12px]">
        <SectionLabel>Site</SectionLabel>
        <Button label={values.site || 'Choose or name a site'} onPress={() => { if (!disabled) setPickingSite(true); }} disabled={disabled}
          accessibilityHint="Opens site selection. Selecting a site changes this draft only." />
        {credit ? <Text className="font-body text-[12px] text-muted">{credit}</Text> : null}
      </View>
      {!quick ? <Input label="Private notes" value={values.notes} placeholder="How did it fly?" maxLength={4000} multiline
        hint="Your notes stay on this phone and in your private backup. They are never included in flights shared with friends."
        onChangeText={notes => onChange({ ...values, notes })} editable={!disabled} last /> : null}
      {!quick && (dirty || saving) ? <View className="py-[12px]">
        <Button label={saving ? 'Saving…' : 'Save details'} variant="primary" busy={saving} disabled={disabled} onPress={onSave} />
      </View> : null}
    </Card>
    {pickingSite ? <SitePickerSheet site={values.site} source={values.siteSource} near={takeoff}
      onClose={() => setPickingSite(false)} onSelect={(site, siteSource) => {
        if (!disabled) onChange({ ...values, site, siteSource });
      }} /> : null}
  </>;
}

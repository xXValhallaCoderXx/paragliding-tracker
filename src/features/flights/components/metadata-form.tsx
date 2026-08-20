import { StyleSheet, View } from 'react-native';

import { Button, Card, Input } from '@/components/ui';
import { SiteSuggestions } from '@/features/flights/components/site-suggestions';
import type { Coordinate, SiteSuggestion } from '@/sites/types';
import type { SiteSource } from '@/recorder/types';

export interface MetadataFormValues {
  title: string;
  site: string;
  notes: string;
  /**
   * Which catalogue the site name came from, carried alongside it so the credit stays
   * correct long after the search. Null once the pilot edits the text by hand — a name
   * they typed is their own words and carries neither licence.
   */
  siteSource: SiteSource | null;
}

/** Title / site / notes — optional metadata layered over the immutable track. */
export function MetadataForm({
  values,
  onChange,
  dirty,
  saving,
  onSave,
  takeoff = null,
  disabled = false,
}: {
  values: MetadataFormValues;
  onChange: (values: MetadataFormValues) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  /** Where this flight launched, when it is known. Drives the nearby suggestions. */
  takeoff?: Coordinate | null;
  disabled?: boolean;
}) {
  return (
    <Card className="mx-[16px] px-[16px] pt-[4px] pb-[4px]">
      <Input
        label="Title"
        value={values.title}
        placeholder="Name this flight"
        maxLength={120}
        onChangeText={(title) => onChange({ ...values, title })}
        editable={!disabled}
      />
      <Input
        label="Site"
        value={values.site}
        placeholder="Where did you launch?"
        maxLength={120}
        // Typing replaces a picked name with the pilot's own words, so the provenance
        // goes with it. Leaving a stale source behind would credit a catalogue for a
        // name it never supplied.
        onChangeText={(site) => onChange({ ...values, site, siteSource: null })}
        editable={!disabled}
        hint="Pick a launch below, or type any name."
      />
      <SiteSuggestions
        query={values.site}
        takeoff={takeoff}
        disabled={disabled}
        onSelect={(site: SiteSuggestion) =>
          onChange({ ...values, site: site.name, siteSource: site.provider })
        }
      />
      <Input
        label="Notes"
        value={values.notes}
        placeholder="How did it fly?"
        maxLength={4_000}
        multiline
        onChangeText={(notes) => onChange({ ...values, notes })}
        editable={!disabled}
        last
      />
      {dirty || saving ? (
        <View style={styles.saveRow}>
          <Button
            label={saving ? 'Saving…' : 'Save details'}
            variant="primary"
            busy={saving}
            disabled={disabled}
            onPress={onSave}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  saveRow: { paddingVertical: 12 },
});

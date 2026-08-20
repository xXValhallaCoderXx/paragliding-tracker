import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Input } from '@/components/ui';
import { SiteSuggestions } from '@/features/flights/components/site-suggestions';
import { readCoarsePosition } from '@/features/flights/current-position';
import { siteFieldHint, sitePickerView } from '@/features/flights/site-picker';
import type { SitePickerTrigger } from '@/features/flights/site-picker';
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
  // Owned here rather than inside the picker: the field and the panel are two halves of one
  // control, and it is the field's events — focus, typing — that open it.
  const [trigger, setTrigger] = useState<SitePickerTrigger>('none');

  // A live read is offered only when the flight has no takeoff fix of its own — anything
  // recorded before this existed, or a flight whose fixes were all ineligible.
  const [livePosition, setLivePosition] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const near = takeoff ?? livePosition;

  const locate = async () => {
    setLocating(true);
    try {
      const position = await readCoarsePosition();
      setLivePosition(position);
      // Finding a position is only ever a step towards seeing what is around it.
      if (position) setTrigger('nearby');
    } finally {
      setLocating(false);
    }
  };

  // Cheap enough to build for the hint alone, and it keeps the two halves reading from one
  // description of what is happening rather than each deciding for itself.
  const hint = siteFieldHint(
    values.siteSource,
    sitePickerView({
      query: values.site,
      debouncedQuery: values.site,
      trigger,
      hasPosition: near !== null,
      resultCount: 0,
      fetching: false,
    }),
  );

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
        onChangeText={(site) => {
          // Editing after settling means the answer was not the one they wanted.
          setTrigger('typing');
          onChange({ ...values, site, siteSource: null });
        }}
        onFocus={() => setTrigger('focus')}
        editable={!disabled}
        hint={hint}
        // The picker below draws the rule for this group; see its `group` style.
        last
      />
      <SiteSuggestions
        query={values.site}
        near={near}
        trigger={trigger}
        locating={locating}
        disabled={disabled}
        onLocate={() => void locate()}
        onOpen={() => setTrigger('nearby')}
        onDismiss={() => setTrigger('none')}
        onSelect={(site: SiteSuggestion) => {
          setTrigger('none');
          onChange({ ...values, site: site.name, siteSource: site.provider });
        }}
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

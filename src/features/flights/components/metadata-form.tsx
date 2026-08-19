import { StyleSheet, View } from 'react-native';

import { Button, Card, Input } from '@/components/ui';

export interface MetadataFormValues {
  title: string;
  site: string;
  notes: string;
}

/** Title / site / notes — optional metadata layered over the immutable track. */
export function MetadataForm({
  values,
  onChange,
  dirty,
  saving,
  onSave,
  disabled = false,
}: {
  values: MetadataFormValues;
  onChange: (values: MetadataFormValues) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
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
        onChangeText={(site) => onChange({ ...values, site })}
        editable={!disabled}
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

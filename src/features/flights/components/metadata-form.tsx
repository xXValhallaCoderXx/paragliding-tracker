import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card } from '@/components/ui';
import { fonts, paper } from '@/ui/theme';

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
      <Field
        label="Title"
        value={values.title}
        placeholder="Name this flight"
        maxLength={120}
        onChangeText={(title) => onChange({ ...values, title })}
        editable={!disabled}
      />
      <Field
        label="Site"
        value={values.site}
        placeholder="Where did you launch?"
        maxLength={120}
        onChangeText={(site) => onChange({ ...values, site })}
        editable={!disabled}
      />
      <Field
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

function Field({
  label,
  value,
  placeholder,
  maxLength,
  multiline = false,
  editable = true,
  last = false,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  editable?: boolean;
  last?: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="sentences"
        editable={editable}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={paper.placeholder}
        selectionColor={paper.thermal}
        cursorColor={paper.thermal}
        style={[styles.input, multiline && styles.inputMultiline]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: paper.hairline, gap: 4 },
  fieldLast: { borderBottomWidth: 0 },
  fieldLabel: { fontFamily: fonts.sansSemi, fontSize: 9.5, letterSpacing: 1.4, color: paper.muted },
  input: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: paper.ink,
    paddingVertical: 4,
    paddingHorizontal: 0,
    minHeight: 30,
  },
  inputMultiline: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, minHeight: 72 },
  saveRow: { paddingVertical: 12 },
});

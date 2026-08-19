import { StyleSheet, View } from 'react-native';

import { Button, Card, Input } from '@/components/ui';

export interface PilotProfileFormValues {
  pilotName: string;
  gliderType: string;
  gliderId: string;
  homeSite: string;
}

export const EMPTY_PILOT_PROFILE_FORM: PilotProfileFormValues = {
  pilotName: '',
  gliderType: '',
  gliderId: '',
  homeSite: '',
};

/**
 * The pilot's own details.
 *
 * Deliberately usable with no account: these values live in local SQLite and are what
 * fill the IGC pilot and glider header records, so they have to work offline.
 */
export function PilotProfileCard({
  values,
  onChange,
  dirty,
  saving,
  onSave,
  disabled = false,
}: {
  values: PilotProfileFormValues;
  onChange: (values: PilotProfileFormValues) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  disabled?: boolean;
}) {
  return (
    <Card className="px-[16px] pt-[4px] pb-[4px]">
      <Input
        label="Pilot name"
        value={values.pilotName}
        placeholder="As it should appear in your IGC files"
        maxLength={60}
        autoCapitalize="words"
        autoComplete="name"
        onChangeText={(pilotName) => onChange({ ...values, pilotName })}
        editable={!disabled}
      />
      <Input
        label="Glider"
        value={values.gliderType}
        placeholder="Ozone Rush 6"
        maxLength={60}
        onChangeText={(gliderType) => onChange({ ...values, gliderType })}
        editable={!disabled}
      />
      <Input
        label="Glider ID"
        value={values.gliderId}
        placeholder="Registration or serial"
        maxLength={30}
        autoCapitalize="characters"
        onChangeText={(gliderId) => onChange({ ...values, gliderId })}
        editable={!disabled}
      />
      <Input
        label="Home site"
        value={values.homeSite}
        placeholder="Where you usually fly"
        maxLength={120}
        onChangeText={(homeSite) => onChange({ ...values, homeSite })}
        editable={!disabled}
        last
      />
      {dirty || saving ? (
        <View style={styles.saveRow}>
          <Button
            label={saving ? 'Saving…' : 'Save profile'}
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

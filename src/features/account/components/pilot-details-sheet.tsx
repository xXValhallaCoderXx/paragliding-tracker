import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Card, Input } from '@/components/ui';
import { igcHeaderPreview } from '@/features/account/account-identity';
import type { PilotProfile, PilotProfilePatch } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

export interface PilotDetailsValues {
  pilotName: string;
  registrationId: string;
  gliderType: string;
  homeSite: string;
}

export function valuesFromProfile(profile: PilotProfile): PilotDetailsValues {
  return {
    pilotName: profile.pilotName ?? '',
    registrationId: profile.registrationId ?? '',
    gliderType: profile.gliderType ?? '',
    homeSite: profile.homeSite ?? '',
  };
}

/**
 * Edits the pilot's details, and shows what they will do to an exported file.
 *
 * A `Modal` rather than a route: there is nothing to deep-link into and nothing to
 * intercept, which is the same reasoning that keeps the sign-in card and the first-run
 * wizard off the router.
 *
 * Draft state lives here and dies with the sheet, so cancelling is genuinely free — the
 * profile is only touched when Save is pressed.
 */
export function PilotDetailsSheet({
  visible,
  profile,
  saving,
  onCancel,
  onSave,
}: {
  visible: boolean;
  profile: PilotProfile;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: PilotProfilePatch) => void;
}) {
  const [values, setValues] = useState<PilotDetailsValues>(() => valuesFromProfile(profile));

  // Re-seed whenever the sheet opens, so a cancelled edit never leaks into the next one.
  const [seededFor, setSeededFor] = useState(profile.updatedAt);
  if (visible && seededFor !== profile.updatedAt) {
    setSeededFor(profile.updatedAt);
    setValues(valuesFromProfile(profile));
  }

  const homeSiteChanged = values.homeSite.trim() !== (profile.homeSite ?? '');
  const preview = igcHeaderPreview({
    ...profile,
    pilotName: values.pilotName.trim() || null,
    gliderType: values.gliderType.trim() || null,
  });

  const save = () => {
    onSave({
      pilotName: values.pilotName,
      registrationId: values.registrationId,
      gliderType: values.gliderType,
      homeSite: values.homeSite,
      // Typing a home site is the pilot claiming it. Latching the source here is what
      // stops the site resolver ever replacing their answer with a guess.
      ...(homeSiteChanged ? { homeSiteSource: 'manual' as const } : {}),
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}>
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onCancel}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Pilot details</Text>
          <Pressable accessibilityRole="button" hitSlop={10} disabled={saving} onPress={save}>
            <Text style={[styles.save, saving && styles.saveBusy]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Card className="px-[16px] pt-[4px] pb-[4px]">
              <Input
                label="Pilot name"
                value={values.pilotName}
                placeholder="As it should appear in your IGC files"
                maxLength={60}
                autoCapitalize="words"
                autoComplete="name"
                editable={!saving}
                onChangeText={(pilotName) => setValues({ ...values, pilotName })}
              />
              <Input
                label="Pilot registration ID — optional"
                value={values.registrationId}
                placeholder="Licence or federation number"
                maxLength={30}
                autoCapitalize="characters"
                editable={!saving}
                onChangeText={(registrationId) => setValues({ ...values, registrationId })}
                hint="Your APPI, FAI or club number. Kept for your own reference — it is not written into IGC files."
              />
              <Input
                label="Glider"
                value={values.gliderType}
                placeholder="Ozone Rush 6"
                maxLength={60}
                editable={!saving}
                onChangeText={(gliderType) => setValues({ ...values, gliderType })}
              />
              <Input
                label={
                  profile.homeSiteSource === 'auto' && !homeSiteChanged
                    ? 'Home site — auto'
                    : 'Home site'
                }
                value={values.homeSite}
                placeholder="Where you launch most"
                maxLength={120}
                editable={!saving}
                onChangeText={(homeSite) => setValues({ ...values, homeSite })}
                hint="Picked from where you launch most. Override it if you'd rather it stayed put."
                last
              />
            </Card>

            <View style={styles.previewBlock}>
              <Text style={styles.previewLabel}>HOW IT LANDS IN THE FILE</Text>
              <View style={styles.preview}>
                {preview.map((line) => (
                  <Text key={line} style={styles.previewLine}>
                    {line}
                  </Text>
                ))}
              </View>
              <Text style={styles.previewNote}>
                Flights already saved keep the details they were recorded with.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: paper.background },
  flex: { flex: 1 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: paper.border,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
  },
  cancel: { fontFamily: fonts.sans, fontSize: 14, color: paper.muted },
  title: { fontFamily: fonts.sansSemi, fontSize: 14, color: paper.ink },
  save: { fontFamily: fonts.sansSemi, fontSize: 14, color: paper.thermal },
  saveBusy: { color: paper.muted },
  content: { paddingHorizontal: 18, paddingBottom: 40, gap: 16 },
  previewBlock: { gap: 8 },
  previewLabel: {
    fontFamily: fonts.monoSemi,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: paper.muted,
  },
  preview: {
    backgroundColor: paper.cardAlt,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  previewLine: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: paper.text },
  previewNote: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, color: paper.muted },
});

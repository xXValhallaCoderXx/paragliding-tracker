import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { fonts, paper } from '@/ui/theme';

/**
 * In-app account deletion.
 *
 * Required by App Store Guideline 5.1.1(v) and Google Play's data deletion policy: any
 * app that lets people create an account has to let them delete it from inside the app.
 *
 * Deliberately mirrors the flight danger zone on `/flights/[id]`, and is explicit that
 * deleting the account does *not* delete the logbook on this phone — the pilot's own
 * recordings are theirs, and losing them to an account action would be a serious
 * surprise.
 */
export function AccountDangerZone({
  busy,
  disabled = false,
  onDelete,
}: {
  busy: boolean;
  disabled?: boolean;
  onDelete: () => void;
}) {
  const confirm = () => {
    Alert.alert(
      'Delete your account?',
      'Your account, your backed-up flights and your uploaded IGC files are permanently deleted. The flights recorded on this phone stay on this phone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: onDelete },
      ],
    );
  };

  return (
    <View style={styles.zone}>
      <Text style={styles.title}>Delete account</Text>
      <Text style={styles.body}>
        Removes your account and every backed-up copy. Your local logbook is untouched, and
        you can keep flying without an account.
      </Text>
      <Button
        label={busy ? 'Deleting…' : 'Delete account permanently'}
        variant="danger"
        busy={busy}
        disabled={disabled || busy}
        onPress={confirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { paddingHorizontal: 18, paddingTop: 26, gap: 8 },
  title: { fontFamily: fonts.sansSemi, fontSize: 13, color: paper.danger },
  body: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18, color: paper.text },
});

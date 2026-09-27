import { useCallback, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen, TopBar } from '@/components/ui';
import { SETUP_DESTINATIONS, type SetupDestination } from '@/features/onboarding/onboarding-flow';
import { spacing } from '@/ui/theme';
import { BackupSignIn } from './components/backup-sign-in';

export default function SignInScreen() {
  const router = useRouter();
  const [focused, setFocused] = useState(true);
  const leave = useCallback((destination: SetupDestination = 'pilot') => {
    setFocused(false);
    router.dismissTo(SETUP_DESTINATIONS[destination === 'return' ? 'pilot' : destination]);
  }, [router]);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    const back = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true; });
    // Navigation blur destroys the form. App background/foreground does not blur a route.
    return () => { back.remove(); setFocused(false); };
  }, [leave]));

  return <Screen>
    <TopBar title="Sign in" onBack={() => leave()} backLabel="Back to Pilot" />
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {focused ? <BackupSignIn onComplete={leave} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </Screen>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: spacing.screen, paddingTop: spacing.section, paddingBottom: spacing.bottom },
});

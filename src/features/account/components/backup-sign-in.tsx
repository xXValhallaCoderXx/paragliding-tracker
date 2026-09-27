import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Disclaimer, LinkButton, ListRow, Notice } from '@/components/ui';
import { JournalArt } from '@/components/ui/journal-art';
import type { SetupDestination } from '@/features/onboarding/onboarding-flow';
import { paper, spacing, typography } from '@/ui/theme';
import { useCloudAuth } from '../auth-provider';
import { useCloudSync } from '../cloud-sync-provider';
import { cloudOnlySummary, describeSync } from '../account-presentation';
import { RestoringAccountCard } from './account-card';
import { BackupDisclosure, CloudUnconfiguredNotice, SignInCard } from './sign-in-card';

/** The same account states in setup and Pilot. No profile, sharing, or sync writes. */
export function BackupSignIn({ setup = false, reviewing = false, disabled = false, onComplete }: {
  setup?: boolean;
  reviewing?: boolean;
  disabled?: boolean;
  onComplete: (destination: SetupDestination) => void;
}) {
  const auth = useCloudAuth();
  return <View style={styles.section}>
    {auth.status === 'signed_in' ? <SignedInConfirmation disabled={disabled} onComplete={onComplete} />
      : auth.status === 'restoring' ? <>
        <Text accessibilityRole="header" style={styles.heading}>Checking your account</Text>
        <RestoringAccountCard />
        <Text style={styles.body}>Reading the saved sign-in on this phone. You can continue using your local logbook.</Text>
      </>
      : auth.status === 'unconfigured' ? <CloudUnconfiguredNotice />
      : <SignInCard requestOtp={auth.requestOtp} verifyOtp={auth.verifyOtp} setup={setup} disabled={disabled} />}
    {auth.status !== 'signed_in' ? <LinkButton
      label={setup ? 'Skip — keep it on this phone' : 'Not now'} disabled={disabled}
      onPress={() => { if (!disabled) onComplete(reviewing ? 'return' : setup ? 'home' : 'pilot'); }} /> : null}
    {reviewing ? <LinkButton label="Finish review" disabled={disabled}
      onPress={() => { if (!disabled) onComplete('return'); }} /> : null}
  </View>;
}

function SignedInConfirmation({ disabled, onComplete }: {
  disabled: boolean; onComplete: (destination: SetupDestination) => void;
}) {
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const status = describeSync(sync, now);
  const cloudOnly = cloudOnlySummary(sync);
  const complete = (destination: SetupDestination) => { if (!disabled) onComplete(destination); };
  return <>
    <JournalArt scene="flight" height={150} />
    <Text accessibilityRole="header" style={styles.heading}>Signed in</Text>
    <Text style={styles.body}>{auth.email ?? 'Your account is ready.'}</Text>
    <Card className="px-[16px] py-[4px]">
      <ListRow label="Backup" value={status.label} tone={status.tone} showDot={status.tone !== 'neutral'} detail={status.detail} last />
    </Card>
    {cloudOnly ? <Notice>{cloudOnly}</Notice> : null}
    <LinkButton label="View backup in Pilot" disabled={disabled} onPress={() => complete('pilot')} />
    <Disclaimer align="left">You can open Home now. Setup does not wait for backup or restoration.</Disclaimer>
    <Button label="Open Home" variant="primary" disabled={disabled} onPress={() => complete('home')} />
    <Button label="Set up Friends" variant="secondary" disabled={disabled} onPress={() => complete('friends')} />
    <Text style={styles.body}>Friends is a separate choice. Choose your profile there, or keep using your existing one. Signing in does not change your discoverability or sharing preferences.</Text>
    <BackupDisclosure />
  </>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.section },
  heading: { ...typography.title, color: paper.ink },
  body: { ...typography.body, color: paper.text },
});

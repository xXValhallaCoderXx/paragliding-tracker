import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Disclaimer, Input, LinkButton, ListRow, Notice } from '@/components/ui';
import { JournalArt } from '@/components/ui/journal-art';
import { BackupSignIn } from '@/features/account/components/backup-sign-in';
import { paper, spacing, typography } from '@/ui/theme';
import { useFirstRun } from '../first-run-provider';
import { stepProgress } from '../onboarding-flow';
import { StepChrome } from './step-chrome';
import { PermissionsStep } from './permissions-step';

export function OnboardingOverlay() {
  const firstRun = useFirstRun();
  const state = firstRun.wizard;
  const busy = firstRun.saving !== null;
  const progress = stepProgress(state.step);

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          {progress ? <StepChrome current={progress.current} total={progress.total}
            disabled={busy} onBack={() => void firstRun.navigate('back')} /> : null}
          {firstRun.mode === 'review' ? (
            <View style={styles.review}>
              <LinkButton label="Close review" disabled={busy} onPress={firstRun.dismissReplay} />
            </View>
          ) : null}
          <ScrollView key={state.step} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {state.step === 'welcome' ? <WelcomeStep acknowledged={state.disclaimerAcknowledged}
              disabled={busy} onAcknowledge={firstRun.acknowledge}
              onStart={() => void firstRun.navigate('continue')} onSkip={() => void firstRun.navigate('skip')} /> : null}
            {state.step === 'pilot' ? <PilotStep pilotName={firstRun.nameDraft} onPilotName={firstRun.setNameDraft}
              saving={firstRun.saving === 'name'} loading={firstRun.nameLoading} error={firstRun.nameError}
              onContinue={() => firstRun.nameReadFailed ? firstRun.retryProfile() : void firstRun.navigate('continue')}
              onSkip={() => void firstRun.navigate('skip')} /> : null}
            {state.step === 'location' ? <PermissionsStep onContinue={() => void firstRun.navigate('continue')} /> : null}
            {state.step === 'backup' ? <View style={styles.block}><BackupSignIn setup reviewing={firstRun.mode === 'review'}
              disabled={busy || firstRun.completionError !== null} onComplete={(destination) => void firstRun.completeSetup(destination)} /></View> : null}
            {firstRun.saving === 'completion' ? <View style={styles.block}><Notice title="Saving setup…">Your choices are being saved on this phone.</Notice></View> : null}
            {firstRun.completionError ? (
              <View style={styles.block}>
                <Notice tone="danger" title="Setup was not saved">{firstRun.completionError}</Notice>
                <Button label="Retry saving setup" variant="primary" disabled={busy} onPress={() => void firstRun.retryCompletion()} />
                <LinkButton label="Continue without saving" disabled={busy} onPress={firstRun.continueWithoutSaving} />
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export function PilotStep({ pilotName, onPilotName, onContinue, onSkip, saving, loading, error }: {
  pilotName: string; onPilotName: (value: string) => void; onContinue: () => void; onSkip: () => void;
  saving: boolean; loading: boolean; error: string | null;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>SETTING UP</Text>
      <Text accessibilityRole="header" style={styles.heading}>Who&apos;s flying?</Text>
      <Text style={styles.body}>Your optional name stays in your private pilot details and appears in new IGC exports. You choose your Friends identity separately.</Text>
      <Input label="Your name — optional" value={pilotName} placeholder="The name you fly under"
        maxLength={60} autoCapitalize="words" autoComplete="name" onChangeText={onPilotName}
        editable={!saving && !loading} error={error} returnKeyType="next" onSubmitEditing={onContinue}
        hint={loading ? 'Reading saved pilot details…' : 'Change it any time in Pilot. Leaving this blank keeps any saved name.'} last />
      <Disclaimer align="left">Equipment and registration are optional. Add or edit them in Pilot → Edit pilot details.</Disclaimer>
      <View style={styles.actions}>
        <Button label={saving ? 'Saving…' : error ? 'Retry' : 'Continue'} variant="primary" size="lg"
          busy={saving} disabled={loading} onPress={onContinue} />
        <LinkButton label="Skip for now" disabled={saving} onPress={onSkip} />
      </View>
    </View>
  );
}

export function WelcomeStep({
  acknowledged,
  onAcknowledge,
  onStart,
  onSkip,
  disabled = false,
}: {
  acknowledged: boolean;
  onAcknowledge: () => void;
  onStart: () => void;
  onSkip: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.wordmark}>XC · FLIGHT JOURNAL</Text>
      <JournalArt scene="flight" height={220} />
      <Text accessibilityRole="header" style={styles.tagline}>Bring the sky home.</Text>
      <Text style={styles.body}>
        Record before launch, save after landing, then revisit the route and the moments that made it yours. Recording and replay work offline.
      </Text>

      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Records in the background"
          detail="Uses background location. Phone settings and interruptions can affect capture."
          mono={false}
        />
        <ListRow
          label="Works with no account and no network"
          detail="Nothing here waits on a signal."
          mono={false}
        />
        <ListRow
          label="Your flight, ready to revisit"
          detail="Replay the recorded route and export an unsigned IGC for your own archive."
          mono={false}
          last
        />
      </Card>

      {/* Required on first run by the design brief, and deliberately not a dismissible
          toast: the pilot has to say they understand before setup will move. */}
      <Notice tone="warning" title="This is not a certified flight recorder">
        Never fly with it as your only recorder.
      </Notice>
      <View style={styles.ack}>
        <Button
          label={acknowledged ? 'Understood' : 'I understand'}
          variant={acknowledged ? 'secondary' : 'dark'}
          disabled={acknowledged || disabled}
          onPress={onAcknowledge}
        />
      </View>

      {!acknowledged ? <Disclaimer>Acknowledge the recorder limitation to start or skip setup.</Disclaimer> : null}
      <View style={styles.actions}>
        <Button
          label="Start setup"
          variant="primary"
          size="lg"
          disabled={!acknowledged || disabled}
          onPress={() => { if (acknowledged && !disabled) onStart(); }}
        />
        <LinkButton label="Skip setup, open Home" disabled={!acknowledged || disabled}
          onPress={() => { if (acknowledged && !disabled) onSkip(); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: paper.background },
  flex: { flex: 1 },
  content: { paddingTop: spacing.section, paddingBottom: spacing.bottom, gap: spacing.section },
  review: { paddingHorizontal: spacing.screen, alignItems: 'flex-end' },
  block: { paddingHorizontal: spacing.screen, gap: spacing.section },
  wordmark: { ...typography.eyebrow, color: paper.muted },
  tagline: { ...typography.title, color: paper.ink },
  eyebrow: { ...typography.eyebrow, color: paper.actionText },
  heading: { ...typography.title, color: paper.ink },
  body: { ...typography.body, color: paper.text },
  ack: { paddingTop: 2 },
  actions: { paddingTop: spacing.action, gap: spacing.tight, alignItems: 'stretch' },
});

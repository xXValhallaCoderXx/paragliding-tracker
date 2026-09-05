import { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, Disclaimer, Input, LinkButton, ListRow, Notice } from '@/components/ui';
import { useCloudAuth } from '@/features/account/auth-provider';
import { SignInCard } from '@/features/account/components/sign-in-card';
import { JournalArt } from '@/components/ui/journal-art';
import {
  requestNotificationPermission,
  type NotificationPermission,
} from '@/lib/notification-permission';
import { openSystemScreen } from '@/lib/system-settings';
import { useUpdateProfileMutation } from '@/store/endpoints';
import { recorderService } from '@/recorder/recorder-service';
import type { RecorderCapabilities } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

import { useFirstRun } from '../first-run-provider';
import { GLIDER_SUGGESTIONS, matchGliders } from '../glider-suggestions';
import { abandon, acknowledgeDisclaimer, advance, stepProgress } from '../onboarding-flow';
import { StepChrome } from './step-chrome';

/**
 * First-run setup, rendered as a full-screen overlay above the router's `<Stack>`.
 *
 * Above rather than instead of: rendering in place of the navigator means none is ever
 * mounted, so `router` calls are dropped, deep links go unrouted and Android back exits
 * the app. As an overlay it is still not a route — nothing to deep-link into, nothing to
 * intercept, no `Stack.Protected` anywhere — which is the same reasoning that keeps
 * `SignInCard` off the router.
 *
 * Every step is skippable. The recorder has to work with no account, no signal and no
 * setup, so this is an offer, not a gate.
 */
export function OnboardingOverlay() {
  const firstRun = useFirstRun();
  const auth = useCloudAuth();
  const state = firstRun.wizard;

  const [pilotName, setPilotName] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [glider, setGlider] = useState('');
  const [capabilities, setCapabilities] = useState<RecorderCapabilities | null>(null);
  const [notifications, setNotifications] = useState<NotificationPermission>('unknown');
  const [asking, setAsking] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const close = useCallback(
    (abandoned: boolean) => {
      void firstRun.finishSetup(abandoned ? abandon(state) : state);
    },
    [firstRun, state],
  );

  // The same mutation the account screen uses, so the write invalidates the Profile tag. Writing
  // to the repository directly left the logbook — mounted underneath this overlay and already
  // subscribed to an empty profile — insisting the pilot had entered nothing.
  const [savePilotProfile] = useUpdateProfileMutation();

  /** Persists whatever the pilot typed. Blank fields are simply not written. */
  const saveProfile = useCallback(async () => {
    const patch = {
      ...(pilotName.trim() ? { pilotName: pilotName.trim() } : {}),
      ...(registrationId.trim() ? { registrationId: registrationId.trim() } : {}),
      ...(glider.trim() ? { gliderType: glider.trim() } : {}),
    };
    if (Object.keys(patch).length === 0) return;
    try {
      await savePilotProfile(patch).unwrap();
    } catch {
      // Setup is not the place to fail. Everything here is re-editable on the account
      // screen, and blocking the pilot behind a write error would be far worse.
    }
  }, [pilotName, registrationId, glider, savePilotProfile]);

  const step = useCallback(
    (outcome: 'continue' | 'skip' | 'back') => {
      const next = advance(state, outcome);
      if (next === null) {
        void saveProfile().finally(() => close(false));
        return;
      }
      firstRun.setWizard(next);
    },
    [state, firstRun, saveProfile, close],
  );

  // Android back walks the wizard rather than the Stack underneath it, which would
  // otherwise navigate invisibly behind the overlay.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      step('back');
      return true;
    });
    return () => subscription.remove();
  }, [step]);

  const askForLocation = useCallback(async () => {
    setAsking(true);
    try {
      const granted = await recorderService.requestLocationPermissions();
      setCapabilities(granted);
      // Asked after location, not before: the notification is a safeguard for a
      // recording that is already permitted, and leading with it would spend the
      // pilot's patience on the less important of the two dialogs.
      setNotifications(await requestNotificationPermission());
    } catch {
      setCapabilities(null);
    } finally {
      setAsking(false);
    }
  }, []);

  const progress = stepProgress(state.step);

  return (
    <View style={styles.overlay}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        {progress ? (
          <StepChrome current={progress.current} total={progress.total} onBack={() => step('back')} />
        ) : null}

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {state.step === 'welcome' ? (
            <WelcomeStep
              acknowledged={state.disclaimerAcknowledged}
              onAcknowledge={() => firstRun.setWizard(acknowledgeDisclaimer(state))}
              onStart={() => step('continue')}
              onSkip={() => close(true)}
            />
          ) : null}

          {state.step === 'pilot' ? (
            <PilotStep
              pilotName={pilotName}
              registrationId={registrationId}
              onPilotName={setPilotName}
              onRegistrationId={setRegistrationId}
              onContinue={() => step('continue')}
              onSkip={() => step('skip')}
            />
          ) : null}

          {state.step === 'glider' ? (
            <GliderStep
              glider={glider}
              onGlider={setGlider}
              onContinue={() => step('continue')}
              onSkip={() => step('skip')}
            />
          ) : null}

          {state.step === 'location' ? (
            <LocationStep
              capabilities={capabilities}
              notifications={notifications}
              asking={asking}
              onAsk={() => void askForLocation()}
              onOpenSettings={() => void openSystemScreen('open_app_settings').catch(() => undefined)}
              onContinue={() => step('continue')}
            />
          ) : null}

          {state.step === 'backup' ? (
            <BackupStep
              auth={auth}
              error={authError ?? auth.lastError?.message ?? null}
              onClearError={() => setAuthError(null)}
              onDone={() => step('continue')}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export function PilotStep({
  pilotName,
  registrationId,
  onPilotName,
  onRegistrationId,
  onContinue,
  onSkip,
}: {
  pilotName: string;
  registrationId: string;
  onPilotName: (value: string) => void;
  onRegistrationId: (value: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.heading}>Who&apos;s flying?</Text>
      <Text style={styles.body}>
        Use the name you fly under. It appears in the header of your unsigned IGC exports.
      </Text>
      <Card className="px-[16px] pt-[4px] pb-[4px]">
        <Input
          label="Pilot name"
          value={pilotName}
          placeholder="As it should appear in your IGC files"
          maxLength={60}
          autoCapitalize="words"
          autoComplete="name"
          onChangeText={onPilotName}
          hint="Leave it blank and exports use UNSPECIFIED."
        />
        <Input
          label="Pilot registration ID — optional"
          value={registrationId}
          placeholder="Licence or federation number"
          maxLength={30}
          autoCapitalize="characters"
          onChangeText={onRegistrationId}
          hint="Your APPI, FAI or club number, kept for your own reference. It is not included in IGC exports."
          last
        />
      </Card>
      <StepActions onContinue={onContinue} onSkip={onSkip} />
    </View>
  );
}

export function GliderStep({
  glider,
  onGlider,
  onContinue,
  onSkip,
}: {
  glider: string;
  onGlider: (value: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.heading}>What are you flying?</Text>
      <Text style={styles.body}>
        Your usual wing, used in IGC exports. You can update it from your pilot page.
      </Text>
      <Card className="px-[16px] pt-[4px] pb-[4px]">
        <Input
          label="Glider"
          value={glider}
          placeholder="Ozone Rush 6"
          maxLength={60}
          onChangeText={onGlider}
          last
        />
      </Card>
      <View style={styles.suggestions}>
        {matchGliders(glider, GLIDER_SUGGESTIONS).map((name) => (
          <LinkButton key={name} label={name} onPress={() => onGlider(name)} />
        ))}
      </View>
      <Disclaimer align="left">
        Flying something borrowed? Update your glider on the pilot page before exporting.
      </Disclaimer>
      <StepActions onContinue={onContinue} onSkip={onSkip} />
    </View>
  );
}

export function BackupStep({
  auth,
  error,
  onClearError,
  onDone,
}: {
  auth: ReturnType<typeof useCloudAuth>;
  error: string | null;
  onClearError: () => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.heading}>Last one — a backup.</Text>
      <Text style={styles.body}>
        Stop recording after landing to save a flight on this phone. An optional account can back up eligible summaries and IGC files when connected. Restoring cloud flights to a new phone is planned.
      </Text>
      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Without an account"
          value="Local journal"
          mono={false}
          detail="Recording stays available. Saved flights are never automatically removed."
        />
        <ListRow
          label="With a free account"
          value="Optional backup"
          mono={false}
          tone="good"
          showDot
          detail="Eligible summaries and IGC files can upload while connected. Your local journal stays available."
          last
        />
      </Card>
      {auth.status === 'signed_in' ? (
        <Notice tone="good" title="Signed in">
          Backup can run while connected. Check its progress and any errors on your pilot page.
        </Notice>
      ) : auth.status === 'unconfigured' ? (
        <Notice tone="info" title="Backup is not set up in this build">
          Flights still record and stay on this phone.
        </Notice>
      ) : (
        <SignInCard
          requestOtp={auth.requestOtp}
          verifyOtp={auth.verifyOtp}
          error={error}
          onClearError={onClearError}
        />
      )}
      <Disclaimer align="left">
        We store your email, your flight summaries and your IGC files — IGC files contain GPS coordinates. Raw sensor and diagnostic samples stay on this phone.
      </Disclaimer>
      <View style={styles.finish}>
        <LinkButton
          label={auth.status === 'signed_in' ? 'Done' : 'Skip — keep it on this phone'}
          onPress={onDone}
        />
      </View>
    </View>
  );
}

function StepActions({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <View style={styles.actions}>
      <Button label="Continue" variant="primary" size="lg" onPress={onContinue} />
      <LinkButton label="Skip" onPress={onSkip} />
    </View>
  );
}

export function WelcomeStep({
  acknowledged,
  onAcknowledge,
  onStart,
  onSkip,
}: {
  acknowledged: boolean;
  onAcknowledge: () => void;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.wordmark}>XC · FLIGHT JOURNAL</Text>
      <JournalArt scene="flight" height={220} />
      <Text style={styles.tagline}>Bring the sky home.</Text>
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
          disabled={acknowledged}
          onPress={onAcknowledge}
        />
      </View>

      <View style={styles.actions}>
        <Button
          label="Set up — about a minute"
          variant="primary"
          size="lg"
          disabled={!acknowledged}
          onPress={onStart}
        />
        <LinkButton label="Skip setup, take me to record" onPress={onSkip} />
      </View>
    </View>
  );
}

export function LocationStep({
  capabilities,
  notifications = 'unknown',
  asking,
  onAsk,
  onOpenSettings,
  onContinue,
}: {
  capabilities: RecorderCapabilities | null;
  notifications?: NotificationPermission;
  asking: boolean;
  onAsk: () => void;
  onOpenSettings: () => void;
  onContinue: () => void;
}) {
  const foreground = capabilities?.foregroundPermission ?? 'unknown';
  const background = capabilities?.backgroundPermission ?? 'unknown';
  const denied = foreground === 'denied' || background === 'denied';
  const allGranted = foreground === 'granted' && background === 'granted';

  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>BEFORE YOU LAUNCH</Text>
      <Text style={styles.heading}>Give your journal a position.</Text>
      <Text style={styles.body}>
        Location permission lets the recorder capture GPS fixes. Background access is required by this recorder when the app is not visible; it does not guarantee uninterrupted recording.
      </Text>

      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Location · precise"
          value={foreground === 'granted' ? 'ALLOWED' : 'NEEDED'}
          tone={foreground === 'granted' ? 'good' : foreground === 'denied' ? 'danger' : 'neutral'}
          showDot
          detail="Precise location gives a more useful track than approximate location."
        />
        <ListRow
          label="Allow all the time"
          value={background === 'granted' ? 'ALLOWED' : 'NEEDED'}
          tone={background === 'granted' ? 'good' : background === 'denied' ? 'danger' : 'neutral'}
          showDot
          detail="Android asks for this on a second screen. Pick “Allow all the time”, not “while using the app”."
        />
        <ListRow
          label="Notifications"
          value={
            notifications === 'granted'
              ? 'ALLOWED'
              : notifications === 'unsupported'
                ? 'NOT NEEDED'
                : 'RECOMMENDED'
          }
          tone={notifications === 'granted' ? 'good' : 'neutral'}
          showDot={notifications === 'granted'}
          detail="Makes recording status visible. Notifications do not prevent Android from stopping the app."
          last
        />
      </Card>

      <Disclaimer align="left">
        Your takeoff position can suggest launch names when you edit a saved flight. You choose the name.
      </Disclaimer>

      {denied ? (
        <Notice tone="warning" title="Permission is not granted">
          If the phone no longer offers a permission prompt, you can review it in system settings.
        </Notice>
      ) : null}

      <View style={styles.actions}>
        {allGranted ? (
          <Button label="Continue" variant="primary" size="lg" onPress={onContinue} />
        ) : denied ? (
          <Button label="Open Android settings" variant="primary" size="lg" onPress={onOpenSettings} />
        ) : (
          <Button
            label={asking ? 'Asking…' : 'Allow location'}
            variant="primary"
            size="lg"
            busy={asking}
            disabled={asking}
            onPress={onAsk}
          />
        )}
        <LinkButton label="Not now — I'll do it before I fly" onPress={onContinue} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: paper.background,
  },
  flex: { flex: 1 },
  content: { paddingTop: 24, paddingBottom: 48 },
  block: { paddingHorizontal: 18, gap: 12 },
  wordmark: {
    fontFamily: fonts.monoSemi,
    fontSize: 12,
    letterSpacing: 2.4,
    color: paper.muted,
  },
  tagline: {
    fontFamily: fonts.sansBold,
    fontSize: 30,
    letterSpacing: -0.6,
    color: paper.ink,
    marginTop: -4,
  },
  eyebrow: {
    fontFamily: fonts.monoSemi,
    fontSize: 10,
    letterSpacing: 1.4,
    color: paper.thermal,
  },
  heading: { fontFamily: fonts.sansBold, fontSize: 24, letterSpacing: -0.4, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20, color: paper.text },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 2 },
  ack: { paddingTop: 2 },
  actions: { paddingTop: 10, gap: 12, alignItems: 'stretch' },
  finish: { paddingTop: 6, alignItems: 'center' },
});

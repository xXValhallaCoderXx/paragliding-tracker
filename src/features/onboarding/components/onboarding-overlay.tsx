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
import { GUEST_FLIGHT_CAPACITY } from '@/features/logbook/guest-capacity';
import {
  requestNotificationPermission,
  type NotificationPermission,
} from '@/lib/notification-permission';
import { openSystemScreen } from '@/lib/system-settings';
import { pilotProfileRepository } from '@/recorder/flight-repository';
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

  /** Persists whatever the pilot typed. Blank fields are simply not written. */
  const saveProfile = useCallback(async () => {
    if (Platform.OS === 'web') return;
    const patch = {
      ...(pilotName.trim() ? { pilotName: pilotName.trim() } : {}),
      ...(registrationId.trim() ? { registrationId: registrationId.trim() } : {}),
      ...(glider.trim() ? { gliderType: glider.trim() } : {}),
    };
    if (Object.keys(patch).length === 0) return;
    try {
      await pilotProfileRepository.updateProfile(patch);
    } catch {
      // Setup is not the place to fail. Everything here is re-editable on the account
      // screen, and blocking the pilot behind a write error would be far worse.
    }
  }, [pilotName, registrationId, glider]);

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
        This name is written into every IGC file you export. XContest matches your claims against
        it, so use the name you fly under.
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
          hint="Leave it blank and files ship as UNSPECIFIED — still valid, just anonymous."
        />
        <Input
          label="Pilot registration ID — optional"
          value={registrationId}
          placeholder="Licence or federation number"
          maxLength={30}
          autoCapitalize="characters"
          onChangeText={onRegistrationId}
          hint="Your APPI, FAI or club number. Only needed if you fly comps or claim under a federation — it rides along in the file header."
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
        Your usual wing. Every flight starts with this one, and you can change it per flight when
        you save.
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
        Flying something borrowed today? Change it on the save sheet when you land — this is only
        the default.
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
        Every flight is saved on this phone the second you land, with or without an account. An
        account only decides whether a second copy exists if the phone is lost, wiped or replaced.
      </Text>
      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Without an account"
          value={`${GUEST_FLIGHT_CAPACITY} flights`}
          mono={false}
          detail={`This phone keeps ${GUEST_FLIGHT_CAPACITY} saved flights. Recording is never blocked and nothing is ever removed for you — past ${GUEST_FLIGHT_CAPACITY}, the logbook asks you to sign in or remove one yourself.`}
        />
        <ListRow
          label="With a free account"
          value="Unlimited"
          mono={false}
          tone="good"
          showDot
          detail="Every flight backed up with its stats and its IGC file. Your logbook stays on this phone as well."
          last
        />
      </Card>
      {auth.status === 'signed_in' ? (
        <Notice tone="good" title="Signed in">
          Your flights will back up automatically from now on.
        </Notice>
      ) : auth.status === 'unconfigured' || auth.status === 'unsupported' ? (
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
        We store your email, your flight summaries and your IGC files — never your raw GPS track.
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
      <Text style={styles.wordmark}>XC TRACKER</Text>
      <Text style={styles.tagline}>Every flight, kept.</Text>
      <Text style={styles.body}>
        Tap record before you launch. XC Tracker keeps the whole flight with the screen off and no
        signal, then hands you a logbook entry and an IGC file when you land.
      </Text>

      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Records in the background"
          detail="Pocket the phone, it keeps going."
          mono={false}
        />
        <ListRow
          label="Works with no account and no network"
          detail="Nothing here waits on a signal."
          mono={false}
        />
        <ListRow
          label="Exports a real IGC"
          detail="The file you claim on XContest."
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
      <Text style={styles.eyebrow}>THE ONE STEP WE CAN&apos;T SKIP</Text>
      <Text style={styles.heading}>Android has to let us follow you.</Text>
      <Text style={styles.body}>
        Without background location the track stops the second you pocket the phone — and you&apos;d
        only find out after landing.
      </Text>

      <Card className="px-[16px] py-[4px]">
        <ListRow
          label="Location · precise"
          value={foreground === 'granted' ? 'ALLOWED' : 'NEEDED'}
          tone={foreground === 'granted' ? 'good' : foreground === 'denied' ? 'danger' : 'neutral'}
          showDot
          detail="The GPS fixes that become your track. Coarse location can't record a flight."
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
          detail="Shows the recording notification so Android never kills the flight to save power."
          last
        />
      </Card>

      <Disclaimer align="left">
        This is also how we name your launch — the site fills itself in from where you took off, so
        there&apos;s nothing to set up.
      </Disclaimer>

      {denied ? (
        <Notice tone="warning" title="Android is not asking again">
          Once a permission is refused twice, only the system settings can grant it.
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

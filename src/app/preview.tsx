import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BusyRow,
  Button,
  Card,
  Chip,
  Disclaimer,
  Hairline,
  Input,
  LinkButton,
  ListRow,
  Meter,
  Notice,
  SectionLabel,
  StateLabel,
  StatusPill,
  TopBar,
} from '@/components/ui';
import { OTP_LENGTH } from '@/cloud/config';
import {
  AccountCard,
} from '@/features/account/components/account-card';
import { IdentityCard } from '@/features/account/components/identity-card';
import { igcHeaderPreview } from '@/features/account/account-identity';
import {
  CloudUnconfiguredNotice,
  SignInCard,
} from '@/features/account/components/sign-in-card';
import { MetadataForm } from '@/features/flights/components/metadata-form';
import {
  BackupStep,
  GliderStep,
  LocationStep,
  PilotStep,
  WelcomeStep,
} from '@/features/onboarding/components/onboarding-overlay';
import { StepChrome } from '@/features/onboarding/components/step-chrome';
import { EmptyLogbook } from '@/features/logbook/components/empty-logbook';
import { SetupChecklistCard } from '@/features/logbook/components/setup-checklist-card';
import { setupChecklist } from '@/features/logbook/setup-checklist';
import {
  GUEST_FLIGHT_CAPACITY,
  backupSummary,
  evaluateGuestCapacity,
  guestCapacityNotice,
} from '@/features/logbook/guest-capacity';
import { InstrumentView } from '@/features/record/components/instrument';
import type {
  FlightSummary,
  PilotProfile,
  RecorderCapabilities,
  RecorderSnapshot,
} from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

/**
 * Visual QA harness. Not a product route — it exists so `dist/visual/shot.sh` can render the
 * component kit through react-native-web and headless Chromium at a 392 px frame, since no
 * Android emulator is available on this machine and the product routes short-circuit to
 * `UnsupportedScreen` on web.
 *
 * Usage: `expo start --port 8091` then `dist/visual/shot.sh <name> 392x<h> <set>`.
 * Sets: `kit` (every primitive and variant), `instrument` (the in-flight recorder view),
 * `account-empty` / `account-profile` (the pilot profile before and after it is filled in),
 * `account-signed-out` / `account-signed-in` / `account-unconfigured` / `account-error`
 * (the backup card in each of its states), and `capacity-near` / `capacity-full` /
 * `capacity-over` / `capacity-over-blocked` (the guest flight-capacity banner, whose
 * `over-blocked` variant is the one most likely to ship wrong because it is the only
 * state with no removable flight to offer), and `setup-welcome` / `setup-pilot` /
 * `setup-glider` / `setup-location` / `setup-location-granted` / `setup-backup` (the
 * five first-run steps from design 2a).
 *
 * Delete before handoff — it is a development fixture, not shipped UI.
 */

const CAPABILITIES: RecorderCapabilities = {
  platform: 'android',
  supported: true,
  taskManagerAvailable: true,
  locationServicesEnabled: true,
  gpsAvailable: true,
  preciseLocation: true,
  pressureAvailable: false,
  batteryAvailable: true,
  sharingAvailable: true,
  foregroundPermission: 'granted',
  backgroundPermission: 'granted',
};

// Fixed timestamps: the React Compiler lint rules forbid Date.now() in render, and stable
// values keep screenshots byte-comparable between runs.
const NOW = 1_760_000_000_000;

const SNAPSHOT: RecorderSnapshot = {
  capturedAt: NOW,
  state: 'recording',
  flightId: 'flight-fixture',
  sessionId: 'session-fixture',
  startedAt: NOW - 4_215_000,
  endedAt: null,
  lastFixAt: NOW - 1_000,
  lastFixReceivedAt: NOW - 1_000,
  lastLocationCallbackAt: NOW - 1_000,
  captureHealth: 'healthy',
  durationMs: 4_215_000,
  fixCount: 4198,
  pressureCount: 0,
  gpsAltitude: 1847,
  speed: 9.7,
  horizontalAccuracy: 4.2,
  pressure: null,
  batteryLevel: 0.62,
  lowPowerMode: false,
  batteryOptimizationEnabled: false,
  taskRegistered: true,
  capabilities: CAPABILITIES,
  lastError: null,
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionLabel>{title}</SectionLabel>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

function KitPreview() {
  const noop = () => undefined;
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      <TopBar onBack={noop} title="Component kit" right={<Chip label="preview" tone="muted" />} />

      <Group title="Buttons">
        <Button label="Primary xl" variant="primary" size="xl" leadingDot onPress={noop} />
        <Button label="Primary lg" variant="primary" size="lg" onPress={noop} />
        <Button label="Secondary" variant="secondary" onPress={noop} />
        <Button label="Ghost" variant="ghost" onPress={noop} />
        <Button label="Dark" variant="dark" onPress={noop} />
        <Button label="Danger" variant="danger" onPress={noop} />
        <Button label="Disabled" variant="secondary" disabled onPress={noop} />
        <Button label="Busy" variant="primary" busy onPress={noop} />
        <LinkButton label="Open Android settings ›" onPress={noop} />
      </Group>

      <Group title="Chips">
        <View style={styles.row}>
          <Chip label="good" tone="good" />
          <Chip label="altitude" tone="altitude" />
          <Chip label="muted" tone="muted" />
        </View>
        <View style={styles.row}>
          <Chip label="warning" tone="warning" />
          <Chip label="danger" tone="danger" />
          <Chip label="thermal" tone="thermal" />
        </View>
      </Group>

      <Group title="State labels">
        <StateLabel label="All good" tone="good" />
        <StateLabel label="Needs attention" tone="warning" />
        <StateLabel label="Blocked" tone="danger" />
        <StateLabel label="Idle" tone="neutral" />
      </Group>

      <Group title="Status pills">
        <View style={styles.row}>
          <StatusPill label="REC" tone="good" emphasis />
          <StatusPill label="GPS stale" tone="warning" />
        </View>
        <View style={styles.row}>
          <StatusPill label="Not running" tone="danger" />
          <StatusPill label="Phone sensors · 62%" tone="neutral" />
        </View>
      </Group>

      <Group title="Surfaces">
        <Card className="p-[14px]">
          <Text style={styles.cardText}>Default card</Text>
        </Card>
        <Card variant="dark" className="p-[14px]">
          <Text style={styles.cardTextOnDark}>Dark card</Text>
        </Card>
        <Card className="p-[14px]">
          <ListRow label="Location services" value="On" tone="good" showDot />
          <ListRow label="Barometer" value="Not available" tone="warning" showDot
            detail="Altitude comes from GPS only." />
          <ListRow label="Battery optimisation" value="Restricted" tone="danger" showDot
            action={{ label: 'Open settings', onPress: noop }} last />
        </Card>
        <Hairline />
      </Group>

      <Group title="Notices">
        <Notice tone="info" title="Information">Body copy for an informational notice.</Notice>
        <Notice tone="good" title="All good">Capture is healthy and fixes are landing.</Notice>
        <Notice tone="warning" title="No valid GPS fix for 12 s">
          Fixes already recorded are safe.
        </Notice>
        <Notice tone="danger" title="That did not work">The recorder could not start.</Notice>
        <BusyRow label="Saving flight…" />
      </Group>

      <Group title="Inputs">
        <Card className="px-[16px] pt-[4px] pb-[4px]">
          <Input
            label="Email"
            value="renate@example.com"
            placeholder="you@example.com"
            maxLength={254}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={noop}
          />
          <Input
            label="Code"
            value=""
            placeholder="12345678"
            maxLength={OTP_LENGTH}
            keyboardType="number-pad"
            hint="Resend code in 43 s"
            onChangeText={noop}
          />
          <Input
            label="Pilot name"
            value="Not a real code"
            placeholder="As it should appear in your IGC files"
            maxLength={60}
            error="That code is not right. Check the email and try again."
            onChangeText={noop}
          />
          <Input
            label="Disabled"
            value=""
            placeholder="Sign in to edit"
            maxLength={60}
            editable={false}
            last
            onChangeText={noop}
          />
        </Card>
      </Group>

      <Group title="Forms">
        <MetadataForm
          values={{
            title: 'Sunset glass-off',
            site: 'Sopelana',
            notes: 'Smooth ridge lift until the sea breeze died. Landed on the beach.',
          }}
          onChange={noop}
          dirty
          saving={false}
          onSave={noop}
        />
      </Group>

      <Group title="Typography">
        <Text style={styles.cardText}>Body text sample</Text>
        <Disclaimer>Not a certified flight recorder. Never fly with this as your only recorder.</Disclaimer>
      </Group>
    </ScrollView>
  );
}

function InstrumentPreview({ compact }: { compact: boolean }) {
  const noop = () => undefined;
  return (
    <InstrumentView
      snapshot={SNAPSHOT}
      capture={{ label: 'REC', tone: 'good', title: 'Capture healthy', description: '' }}
      notices={
        compact
          ? [
              {
                key: 'stale',
                tone: 'warning',
                title: 'No valid GPS fix for 12 s',
                body: 'Fixes already recorded are safe.',
              },
            ]
          : []
      }
      busyLabel={null}
      actionsDisabled={false}
      errorMessage={null}
      recoveryError={null}
      onBack={noop}
      onStop={noop}
      onRetrySave={noop}
    />
  );
}

type AccountBackupState = 'signed-out' | 'signed-in' | 'unconfigured' | 'error';

function BackupPreview({ state }: { state: AccountBackupState }) {
  const noop = () => undefined;
  const never = async () => undefined;
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      <TopBar title="Account" right={<Chip label="preview" tone="muted" />} />
      <Group title="Backup">
        {state === 'unconfigured' ? <CloudUnconfiguredNotice /> : null}
        {state === 'signed-in' ? (
          <AccountCard email="renate@example.com" busy={false} onSignOut={noop} />
        ) : null}
        {state === 'signed-out' || state === 'error' ? (
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
        ) : null}
        {state === 'signed-out' || state === 'error' ? (
          <SignInCard
            requestOtp={never}
            verifyOtp={never}
            error={state === 'error' ? 'Too many codes requested. Wait a minute and try again.' : null}
            onClearError={noop}
          />
        ) : null}
      </Group>
    </ScrollView>
  );
}

const OLDEST_FLIGHT: FlightSummary = {
  id: 'oldest',
  recordingSessionId: 'session-oldest',
  status: 'completed',
  startedAt: NOW - 240 * 24 * 3_600_000,
  endedAt: NOW - 240 * 24 * 3_600_000 + 3_600_000,
  timezoneOffsetMinutes: -120,
  title: null,
  site: 'Sopelana',
  notes: null,
  takeoffLatitude: 43.38,
  takeoffLongitude: -3.08,
  siteSource: 'gps',
  siteResolvedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  sessionStatus: 'completed',
  metrics: null,
};

type SetupSet =
  | 'welcome'
  | 'pilot'
  | 'glider'
  | 'location'
  | 'location-granted'
  | 'backup';

/** Fully-granted permissions, for the "everything allowed" variant of the location step. */
const GRANTED_CAPABILITIES: RecorderCapabilities = {
  ...CAPABILITIES,
  foregroundPermission: 'granted',
  backgroundPermission: 'granted',
};

const EMPTY_PROFILE: PilotProfile = {
  pilotName: null,
  gliderType: null,
  gliderId: null,
  registrationId: null,
  homeSite: null,
  homeSiteSource: 'auto',
  updatedAt: 0,
  pushedUpdatedAt: null,
};

/** Design 2b: the logbook of someone who skipped setup, versus one who finished it. */
function FreshLogbookPreview({ skipped }: { skipped: boolean }) {
  const noop = () => undefined;
  const checklist = skipped
    ? setupChecklist({
        profile: EMPTY_PROFILE,
        capabilities: { ...CAPABILITIES, foregroundPermission: 'granted', backgroundPermission: 'granted' },
      })
    : null;
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      <TopBar title="Logbook" right={<Chip label="preview" tone="muted" />} />
      {checklist ? (
        <View style={styles.group}>
          <SetupChecklistCard checklist={checklist} onSelect={noop} />
        </View>
      ) : null}
      <EmptyLogbook
        pilotName={skipped ? null : 'Renate Gouveia'}
        hasSetup={!skipped}
        onRecord={noop}
      />
    </ScrollView>
  );
}

function SetupPreview({ set }: { set: SetupSet }) {
  const noop = () => undefined;
  const never = async () => undefined;
  const step = set === 'welcome' ? null : { current: 1, total: 4 };
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      {step ? <StepChrome current={step.current} total={step.total} onBack={noop} /> : null}
      {set === 'welcome' ? (
        <WelcomeStep acknowledged={false} onAcknowledge={noop} onStart={noop} onSkip={noop} />
      ) : null}
      {set === 'pilot' ? (
        <PilotStep
          pilotName="Renate Gouveia"
          registrationId=""
          onPilotName={noop}
          onRegistrationId={noop}
          onContinue={noop}
          onSkip={noop}
        />
      ) : null}
      {set === 'glider' ? (
        <GliderStep glider="" onGlider={noop} onContinue={noop} onSkip={noop} />
      ) : null}
      {set === 'location' || set === 'location-granted' ? (
        <LocationStep
          capabilities={set === 'location-granted' ? GRANTED_CAPABILITIES : null}
          asking={false}
          onAsk={noop}
          onOpenSettings={noop}
          onContinue={noop}
        />
      ) : null}
      {set === 'backup' ? (
        <BackupStep
          auth={{
            status: 'signed_out',
            userId: null,
            email: null,
            lastError: null,
            requestOtp: never,
            verifyOtp: never,
            signOut: never,
            deleteAccount: never,
          }}
          error={null}
          onClearError={noop}
          onDone={noop}
        />
      ) : null}
    </ScrollView>
  );
}

function CapacityPreview({ saved, removable }: { saved: number; removable: boolean }) {
  const noop = () => undefined;
  const capacity = evaluateGuestCapacity({
    savedFlights: saved,
    authStatus: 'signed_out',
    linkedUserId: null,
  });
  const notice = guestCapacityNotice(capacity, removable ? OLDEST_FLIGHT : null);
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      <TopBar title="Logbook" right={<Chip label="preview" tone="muted" />} />
      <Group title={`${saved} of ${capacity.limit} flights`}>
        {notice ? (
          <>
            <Notice tone={notice.tone} title={notice.title}>
              {notice.body}
            </Notice>
            <Button label={notice.primaryLabel} variant="primary" onPress={noop} />
            {notice.remove ? (
              <Button label={notice.remove.label} variant="secondary" onPress={noop} />
            ) : null}
            {notice.dismissible ? <LinkButton label="Not now" onPress={noop} /> : null}
          </>
        ) : (
          <Text style={styles.cardText}>No banner at this count.</Text>
        )}
      </Group>
    </ScrollView>
  );
}

/** Design 2c: the Account screen as a summary, filled in and untouched. */
function AccountPreview({ filled }: { filled: boolean }) {
  const noop = () => undefined;
  const profile: PilotProfile = filled
    ? {
        ...EMPTY_PROFILE,
        pilotName: 'Renate Gouveia',
        gliderType: 'Ozone Rush 6',
        gliderId: 'D-1234',
        registrationId: null,
        homeSite: 'Bukit Bubus',
      }
    : EMPTY_PROFILE;
  const stats = filled
    ? { flightCount: 6, airtimeMs: 8 * 3_600_000 + 31 * 60_000, sinceLabel: 'AUG 26' }
    : { flightCount: 0, airtimeMs: 0, sinceLabel: null };
  const capacity = evaluateGuestCapacity({
    savedFlights: filled ? 6 : 0,
    authStatus: 'signed_out',
    linkedUserId: null,
  });
  const backup = backupSummary(capacity);
  return (
    <ScrollView style={styles.kitScreen} contentContainerStyle={styles.kit}>
      <TopBar title="Account" right={<Chip label="preview" tone="muted" />} />
      <View style={styles.group}>
        <IdentityCard profile={profile} stats={stats} onEdit={noop} />
      </View>
      <Group title="Backup">
        <Card className="px-[16px] py-[12px]">
          <Text style={styles.cardText}>{`${backup.headline}${backup.value ? `  ·  ${backup.value}` : ''}`}</Text>
          {backup.meter ? (
            <View style={styles.meterWrap}>
              <Meter value={backup.meter.value} max={backup.meter.max} tone={backup.meter.tone} />
            </View>
          ) : null}
          <Text style={styles.previewNote}>{backup.detail}</Text>
        </Card>
      </Group>
      <Group title="Pilot">
        <Card className="px-[16px] py-[4px]">
          <ListRow label="Pilot name" value={profile.pilotName ?? 'Not set'} mono={false} />
          <ListRow label="Registration ID" value={profile.registrationId ?? 'Not set'} mono={false} />
          <ListRow label="Glider" value={profile.gliderType ?? 'Not set'} mono={false} />
          <ListRow label="Home site" value={profile.homeSite ?? 'Not set'} mono={false}
            detail="From your flights — picked from where you launch most." last />
        </Card>
      </Group>
      <Group title="How it lands in the file">
        <Card className="px-[16px] py-[12px]">
          {igcHeaderPreview(profile).map((line) => (
            <Text key={line} style={styles.igcLine}>
              {line}
            </Text>
          ))}
        </Card>
      </Group>
    </ScrollView>
  );
}

export default function PreviewRoute() {
  const { set } = useLocalSearchParams<{ set?: string }>();
  if (set === 'instrument') return <InstrumentPreview compact={false} />;
  if (set === 'instrument-degraded') return <InstrumentPreview compact />;
  if (set === 'account-empty') return <AccountPreview filled={false} />;
  if (set === 'account-profile') return <AccountPreview filled />;
  if (set === 'account-signed-out') return <BackupPreview state="signed-out" />;
  if (set === 'account-signed-in') return <BackupPreview state="signed-in" />;
  if (set === 'account-unconfigured') return <BackupPreview state="unconfigured" />;
  if (set === 'account-error') return <BackupPreview state="error" />;
  if (set === 'logbook-setup-done') return <FreshLogbookPreview skipped={false} />;
  if (set === 'logbook-setup-skipped') return <FreshLogbookPreview skipped />;
  if (set === 'setup-welcome') return <SetupPreview set="welcome" />;
  if (set === 'setup-pilot') return <SetupPreview set="pilot" />;
  if (set === 'setup-glider') return <SetupPreview set="glider" />;
  if (set === 'setup-location') return <SetupPreview set="location" />;
  if (set === 'setup-location-granted') return <SetupPreview set="location-granted" />;
  if (set === 'setup-backup') return <SetupPreview set="backup" />;
  if (set === 'capacity-near') return <CapacityPreview saved={8} removable />;
  if (set === 'capacity-full') return <CapacityPreview saved={10} removable />;
  if (set === 'capacity-over') return <CapacityPreview saved={11} removable />;
  if (set === 'capacity-over-blocked') return <CapacityPreview saved={11} removable={false} />;
  return <KitPreview />;
}

const styles = StyleSheet.create({
  kitScreen: { flex: 1, backgroundColor: paper.background },
  kit: { paddingBottom: 40 },
  group: { paddingHorizontal: 18, paddingTop: 22, gap: 10 },
  groupBody: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardText: { fontFamily: fonts.sans, fontSize: 13.5, color: paper.text },
  cardTextOnDark: { fontFamily: fonts.sans, fontSize: 13.5, color: paper.onDark },
  meterWrap: { paddingVertical: 9 },
  previewNote: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16.5, color: paper.text },
  igcLine: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: paper.text },
});

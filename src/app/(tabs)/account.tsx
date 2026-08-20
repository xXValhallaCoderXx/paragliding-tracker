import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import {
  BusyRow,
  Card,
  Disclaimer,
  LinkButton,
  ListRow,
  Meter,
  Notice,
  Screen,
  SectionLabel,
  UnsupportedScreen,
} from '@/components/ui';
import { accountStats } from '@/features/account/account-identity';
import { cloudOnlySummary, describeSync } from '@/features/account/account-presentation';
import { useCloudAuth } from '@/features/account/auth-provider';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import {
  AccountCard,
  RestoringAccountCard,
} from '@/features/account/components/account-card';
import { AccountDangerZone } from '@/features/account/components/account-danger-zone';
import { IdentityCard } from '@/features/account/components/identity-card';
import { PilotDetailsSheet } from '@/features/account/components/pilot-details-sheet';
import {
  CloudUnconfiguredNotice,
  SignInCard,
} from '@/features/account/components/sign-in-card';
import { SyncCard } from '@/features/account/components/sync-card';
import { PRIVACY_POLICY_URL, privacyPolicyReady } from '@/features/account/legal';
import {
  backupSummary,
  countSavedFlights,
  evaluateGuestCapacity,
  GUEST_FLIGHT_CAPACITY,
} from '@/features/logbook/guest-capacity';
import { buildLogbookLayout } from '@/features/logbook/logbook';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import type { FlightSummary, PilotProfilePatch } from '@/recorder/types';
import { useGetFlightsQuery, useGetProfileQuery, useUpdateProfileMutation } from '@/store/endpoints';
import { DATA_AVAILABLE } from '@/store/hooks';
import { fonts, paper, TAB_BAR_HEIGHT } from '@/ui/theme';

/**
 * The pilot's account: who they are, whether their flights have a second copy, and the
 * details that end up in an IGC file.
 *
 * A summary, not a form. First-run setup asks for these details with the reason each one
 * matters attached; this screen's job is to show the answers back and let them be changed,
 * which is why every row is a link into one sheet rather than four permanently-open fields.
 */
/** Stable identity, so the memos downstream are not invalidated by a fresh `[]`. */
const EMPTY_FLIGHTS: FlightSummary[] = [];

export default function AccountScreen() {
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // "3 min ago" has to age, but Date.now() during render is impure and React Compiler
  // rejects it. A ticking state value keeps the render a pure function of props+state.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Both come from the same cache the logbook fills, so opening Account after the logbook
  // costs nothing. The flights are only decoration here — the stats row and the meter —
  // so an unavailable read degrades to an empty logbook rather than an error.
  const skip = !DATA_AVAILABLE || !recorderLifecycle.ready;
  const { data: profile = null, isLoading: loading } = useGetProfileQuery(undefined, { skip });
  const { data: flights = EMPTY_FLIGHTS } = useGetFlightsQuery(undefined, { skip });
  const [updateProfile, { isLoading: saving }] = useUpdateProfileMutation();

  // Only to age the "3 min ago" label; the data itself no longer needs a focus pass.
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );

  const deleteAccount = async () => {
    setDeleting(true);
    setAuthError(null);
    try {
      await auth.deleteAccount();
    } catch (deleteError) {
      // Never optimistically sign out: if the server copy might still exist, the pilot
      // has to be able to try again.
      setAuthError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await auth.signOut();
    } finally {
      setSigningOut(false);
    }
  };

  const save = async (patch: PilotProfilePatch) => {
    setError(null);
    try {
      // Invalidates the Profile tag, so the logbook's setup checklist and its greeting
      // refresh too — they used to stay stale until the logbook was focused again.
      await updateProfile(patch).unwrap();
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  if (Platform.OS === 'web') return <UnsupportedScreen />;

  const stats = accountStats(flights);
  // Counts the cards the logbook renders, via the same layout, so this meter and the
  // logbook's banner can never disagree about how full the phone is.
  const capacity = evaluateGuestCapacity({
    savedFlights: countSavedFlights(buildLogbookLayout(flights)),
    authStatus: auth.status,
    linkedUserId: sync.linkedUserId,
  });
  const backup = backupSummary(capacity);
  const canSignIn = auth.status === 'signed_out';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={12}
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.gear, pressed && styles.pressed]}>
            <Text style={styles.gearGlyph}>⚙</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.block}>
            <Notice tone="danger" title="That did not work">
              {error}
            </Notice>
          </View>
        ) : null}

        {loading || !profile ? (
          <View style={styles.block}>
            <BusyRow label="Loading your details…" />
          </View>
        ) : (
          <View style={styles.block}>
            <IdentityCard profile={profile} stats={stats} onEdit={() => setEditing(true)} />
          </View>
        )}

        <View style={styles.block}>
          <SectionLabel>Backup</SectionLabel>
          {auth.status === 'restoring' ? (
            <RestoringAccountCard />
          ) : auth.status === 'signed_in' ? (
            <>
              <AccountCard email={auth.email} busy={signingOut} onSignOut={() => void signOut()} />
              <SyncCard
                status={describeSync(sync, now)}
                onSyncNow={() => sync.requestSync('manual')}
                cloudOnly={cloudOnlySummary(sync)}
                onUseThisAccount={
                  sync.blockedBy === 'account_mismatch'
                    ? () => void sync.rebindToCurrentAccount()
                    : null
                }
              />
            </>
          ) : (
            <>
              <View style={styles.backupCard}>
                <View style={styles.backupHeader}>
                  <Text style={styles.backupHeadline}>{backup.headline}</Text>
                  {backup.value ? <Text style={styles.backupValue}>{backup.value}</Text> : null}
                </View>
                {backup.meter ? (
                  <Meter
                    value={backup.meter.value}
                    max={backup.meter.max}
                    tone={backup.meter.tone}
                  />
                ) : null}
                <Text style={styles.backupDetail}>{backup.detail}</Text>
              </View>

              {auth.status === 'unconfigured' || auth.status === 'unsupported' ? (
                <CloudUnconfiguredNotice />
              ) : null}

              {canSignIn ? (
                <>
                  <Card className="px-[16px] py-[4px]">
                    <ListRow
                      label="With a free account"
                      value="Unlimited"
                      mono={false}
                      tone="good"
                      showDot
                      detail={`Every flight backed up with its stats and its IGC file. Without one, this phone keeps ${GUEST_FLIGHT_CAPACITY}.`}
                      last
                    />
                  </Card>
                  <SignInCard
                    requestOtp={auth.requestOtp}
                    verifyOtp={auth.verifyOtp}
                    error={authError ?? auth.lastError?.message ?? null}
                    onClearError={() => setAuthError(null)}
                  />
                  <Disclaimer align="left">
                    No password. We store your email, your flight summaries and your IGC files —
                    never your raw GPS track.
                  </Disclaimer>
                </>
              ) : null}
            </>
          )}
        </View>

        {profile && !loading ? (
          <View style={styles.block}>
            <SectionLabel>Pilot</SectionLabel>
            {/* Whole rows are the affordance, with a chevron, rather than a "Change"
                link under each one: four link buttons in a row reads as four different
                destinations when they all open the same sheet. */}
            <Card className="px-[16px] py-[4px]">
              <PilotRow
                label="Pilot name"
                value={profile.pilotName}
                onPress={() => setEditing(true)}
              />
              <PilotRow
                label="Registration ID"
                value={profile.registrationId}
                onPress={() => setEditing(true)}
              />
              <PilotRow
                label="Glider"
                value={profile.gliderType}
                onPress={() => setEditing(true)}
              />
              <PilotRow
                label="Home site"
                value={profile.homeSite}
                detail={
                  profile.homeSiteSource === 'auto'
                    ? 'From your flights — picked from where you launch most.'
                    : null
                }
                onPress={() => setEditing(true)}
                last
              />
            </Card>
            <Disclaimer align="left">
              Your name and glider are written into every IGC file you export. Changing them here
              won&apos;t rewrite flights you&apos;ve already saved.
            </Disclaimer>
          </View>
        ) : null}

        {privacyPolicyReady ? (
          <View style={styles.block}>
            {/* Reachable while signed out on purpose: App Review taps it before signing in. */}
            <LinkButton
              label="Privacy policy ›"
              onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
            />
          </View>
        ) : null}

        {auth.status === 'signed_in' ? (
          <AccountDangerZone busy={deleting} onDelete={() => void deleteAccount()} />
        ) : null}
      </ScrollView>

      {profile ? (
        <PilotDetailsSheet
          visible={editing}
          profile={profile}
          saving={saving}
          onCancel={() => setEditing(false)}
          onSave={(patch) => void save(patch)}
        />
      ) : null}
    </Screen>
  );
}

/** One tappable summary row. Every one of them opens the same sheet. */
function PilotRow({
  label,
  value,
  detail,
  onPress,
  last = false,
}: {
  label: string;
  value: string | null;
  detail?: string | null;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 'not set'}`}
      accessibilityHint="Opens pilot details"
      onPress={onPress}
      style={({ pressed }) => [styles.pilotRow, last && styles.pilotRowLast, pressed && styles.pressed]}>
      <View style={styles.pilotRowTop}>
        <Text style={styles.pilotLabel}>{label}</Text>
        <View style={styles.pilotValueWrap}>
          <Text style={[styles.pilotValue, !value && styles.pilotValueEmpty]} numberOfLines={1}>
            {value ?? 'Not set'}
          </Text>
          <Text style={styles.pilotChevron}>›</Text>
        </View>
      </View>
      {detail ? <Text style={styles.pilotDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40 + TAB_BAR_HEIGHT },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  title: { fontFamily: fonts.sansBold, fontSize: 26, color: paper.ink, letterSpacing: -0.4 },
  gear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  gearGlyph: { fontSize: 18, color: paper.muted },
  block: { paddingHorizontal: 18, paddingTop: 10, gap: 10 },
  backupCard: {
    backgroundColor: paper.card,
    borderColor: paper.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 9,
  },
  backupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  backupHeadline: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: paper.ink, flexShrink: 1 },
  backupValue: { fontFamily: fonts.monoMedium, fontSize: 13, color: paper.ink },
  backupDetail: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16.5, color: paper.text },
  pilotRow: {
    gap: 3,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: paper.hairline,
  },
  pilotRowLast: { borderBottomWidth: 0 },
  pilotRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pilotLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: paper.ink, flexShrink: 1 },
  pilotValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  pilotValue: { fontFamily: fonts.sansSemi, fontSize: 13, color: paper.ink, textAlign: 'right' },
  pilotValueEmpty: { fontFamily: fonts.sans, color: paper.muted },
  pilotChevron: { fontFamily: fonts.sans, fontSize: 16, color: paper.muted },
  pilotDetail: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: paper.text },
});

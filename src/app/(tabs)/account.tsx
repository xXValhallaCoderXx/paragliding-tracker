import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import {
  BusyRow,
  Button,
  Card,
  Disclaimer,
  LinkButton,
  ListRow,
  Notice,
  Screen,
  SectionLabel,
} from '@/components/ui';
import { accountStats } from '@/features/account/account-identity';
import { errorMessage } from '@/lib/format/error-message';
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
import { EquipmentSection } from '@/features/equipment/equipment-section';
import {
  CloudUnconfiguredNotice,
} from '@/features/account/components/sign-in-card';
import { SyncCard } from '@/features/account/components/sync-card';
import { RestoreCard } from '@/features/account/components/restore-card';
import { PRIVACY_POLICY_URL, privacyPolicyReady } from '@/features/account/legal';
import { backupSummary } from '@/features/logbook/backup-summary';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import type { FlightSummary, PilotProfilePatch } from '@/recorder/types';
import { useGetFlightsQuery, useGetProfileQuery, useUpdateProfileMutation } from '@/store/endpoints';
import { fonts, paper } from '@/ui/theme';

/**
 * The pilot's account: who they are, whether their flights have a second copy, and the
 * details that end up in an IGC file.
 *
 * Private identity and equipment stay separate from Friends. Each editor owns a fresh
 * local draft; summaries continue to use the shared local database cache.
 */
/** Stable identity, so the memos downstream are not invalidated by a fresh `[]`. */
const EMPTY_FLIGHTS: FlightSummary[] = [];

export default function AccountScreen() {
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [editing, setEditing] = useState(false);
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
  // costs nothing. The flights supply the local logbook totals,
  // so an unavailable read degrades to an empty logbook rather than an error.
  const skip = !recorderLifecycle.ready;
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
      setAuthError(errorMessage(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    setAuthError(null);
    try {
      await auth.signOut();
    } catch (signOutError) {
      setAuthError(errorMessage(signOutError));
    } finally {
      setSigningOut(false);
    }
  };

  const save = (patch: PilotProfilePatch) => updateProfile(patch).unwrap();

  const stats = accountStats(flights);
  const backup = backupSummary(auth.status, sync.linkedUserId);
  const canSignIn = auth.status === 'signed_out';

  return (
    <Screen edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>YOUR PILOT DETAILS</Text>
          <Text style={styles.title}>Your pilot page</Text>
        </View>

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
          <EquipmentSection ready={recorderLifecycle.ready} profile={profile} />
        </View>

        {profile && !loading ? (
          <View style={styles.block}>
            <SectionLabel>Pilot</SectionLabel>
            <Card className="px-[16px] py-[4px]">
              <PilotRow
                label="Pilot name"
                value={profile.pilotName}
                onPress={() => setEditing(true)}
              />
              <PilotRow
                label="General pilot reference"
                value={profile.registrationId}
                onPress={() => setEditing(true)}
                last
              />

            </Card>
            <Disclaimer align="left">
              Your name is used for newly generated IGC exports. Equipment is saved when
              recording starts. Existing files and restored originals keep their headers.
            </Disclaimer>
          </View>
        ) : null}

        <View style={styles.block}>
          <SectionLabel>Account &amp; backup</SectionLabel>
          {(authError ?? auth.lastError?.message) ? (
            <Notice tone="danger" title="That did not work">
              {authError ?? auth.lastError?.message}
            </Notice>
          ) : null}
          {auth.status === 'restoring' ? (
            <RestoringAccountCard />
          ) : auth.status === 'signed_in' ? (
            <>
              <AccountCard
                email={auth.email}
                busy={signingOut}
                disabled={deleting}
                onSignOut={() => void signOut()}
              />
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
              {sync.restore ? <RestoreCard key={auth.userId} restore={sync.restore}
                onPause={sync.pauseRestore} onResume={sync.resumeRestore} onRetry={sync.retryRestore} /> : null}
            </>
          ) : (
            <>
              <View style={styles.backupCard}>
                <View style={styles.backupHeader}>
                  <Text style={styles.backupHeadline}>{backup.headline}</Text>
                </View>
                <Text style={styles.backupDetail}>{backup.detail}</Text>
              </View>

              {auth.status === 'unconfigured' ? (
                <CloudUnconfiguredNotice />
              ) : null}

              {canSignIn ? (
                <>
                  <Card className="px-[16px] py-[4px]">
                    <ListRow
                      label="Account"
                      value="Signed out"
                      mono={false}
                      detail="Sign in for optional cloud backup. Your pilot details and flights stay on this phone."
                      last
                    />
                  </Card>
                  <Button label="Sign in" variant="primary" onPress={() => router.push('/sign-in')} />
                </>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.block}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            accessibilityHint="Opens recorder, storage and app settings"
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.settingsRow, pressed && styles.pressed]}>
            <View style={styles.settingsText}>
              <Text style={styles.settingsTitle}>Settings</Text>
              <Text style={styles.settingsDetail}>Recorder, storage and app details</Text>
            </View>
            <Text style={styles.settingsChevron}>›</Text>
          </Pressable>
        </View>

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
          <AccountDangerZone
            busy={deleting}
            disabled={signingOut}
            onDelete={() => void deleteAccount()}
          />
        ) : null}
      </ScrollView>

      {profile && editing ? (
        <PilotDetailsSheet
          profile={profile}
          saving={saving}
          onCancel={() => setEditing(false)}
          onSave={save}
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
  content: { paddingBottom: 24 },
  header: {
    gap: 7,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
  },
  eyebrow: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1.4, color: paper.muted },
  title: { fontFamily: fonts.sansBold, fontSize: 30, color: paper.ink, letterSpacing: -0.8 },
  pressed: { opacity: 0.5 },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 64,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: paper.border,
    borderRadius: 22,
    backgroundColor: paper.card,
  },
  settingsText: { flex: 1, gap: 4 },
  settingsTitle: { fontFamily: fonts.sansSemi, fontSize: 16, color: paper.ink },
  settingsDetail: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: paper.muted },
  settingsChevron: { fontFamily: fonts.sans, fontSize: 24, color: paper.muted },
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

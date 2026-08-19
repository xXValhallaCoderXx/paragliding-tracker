import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import {
  BusyRow,
  Disclaimer,
  LinkButton,
  Notice,
  Screen,
  SectionLabel,
  UnsupportedScreen,
} from '@/components/ui';
import {
  cloudOnlySummary,
  describeSync,
  formToPatch,
  igcHeaderSummary,
  isProfileDirty,
  profileToForm,
} from '@/features/account/account-presentation';
import { useCloudAuth } from '@/features/account/auth-provider';
import { useCloudSync } from '@/features/account/cloud-sync-provider';
import {
  AccountCard,
  RestoringAccountCard,
} from '@/features/account/components/account-card';
import {
  EMPTY_PILOT_PROFILE_FORM,
  PilotProfileCard,
  type PilotProfileFormValues,
} from '@/features/account/components/pilot-profile-card';
import {
  CloudUnconfiguredNotice,
  SignInCard,
} from '@/features/account/components/sign-in-card';
import { AccountDangerZone } from '@/features/account/components/account-danger-zone';
import { SyncCard } from '@/features/account/components/sync-card';
import { PRIVACY_POLICY_URL, privacyPolicyReady } from '@/features/account/legal';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { pilotProfileRepository } from '@/recorder/flight-repository';
import type { PilotProfile } from '@/recorder/types';
import { fonts, paper, TAB_BAR_HEIGHT } from '@/ui/theme';

export default function AccountScreen() {
  const recorderLifecycle = useRecorderLifecycle();
  const auth = useCloudAuth();
  const sync = useCloudSync();
  const [profile, setProfile] = useState<PilotProfile | null>(null);
  const [values, setValues] = useState<PilotProfileFormValues>(EMPTY_PILOT_PROFILE_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // "3 min ago" has to age, but Date.now() during render is impure and React Compiler
  // rejects it. A ticking state value keeps the render a pure function of props+state.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const loadProfile = useCallback(async () => {
    if (Platform.OS === 'web' || !recorderLifecycle.ready) return;
    setError(null);
    try {
      const stored = await pilotProfileRepository.getProfile();
      setProfile(stored);
      setValues(profileToForm(stored));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [recorderLifecycle.ready]);

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      void loadProfile();
    }, [loadProfile]),
  );

  const [deleting, setDeleting] = useState(false);

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

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await pilotProfileRepository.updateProfile(formToPatch(values));
      setProfile(saved);
      setValues(profileToForm(saved));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (Platform.OS === 'web') return <UnsupportedScreen />;

  const dirty = profile !== null && isProfileDirty(profile, values);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Account</Text>
          </View>

          {error ? (
            <View style={styles.block}>
              <Notice tone="danger" title="That did not work">
                {error}
              </Notice>
            </View>
          ) : null}

          <View style={styles.block}>
            <SectionLabel>Backup</SectionLabel>
            {auth.status === 'unconfigured' || auth.status === 'unsupported' ? (
              <CloudUnconfiguredNotice />
            ) : auth.status === 'restoring' ? (
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
              <SignInCard
                requestOtp={auth.requestOtp}
                verifyOtp={auth.verifyOtp}
                error={authError ?? auth.lastError?.message ?? null}
                onClearError={() => setAuthError(null)}
              />
            )}
          </View>

          <View style={styles.block}>
            <SectionLabel>Pilot</SectionLabel>
          </View>

          {loading ? (
            <View style={styles.block}>
              <BusyRow label="Loading profile…" />
            </View>
          ) : (
            <View style={styles.block}>
              <PilotProfileCard
                values={values}
                onChange={setValues}
                dirty={dirty}
                saving={saving}
                onSave={() => void save()}
              />
            </View>
          )}

          {profile && !loading ? (
            <Disclaimer align="left">{igcHeaderSummary(profile)}</Disclaimer>
          ) : null}

          <View style={styles.block}>
            <Disclaimer align="left">
              Your pilot details stay on this phone and fill in your IGC files. Flights record
              with or without an account, and with no signal.
            </Disclaimer>
            {privacyPolicyReady ? (
              // Reachable while signed out on purpose: App Review taps it before signing in.
              <LinkButton
                label="Privacy policy ›"
                onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}
              />
            ) : null}
          </View>

          {auth.status === 'signed_in' ? (
            <AccountDangerZone busy={deleting} onDelete={() => void deleteAccount()} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 40 + TAB_BAR_HEIGHT },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
  title: { fontFamily: fonts.sansBold, fontSize: 26, color: paper.ink, letterSpacing: -0.4 },
  block: { paddingHorizontal: 18, paddingTop: 10, gap: 10 },
});

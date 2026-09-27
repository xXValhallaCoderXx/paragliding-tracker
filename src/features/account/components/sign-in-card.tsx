import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Disclaimer, Input, LinkButton, ListRow, Notice } from '@/components/ui';
import { JournalArt } from '@/components/ui/journal-art';
import { OTP_LENGTH } from '@/cloud/config';
import {
  INITIAL_OTP_STATE, canResend, expiryLabel, isCompleteOtpCode, isValidEmail,
  normalizeEmail, normalizeOtpCode, resendLabel, type OtpState,
} from '@/cloud/otp-policy';
import { errorMessage } from '@/lib/format/error-message';
import { paper, spacing, typography } from '@/ui/theme';

export function BackupDisclosure() {
  return <Disclaimer align="left">Backup stores your email, private pilot details, aircraft and sport identifiers, flight summaries including notes and recorded equipment, and IGC files containing GPS coordinates. Raw sensor and diagnostic samples stay on this phone.</Disclaimer>;
}

/** All unfinished input and errors belong to this mounted form. A trip to the email
 * app keeps it mounted; leaving setup or the sign-in route destroys the draft. */
export function SignInCard({ requestOtp, verifyOtp, setup = false, disabled = false }: {
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  setup?: boolean;
  disabled?: boolean;
}) {
  const [state, setState] = useState<OtpState>(INITIAL_OTP_STATE);
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const scope = useRef({ active: false, generation: 0 });

  useEffect(() => {
    scope.current.active = true;
    return () => { scope.current = { active: false, generation: scope.current.generation + 1 }; };
  }, []);
  useEffect(() => {
    if (state.stage !== 'code') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.stage]);

  const run = async (kind: 'send' | 'verify') => {
    if (inFlight.current || disabled || !scope.current.active) return;
    const email = state.stage === 'code' ? state.email : normalizeEmail(emailInput);
    if (kind === 'send' && (!isValidEmail(email) || !canResend(state, Date.now()))) return;
    if (kind === 'verify' && (state.stage !== 'code' || !isCompleteOtpCode(code))) return;
    inFlight.current = true;
    const generation = scope.current.generation;
    const current = () => scope.current.active && scope.current.generation === generation;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'send') {
        await requestOtp(email);
        if (!current()) return;
        const sentAt = Date.now();
        setState({ stage: 'code', email, sentAt });
        setCode('');
        setNow(sentAt);
      } else {
        await verifyOtp(email, code);
        // The auth subscription shows confirmation. Never navigate or finish setup here.
      }
    } catch (failure) {
      if (current()) setError(errorMessage(failure));
    } finally {
      if (current()) { inFlight.current = false; setBusy(null); }
    }
  };

  const locked = busy !== null || disabled;
  if (state.stage === 'email') return <View style={styles.section}>
    {setup ? <JournalArt scene="flight" height={100} /> : null}
    <Text style={styles.eyebrow}>{setup ? 'OPTIONAL' : 'YOUR ACCOUNT'}</Text>
    <Text accessibilityRole="header" style={styles.heading}>{setup ? 'Last one — a backup.' : 'Keep a spare copy'}</Text>
    <Text style={styles.body}>Recording, replay and exports work without an account. Sign in for optional backup and access to Friends.</Text>
    <Card className="px-[16px] py-[4px]">
      <ListRow label="A spare copy" detail="Eligible summaries and IGC files can upload while connected. Your local journal stays available." mono={false} />
      <ListRow label="A new phone, same logbook" detail="Restore backed-up summaries and IGC files. Archived routes download over Wi-Fi by default." mono={false} />
      <ListRow label="Friends, when you choose" detail="Choose your Friends profile separately. Your existing profile and sharing preferences stay as they are." mono={false} last />
    </Card>
    <Card className="px-[16px] pt-[4px] pb-[16px] gap-[4px]">
      <Input label="Email" value={emailInput} placeholder="you@example.com" maxLength={254}
        autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
        returnKeyType="send" onSubmitEditing={() => void run('send')}
        onChangeText={(value) => { if (!inFlight.current && !disabled) { setEmailInput(value); setError(null); } }}
        editable={!locked} error={error} hint={`We'll send an ${OTP_LENGTH}-digit code. No password, no magic link.`} last />
      <Button label={busy === 'send' ? 'Sending…' : 'Email me a code'} variant="primary"
        busy={busy === 'send'} disabled={locked || !isValidEmail(emailInput)} onPress={() => void run('send')} />
    </Card>
    <Disclaimer align="left">Signing in does not create a Friends profile or change discoverability or sharing settings.</Disclaimer>
    <BackupDisclosure />
  </View>;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Check your email</Text>
    <Text style={styles.body}>We sent an eight-digit code to {state.email}.</Text>
    <LinkButton label="Use a different email" disabled={locked} onPress={() => {
      if (inFlight.current || disabled) return;
      setError(null); setCode(''); setState(INITIAL_OTP_STATE);
    }} />
    <Card className="px-[16px] pt-[4px] pb-[16px] gap-[4px]">
      <Input key="code" label="Your code" value={code} placeholder="12345678"
        // No native maxLength: normalize a formatted paste before limiting to eight digits.
        autoCapitalize="none" autoComplete="one-time-code" textContentType="oneTimeCode"
        keyboardType="number-pad" autoFocus
        onChangeText={(value) => { if (!inFlight.current && !disabled) { setCode(normalizeOtpCode(value)); setError(null); } }}
        editable={!locked} error={error} hint={expiryLabel(state, now)} last />
      <Button label={busy === 'verify' ? 'Signing in…' : 'Continue'} variant="primary"
        busy={busy === 'verify'} disabled={locked || !isCompleteOtpCode(code)} onPress={() => void run('verify')} />
    </Card>
    <LinkButton label={busy === 'send' ? 'Sending…' : resendLabel(state, now)}
      disabled={locked || !canResend(state, now)} onPress={() => void run('send')} />
    <Disclaimer align="left">Paste or type the code from your latest email, then tap Continue. You can switch to your email app and come back here.</Disclaimer>
  </View>;
}

export function CloudUnconfiguredNotice() {
  return <Notice tone="info" title="Backup is not set up in this build">Recording, replay and exports still work. Your flights stay on this phone.</Notice>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.section },
  eyebrow: { ...typography.eyebrow, color: paper.actionText },
  heading: { ...typography.title, color: paper.ink },
  body: { ...typography.body, color: paper.text },
});

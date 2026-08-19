import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Input, LinkButton, Notice } from '@/components/ui';
import {
  INITIAL_OTP_STATE,
  canResend,
  isCompleteOtpCode,
  isValidEmail,
  normalizeEmail,
  normalizeOtpCode,
  resendLabel,
  type OtpState,
} from '@/cloud/otp-policy';

/**
 * Two-step email code sign-in.
 *
 * Deliberately not a route: two fields and no navigation state means no deep link to
 * configure, nothing to intercept, and no way to land here from a cold start. All the
 * decisions live in `@/cloud/otp-policy` so jest covers them.
 */
export function SignInCard({
  requestOtp,
  verifyOtp,
  error,
  onClearError,
}: {
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  error: string | null;
  onClearError: () => void;
}) {
  const [state, setState] = useState<OtpState>(INITIAL_OTP_STATE);
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Drives the resend countdown. A state tick rather than a mutated ref, because
  // mutating during render is exactly what React Compiler forbids.
  useEffect(() => {
    if (state.stage !== 'code') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.stage]);

  const send = async (email: string) => {
    setBusy(true);
    onClearError();
    try {
      await requestOtp(email);
      setState({ stage: 'code', email: normalizeEmail(email), sentAt: Date.now() });
      setNow(Date.now());
    } catch {
      // The provider already recorded the failure; `error` renders it.
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    setBusy(true);
    onClearError();
    try {
      await verifyOtp(state.email, value);
    } catch {
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (state.stage === 'email') {
    const valid = isValidEmail(emailInput);
    return (
      <Card className="px-[16px] pt-[4px] pb-[16px] gap-[4px]">
        <Input
          label="Email"
          value={emailInput}
          placeholder="you@example.com"
          maxLength={254}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => {
            if (valid && !busy) void send(emailInput);
          }}
          onChangeText={setEmailInput}
          editable={!busy}
          error={error}
          hint="We'll send a 6-digit code. No password, no magic link."
          last
        />
        <Button
          label={busy ? 'Sending…' : 'Email me a code'}
          variant="primary"
          busy={busy}
          disabled={!valid || busy}
          onPress={() => void send(emailInput)}
        />
      </Card>
    );
  }

  const complete = isCompleteOtpCode(code);
  const resendAllowed = canResend(state, now) && !busy;

  return (
    <Card className="px-[16px] pt-[4px] pb-[16px] gap-[4px]">
      <Input
        label={`Code sent to ${state.email}`}
        value={code}
        placeholder="123456"
        maxLength={6}
        autoCapitalize="none"
        // Lets Android autofill the code straight from the notification, and iOS offer
        // it above the keyboard.
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        keyboardType="number-pad"
        autoFocus
        onChangeText={(value) => {
          const next = normalizeOtpCode(value);
          setCode(next);
          if (next.length === 6 && !busy) void verify(next);
        }}
        editable={!busy}
        error={error}
        hint={resendLabel(state, now)}
        last
      />
      <Button
        label={busy ? 'Signing in…' : 'Verify and sign in'}
        variant="primary"
        busy={busy}
        disabled={!complete || busy}
        onPress={() => void verify(code)}
      />
      <View className="flex-row items-center justify-between pt-[10px]">
        <LinkButton
          label="Use a different email"
          onPress={() => {
            onClearError();
            setCode('');
            setState(INITIAL_OTP_STATE);
          }}
        />
        {resendAllowed ? (
          <LinkButton label="Send a new code" onPress={() => void send(state.email)} />
        ) : null}
      </View>
    </Card>
  );
}

/** Shown when the build has no Supabase configuration at all. */
export function CloudUnconfiguredNotice() {
  return (
    <Notice tone="info" title="Cloud backup is not set up in this build">
      Flights still record and stay on this phone. Backup needs the app to be built with a
      Supabase project configured.
    </Notice>
  );
}

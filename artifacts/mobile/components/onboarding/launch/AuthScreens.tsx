/**
 * Account-creation screens, before a Clerk session exists. Presentational
 * only — app/onboarding.tsx owns the Clerk calls and passes state in.
 *
 *  BirthdayScreen  TikTok "When's your birthday?"   https://mobbin.com/flows/d07ea40f-5774-4111-95bc-bfe13af206f5
 *  EmailScreen     Depop "Sign up or login"          https://mobbin.com/flows/ebfae96e-26ae-4997-babf-d5e7b08bb8c4
 *  CodeScreen      Depop "Check your inbox" (+ code) https://mobbin.com/screens/fd03dc84-8c32-4f9c-b062-307316b6d83d
 *  DetailsScreen   TikTok "Create password"          https://mobbin.com/flows/d07ea40f-5774-4111-95bc-bfe13af206f5
 */
import React, { useContext, useEffect, useState } from 'react';
import { InertContext } from './motion';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { OtpCodeInput } from '@/components/auth/OtpCodeInput';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatDobInput } from '@/lib/ageGate';
import { Field, FieldError, FieldHint, OnbHeader, OnbScreen, PillButton, ScalePressable, Sub, TextLink, Title } from './kit';

// ─── Birthday ────────────────────────────────────────────────────────────────

export function BirthdayScreen({
  value,
  onChange,
  error,
  onBack,
  onContinue,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  onBack: () => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  return (
    <OnbScreen testID="onboarding-birthday" header={<OnbHeader onBack={onBack} title="Sign up" />}>
      <Title style={s.smallTitle}>When’s your birthday?</Title>
      <Sub style={s.smallSub}>Your birthday won’t be shown publicly.</Sub>
      <Field
        testID="onboarding-dob"
        variant="underline"
        label="Date of birth"
        value={value}
        onChangeText={(t) => onChange(formatDobInput(t))}
        placeholder="MM/DD/YYYY"
        keyboardType="number-pad"
        maxLength={10}
        autoFocus
        error={!!error}
        returnKeyType="next"
        onSubmitEditing={() => { if (value.length === 10 && !busy) onContinue(); }}
      />
      <FieldError testID="onboarding-dob-error" message={error} />
      <PillButton
        testID="onboarding-dob-continue"
        label="Continue"
        onPress={onContinue}
        disabled={value.length !== 10}
        loading={busy}
        style={s.inlineButton}
      />
    </OnbScreen>
  );
}

// ─── Email ───────────────────────────────────────────────────────────────────

export function EmailScreen({
  value,
  onChange,
  error,
  onBack,
  onContinue,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  onBack: () => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  return (
    <OnbScreen testID="onboarding-email" header={<OnbHeader onBack={onBack} title="Sign up or log in" />}>
      <Field
        testID="onboarding-email-input"
        label="Email address"
        value={value}
        onChangeText={onChange}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        autoFocus
        error={!!error}
        returnKeyType="go"
        onSubmitEditing={() => { if (valid && !busy) onContinue(); }}
      />
      <FieldError testID="onboarding-email-error" message={error} />
      <PillButton
        testID="onboarding-email-continue"
        label="Continue"
        onPress={onContinue}
        disabled={!valid}
        loading={busy}
        style={s.inlineButton}
      />
    </OnbScreen>
  );
}

// ─── Code ────────────────────────────────────────────────────────────────────

const RESEND_SECONDS = 60;

export function CodeScreen({
  email,
  code,
  onChange,
  onComplete,
  error,
  onBack,
  onEditEmail,
  onResend,
  busy,
}: {
  email: string;
  code: string;
  onChange: (v: string) => void;
  onComplete: (code: string) => void;
  error?: string;
  onBack: () => void;
  /** "Wrong email? Edit": back to the email field with the address kept. */
  onEditEmail: () => void;
  /** Resolves when the new code is on its way. */
  onResend: () => Promise<void>;
  busy?: boolean;
}) {
  const { theme } = useAppTheme();
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [resendNote, setResendNote] = useState('');
  const inert = useContext(InertContext);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  async function resend() {
    setResendNote('');
    try {
      await onResend();
      setSeconds(RESEND_SECONDS);
      setResendNote('New code sent.');
    } catch (e: any) {
      setResendNote(e?.message || 'Couldn’t send a new code. Try again.');
    }
  }

  return (
    <OnbScreen testID="onboarding-code" header={<OnbHeader onBack={onBack} />}>
      <Title style={s.center}>Check your inbox</Title>
      <Sub style={s.center}>
        We’ve just sent a 6-digit code to{'\n'}<Text style={{ color: theme.text, fontWeight: '600' }}>{email}</Text>.
      </Sub>
      <TextLink testID="onboarding-code-edit-email" label="Wrong email? Edit" onPress={onEditEmail} muted />
      <Sub style={s.center}>
        It logs you in if you already have a Brandthread account. If you don’t see the email, check your spam.
      </Sub>
      <View style={s.code}>
        <OtpCodeInput
          testID="onboarding-code-input"
          value={code}
          onChangeText={onChange}
          onComplete={onComplete}
          autoFocus={!inert}
          error={!!error}
          disabled={busy || inert}
        />
      </View>
      <FieldError testID="onboarding-code-error" message={error} />
      <PillButton
        testID="onboarding-code-continue"
        label="Continue"
        onPress={() => onComplete(code)}
        disabled={code.length !== 6}
        loading={busy}
        style={s.inlineButton}
      />
      {seconds > 0 ? (
        <Text style={[s.resendWait, { color: theme.subtle }]}>You can resend again in {seconds} {seconds === 1 ? 'second' : 'seconds'}</Text>
      ) : (
        <TextLink testID="onboarding-code-resend" label="Resend code" onPress={() => { void resend(); }} />
      )}
      {resendNote ? <Text style={[s.resendWait, { color: theme.muted }]}>{resendNote}</Text> : null}
    </OnbScreen>
  );
}

// ─── Extra Clerk requirements ────────────────────────────────────────────────

export function DetailsScreen({
  needsPassword,
  needsName,
  password,
  onPassword,
  firstName,
  onFirstName,
  lastName,
  onLastName,
  error,
  onBack,
  onContinue,
  busy,
}: {
  needsPassword: boolean;
  needsName: boolean;
  password: string;
  onPassword: (v: string) => void;
  firstName: string;
  onFirstName: (v: string) => void;
  lastName: string;
  onLastName: (v: string) => void;
  error?: string;
  onBack: () => void;
  onContinue: () => void;
  busy?: boolean;
}) {
  const { theme } = useAppTheme();
  const [show, setShow] = useState(false);
  const passwordOk = !needsPassword || password.length >= 8;
  const nameOk = !needsName || firstName.trim().length >= 1;
  return (
    <OnbScreen testID="onboarding-details" header={<OnbHeader onBack={onBack} title="Sign up" />}>
      <Title>{needsPassword ? 'Create password' : 'What’s your name?'}</Title>
      {needsName ? (
        <>
          <Field testID="onboarding-first-name" label="First name" value={firstName} onChangeText={onFirstName} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" autoFocus={!needsPassword} />
          <Field testID="onboarding-last-name" label="Last name" value={lastName} onChangeText={onLastName} autoCapitalize="words" autoComplete="family-name" textContentType="familyName" returnKeyType={needsPassword ? 'next' : 'go'} onSubmitEditing={() => { if (!needsPassword && passwordOk && nameOk && !busy) onContinue(); }} />
        </>
      ) : null}
      {needsPassword ? (
        <>
          <Field
            testID="onboarding-password"
            label="Password"
            value={password}
            onChangeText={onPassword}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => { if (passwordOk && nameOk && !busy) onContinue(); }}
            right={(
              <ScalePressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                <Feather name={show ? 'eye-off' : 'eye'} size={20} color={theme.muted} />
              </ScalePressable>
            )}
          />
          <FieldHint message="8 characters minimum" ok={password.length >= 8} />
        </>
      ) : null}
      <FieldError testID="onboarding-details-error" message={error} />
      <PillButton
        testID="onboarding-details-continue"
        label="Continue"
        onPress={onContinue}
        disabled={!passwordOk || !nameOk}
        loading={busy}
        style={s.inlineButton}
      />
    </OnbScreen>
  );
}

const s = StyleSheet.create({
  inlineButton: { marginTop: 24 },
  smallTitle: { fontSize: 22, lineHeight: 28, marginTop: 12 },
  smallSub: { fontSize: 14, lineHeight: 19, marginTop: 4 },
  center: { textAlign: 'center' },
  code: { marginTop: 28 },
  resendWait: { fontSize: 14, textAlign: 'center', marginTop: 16 },
});

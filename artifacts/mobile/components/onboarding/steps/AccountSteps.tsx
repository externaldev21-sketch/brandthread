/**
 * Account steps, one per screen, copied from Instagram's sign-up
 * (https://mobbin.com/flows/4a6da069-d7db-4720-94e6-db74d80428c0) and
 * reskinned: email → confirmation code → password → birthday → terms.
 * Presentational only; app/onboarding.tsx owns Clerk and navigation.
 */
import React from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Input } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';
import { ageInYears, formatDob, MONTH_NAMES } from '@/lib/ageGate';
import { existingAccountCopy } from '@/lib/onboarding/signUpErrors';
import { StepScreen, InlineLink, type StepAction } from './StepScreen';
import { ClearButton, RevealButton } from './FieldAccessories';
import { WheelDatePicker, type WheelDate } from './WheelDatePicker';

export const EMAIL_DOMAINS = ['@gmail.com', '@icloud.com', '@yahoo.com', '@outlook.com', '@hotmail.com'];

/** Appends the picked domain to the local part (mila + @gmail.com gives mila@gmail.com), replacing a partly typed one. */
export function applyEmailDomain(email: string, domain: string): string {
  const local = email.split('@')[0].trim();
  return local ? `${local}${domain}` : email;
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// ─── Email ───────────────────────────────────────────────────────────────────

function DomainChips({ email, onPick }: { email: string; onPick: (domain: string) => void }) {
  const palette = useColors();
  const local = email.split('@')[0];
  const typedDomain = email.includes('@') ? `@${email.split('@')[1] ?? ''}` : '';
  if (!local || EMAIL_DOMAINS.includes(typedDomain)) return null;
  const options = typedDomain.length > 1
    ? EMAIL_DOMAINS.filter((d) => d.startsWith(typedDomain))
    : EMAIL_DOMAINS;
  if (options.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={styles.chipsBar}
      contentContainerStyle={styles.chips}
      testID="onboarding-email-domains"
    >
      {options.map((domain) => (
        <Pressable
          key={domain}
          onPress={() => onPick(domain)}
          accessibilityRole="button"
          accessibilityLabel={`Use ${domain}`}
          style={[styles.chip, { borderColor: palette.border }]}
        >
          <Text style={[styles.chipText, { color: palette.foreground }]}>{domain}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function EmailStep({
  email, onChange, onNext, loading, error, onLogin, apple, google, extra, existing,
}: {
  email: string;
  onChange: (v: string) => void;
  onNext: () => void;
  loading?: boolean;
  error?: string | null;
  onLogin: () => void;
  apple?: StepAction | null;
  google?: StepAction | null;
  /** Under the field: the "Have a code?" link or the invite-code field. */
  extra?: React.ReactNode;
  /** Only when Clerk says this exact email already has an account. */
  existing?: { role: 'buyer' | 'seller' | null; onSwitch: () => void; onUseDifferent: () => void } | null;
}) {
  return (
    <StepScreen
      testID="onboarding-email-step"
      title="What's your email?"
      subtitle="Enter the email where you can be contacted. No one will see this on your profile."
      error={existing ? existingAccountCopy(existing.role) : error}
      primary={existing
        ? { label: 'Switch to it', onPress: existing.onSwitch, testID: 'onboarding-email-switch' }
        : { label: 'Next', onPress: onNext, disabled: !isPlausibleEmail(email), loading, testID: 'onboarding-email-next' }}
      secondary={existing ? undefined : apple ?? google ?? undefined}
      extraSecondary={!existing && apple && google ? google : undefined}
      footerLink={existing
        ? { label: 'Use a different email', onPress: existing.onUseDifferent, testID: 'onboarding-email-use-different' }
        : { label: 'I already have an account', onPress: onLogin, testID: 'onboarding-have-account' }}
      docked={<DomainChips email={email} onPick={(d) => onChange(applyEmailDomain(email, d))} />}
    >
      <Input
        testID="onboarding-email-input"
        label="Email"
        value={email}
        onChangeText={(v) => onChange(v.replace(/\s/g, ''))}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => { if (isPlausibleEmail(email)) onNext(); }}
        autoFocus={Platform.OS !== 'web'}
        right={<ClearButton visible={email.length > 0} onPress={() => onChange('')} />}
      />
      {extra}
    </StepScreen>
  );
}

// ─── Confirmation code ───────────────────────────────────────────────────────

export function CodeStep({
  email, code, onChange, onNext, onResend, loading, resending, error, onLogin,
}: {
  email: string;
  code: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onResend: () => void;
  loading?: boolean;
  resending?: boolean;
  error?: string | null;
  onLogin: () => void;
}) {
  return (
    <StepScreen
      testID="onboarding-code-step"
      title="Enter the confirmation code"
      subtitle={`To confirm your account, enter the 6-digit code we sent to ${email}.`}
      error={error}
      primary={{ label: 'Next', onPress: onNext, disabled: code.length !== 6, loading, testID: 'onboarding-code-next' }}
      secondary={{ label: "I didn't get the code", onPress: onResend, loading: resending, testID: 'onboarding-code-resend' }}
      footerLink={{ label: 'I already have an account', onPress: onLogin, testID: 'onboarding-have-account' }}
    >
      <Input
        testID="onboarding-code-input"
        label="Confirmation code"
        value={code}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus={Platform.OS !== 'web'}
        onSubmitEditing={() => { if (code.length === 6) onNext(); }}
        right={<ClearButton visible={code.length > 0} onPress={() => onChange('')} />}
      />
    </StepScreen>
  );
}

// ─── Password ────────────────────────────────────────────────────────────────

export const MIN_PASSWORD_LENGTH = 8;

export function PasswordStep({
  password, onChange, onNext, error, onLogin,
}: {
  password: string;
  onChange: (v: string) => void;
  onNext: () => void;
  error?: string | null;
  onLogin: () => void;
}) {
  const [shown, setShown] = React.useState(false);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  return (
    <StepScreen
      testID="onboarding-password-step"
      title="Create a password"
      subtitle={`Create a password with at least ${MIN_PASSWORD_LENGTH} letters or numbers. It should be something others can't guess.`}
      error={error}
      primary={{ label: 'Next', onPress: onNext, disabled: password.length < MIN_PASSWORD_LENGTH, testID: 'onboarding-password-next' }}
      footerLink={{ label: 'I already have an account', onPress: onLogin, testID: 'onboarding-have-account' }}
    >
      <Input
        testID="onboarding-password-input"
        label="Password"
        value={password}
        onChangeText={onChange}
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        autoFocus={Platform.OS !== 'web'}
        onSubmitEditing={() => { if (password.length >= MIN_PASSWORD_LENGTH) onNext(); }}
        error={tooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null}
        right={<RevealButton shown={shown} onToggle={() => setShown((v) => !v)} />}
      />
    </StepScreen>
  );
}

// ─── Birthday ────────────────────────────────────────────────────────────────

export function wheelDateToDobInput(d: WheelDate): string {
  return `${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')}/${d.year}`;
}

export function dobToWheelDate(dob: string | null | undefined, today: Date = new Date()): WheelDate {
  const m = dob ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob) : null;
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
}

export function BirthdayStep({
  value, onChange, onNext, error, seller,
}: {
  value: WheelDate;
  onChange: (next: WheelDate) => void;
  onNext: () => void;
  error?: string | null;
  seller: boolean;
}) {
  const palette = useColors();
  const thisYear = new Date().getFullYear();
  const age = ageInYears(formatDob(value.year, value.month, value.day)) ?? 0;
  const display = `${MONTH_NAMES[value.month - 1]} ${value.day}, ${value.year}`;
  const explain = () => Alert.alert(
    'Birthdays',
    seller
      ? 'Your birthday confirms you are 18 or older, which is required to sell and get paid. We keep only your age range, never the date.'
      : 'Your birthday confirms you are old enough to use Brandthread and keeps the right content and safety settings on your account. We keep only your age range, never the date.',
  );
  return (
    <StepScreen
      testID="onboarding-birthday-step"
      title="What's your birthday?"
      subtitle={(
        <>
          Use your own birthday, even if this account is for a business. No one will see this.{' '}
          <InlineLink label="Why do I need to provide my birthday?" onPress={explain} testID="onboarding-birthday-why" />
        </>
      )}
      error={error}
      primary={{ label: 'Next', onPress: onNext, testID: 'onboarding-birthday-next' }}
      docked={<WheelDatePicker value={value} onChange={onChange} minYear={thisYear - 100} maxYear={thisYear} />}
    >
      <View style={[styles.readonlyField, { backgroundColor: FILL_ELEVATED }]} accessibilityLabel={`Birthday, ${display}, ${age} years old`}>
        <Text style={[styles.readonlyLabel, { color: palette.mutedForeground }]}>Birthday ({age} {age === 1 ? 'year' : 'years'} old)</Text>
        <Text testID="onboarding-birthday-value" style={[styles.readonlyValue, { color: palette.foreground }]}>{display}</Text>
      </View>
    </StepScreen>
  );
}

// ─── Terms ───────────────────────────────────────────────────────────────────

export function TermsStep({ onAgree, loading, error }: { onAgree: () => void; loading?: boolean; error?: string | null }) {
  const router = useRouter();
  const link = (label: string, route: string) => (
    <InlineLink label={label} onPress={() => router.push(route as never)} />
  );
  return (
    <StepScreen
      testID="onboarding-terms-step"
      title="Agree to Brandthread's terms and policies"
      subtitle={(
        <>
          Buyers and brands use Brandthread to shop, sell and share. By tapping I agree, you create an account and agree to the{' '}
          {link('Terms of Service', '/terms')} and {link('Community Guidelines', '/community-guidelines')}, including zero tolerance for abusive or objectionable content. The {link('Privacy Policy', '/privacy')} explains how we use your information.
        </>
      )}
      error={error}
      primary={{ label: 'I agree', onPress: onAgree, loading, testID: 'onboarding-terms-agree' }}
    />
  );
}

const styles = StyleSheet.create({
  chipsBar: { flexGrow: 0, marginHorizontal: -SPACING.md },
  chips: { gap: SPACING.xs, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  chip: {
    height: 36,
    paddingHorizontal: SPACING.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...TEXT.subhead, fontFamily: FONT.medium },
  readonlyField: { minHeight: 52, borderRadius: radius.md, paddingHorizontal: SPACING.md, justifyContent: 'center', paddingVertical: SPACING.xs },
  readonlyLabel: { ...TEXT.caption, fontFamily: FONT.medium },
  readonlyValue: { ...TEXT.body },
});


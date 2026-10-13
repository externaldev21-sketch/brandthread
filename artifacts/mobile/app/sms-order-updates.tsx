/**
 * Settings → Notifications → Text messages. Opt-in SMS order updates
 * (shipped, out for delivery, delivered, refunds).
 *
 * Flow copied from Taco Bell's "Order updates → Text" opt-in
 * (https://mobbin.com/flows/cf13d84a-3c02-4192-8c2c-8278749026a7): enter the
 * mobile number with the consent disclosure above the button → confirm the
 * one-time code texted to it → "You're in" confirmation, after which the
 * switch reads on with the number beneath it.
 *
 * Only reachable when the server reports `available` (Twilio configured).
 * Signed-out web preview never calls the API unless `&demo=1`.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card, ListRow } from '@/components/ui';
import { SuccessSheet } from '@/components/ui/SuccessSheet';
import { SecurityBody, SecurityErrorBox, SecurityField, SecurityIntro } from '@/components/security/SecurityFormKit';
import { useApi, type SmsOrderUpdatesState } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { apiErrorMessage } from '@/lib/safety';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { formatSmsPhone, maskSmsPhone, SMS_ON_DISCLOSURE, SMS_OPT_IN_DISCLOSURE } from '@/lib/smsOrderUpdates';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

type Step = 'phone' | 'code';

export default function SmsOrderUpdatesScreen() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  const { user } = useUser();
  const previewBlocked = (isBuyerDevPreview() || isSellerDevPreview()) && !isPreviewDemoMode();

  const [state, setState] = useState<SmsOrderUpdatesState | null>(null);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (previewBlocked) return;
    api.notificationPrefs.sms.get()
      .then((s) => {
        setState(s);
        setPhone((current) => current || s.phone || user?.primaryPhoneNumber?.phoneNumber || '');
      })
      .catch(() => setState({ available: false, phone: null, enabled: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendCode(isResend = false) {
    if (busy || previewBlocked) return;
    setBusy(true);
    setError('');
    setResent(false);
    try {
      const result = await api.notificationPrefs.sms.update({ enabled: true, phone: isResend && codeSentTo ? codeSentTo : phone });
      if (result.codeSentTo) {
        setCodeSentTo(result.codeSentTo);
        setStep('code');
        setCode('');
        if (isResend) setResent(true);
      } else {
        // A number this account already confirmed turns straight back on.
        setState(result);
        if (result.enabled) setSuccess(true);
      }
    } catch (e) {
      setError(apiErrorMessage(e, "We couldn't text that number. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || code.length < 6 || previewBlocked) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.notificationPrefs.sms.verify(code);
      setState(result);
      setStep('phone');
      setConsent(false);
      setSuccess(true);
    } catch (e) {
      setError(apiErrorMessage(e, "We couldn't check that code. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (busy || previewBlocked) return;
    hapticToggle();
    setBusy(true);
    setError('');
    try {
      setState(await api.notificationPrefs.sms.update({ enabled: false }));
    } catch (e) {
      setError(apiErrorMessage(e, "We couldn't turn off texts. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const legalLink = (label: string, route: string) => (
    <Text
      style={[s.link, { color: colors.foreground }]}
      onPress={() => router.push(route as never)}
      accessibilityRole="link"
      suppressHighlighting
    >
      {label}
    </Text>
  );

  let body: React.ReactNode = null;
  if (state?.available && state.enabled) {
    body = (
      <SecurityBody>
        <Card style={s.card}>
          <ListRow
            testID="sms-on-row"
            icon="message-square"
            title="Order updates"
            subtitle={formatSmsPhone(state.phone)}
            subtitleNumberOfLines={1}
            toggle={{ value: true, onChange: (next) => { if (!next) void turnOff(); } }}
          />
        </Card>
        <Text style={[s.disclosure, { color: colors.mutedForeground }]}>{SMS_ON_DISCLOSURE}</Text>
        <SecurityErrorBox message={error} testID="sms-error" />
        <Button label="Turn off" variant="secondary" onPress={turnOff} loading={busy} fullWidth style={s.cta} testID="sms-turn-off" />
      </SecurityBody>
    );
  } else if (state?.available && step === 'code') {
    body = (
      <SecurityBody>
        <SecurityIntro>We texted a code to {maskSmsPhone(codeSentTo)}.</SecurityIntro>
        <SecurityField
          testID="sms-code-input"
          label="Code"
          value={code}
          onChangeText={(v) => { setCode(v.replace(/\D/g, '')); setError(''); }}
          placeholder="6-digit code"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={verify}
        />
        <SecurityErrorBox message={error} testID="sms-error" />
        {resent ? <Text style={[s.disclosure, { color: colors.mutedForeground }]}>New code sent.</Text> : null}
        <Button label="Confirm" onPress={verify} loading={busy} disabled={code.length < 6} fullWidth style={s.cta} testID="sms-confirm" />
        <Button label="Send a new code" variant="tertiary" size="small" onPress={() => sendCode(true)} disabled={busy} style={{ marginTop: SPACING.sm }} />
        <Button label="Use a different number" variant="tertiary" size="small" onPress={() => { setStep('phone'); setError(''); }} disabled={busy} />
      </SecurityBody>
    );
  } else if (state?.available) {
    body = (
      <SecurityBody>
        <SecurityField
          testID="sms-phone-input"
          label="Mobile number"
          value={phone}
          onChangeText={(v) => { setPhone(v); setError(''); }}
          placeholder="+1 555 123 4567"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="done"
        />
        <Card style={[s.card, { marginTop: SPACING.md }]}>
          <ListRow
            testID="sms-consent-row"
            icon="message-square"
            title="Order updates"
            subtitle="Shipped, out for delivery, delivered, refunds"
            subtitleNumberOfLines={2}
            toggle={{ value: consent, onChange: (next) => { hapticToggle(); setConsent(next); } }}
          />
        </Card>
        <Text style={[s.disclosure, { color: colors.mutedForeground }]}>
          {SMS_OPT_IN_DISCLOSURE} See our {legalLink('Terms', '/terms')} and {legalLink('Privacy Policy', '/privacy')}.
        </Text>
        <SecurityErrorBox message={error} testID="sms-error" />
        <Button
          label="Turn on"
          onPress={() => sendCode(false)}
          loading={busy}
          disabled={!consent || !phone.trim()}
          fullWidth
          style={s.cta}
          testID="sms-turn-on"
        />
      </SecurityBody>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Text messages" divider={false} onBack={() => goBackOr(router, '/notifications-settings')} />
      {body}
      <SuccessSheet
        visible={success}
        onClose={() => setSuccess(false)}
        title="You're in"
        subtitle="We'll text you updates on your next order."
        primaryAction={{ label: 'Done', onPress: () => setSuccess(false) }}
        testID="sms-success"
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { paddingHorizontal: SPACING.md },
  disclosure: { ...TYPE_SCALE.footnote, lineHeight: 18, marginTop: SPACING.md },
  link: { textDecorationLine: 'underline' },
  cta: { marginTop: SPACING.lg },
});

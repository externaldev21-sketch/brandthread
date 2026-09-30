/**
 * Delete account (App Store guideline 5.1.1(v)) — fully in-app for buyer and
 * seller accounts.
 *
 * 1. Overview: explains exactly what is deleted and what the law requires us
 *    to keep, and lists anything that must be settled first (open orders,
 *    held drop funds, disputes, payouts in flight…) with a shortcut to fix it.
 * 2. Confirm: type DELETE, acknowledge, and re-authenticate (password, or an
 *    emailed code for accounts that sign in without one).
 * 3. Done: the account is hidden and scheduled for deletion in 30 days, every
 *    session is signed out, and signing back in within 30 days restores it.
 *    The hard delete runs server-side after the grace period.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TextInput, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { clearAccountLifecycleState } from '@/lib/accountService';
import { PressableScale, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { apiErrorCode, apiErrorDetails, apiErrorMessage } from '@/lib/safety';
import { formatScheduledDate } from '@/components/account/AccountDeletionGate';
import type { AccountDeletionCheck, DeletionBlocker } from '@/lib/safetyTypes';

type Step = 'overview' | 'confirm' | 'done';
const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const api = useApi();
  const { signOut } = useAuth();

  const [step, setStep] = useState<Step>('overview');
  const [check, setCheck] = useState<AccountDeletionCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const loadCheck = useCallback(async () => {
    setLoading(true);
    setCheckError(null);
    try {
      setCheck(await api.auth.deletionCheck());
    } catch (err) {
      setCheckError(apiErrorMessage(err, 'We couldn’t check your account right now. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => {
    if (step === 'overview') loadCheck();
  }, [loadCheck, step]));

  const isSeller = check?.accountType === 'seller';
  const blockers = check?.blockers ?? [];
  const canContinue = !!check && check.canDelete;
  const graceDays = check?.graceDays ?? 30;
  const usesCode = check?.reauth === 'email_code';
  const reauthFilled = usesCode ? /^\d{6}$/.test(code.trim()) : password.length > 0;
  const confirmValid = typed.trim() === CONFIRM_WORD && acknowledged && reauthFilled;

  async function sendCode() {
    if (sendingCode) return;
    setSendingCode(true);
    setDeleteError(null);
    try {
      await api.auth.requestDeletionCode();
      setCodeSent(true);
    } catch (err) {
      setDeleteError(apiErrorMessage(err, 'We couldn’t send the code. Try again in a moment.'));
    } finally {
      setSendingCode(false);
    }
  }

  async function deleteNow() {
    if (!confirmValid || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await api.auth.deleteAccount(usesCode ? { code: code.trim() } : { password });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await clearAccountLifecycleState().catch(() => {});
      setScheduledFor(result.scheduledFor);
      setStep('done');
      // Every session was revoked server-side; clear the local one too.
      signOut().catch(() => {});
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (apiErrorCode(err) === 'DELETION_BLOCKED') {
        const details = apiErrorDetails<{ blockers?: DeletionBlocker[] }>(err);
        setCheck((prev) => prev ? { ...prev, canDelete: false, blockers: details?.blockers ?? prev.blockers } : prev);
        setStep('overview');
        setTyped('');
        setAcknowledged(false);
      } else {
        setDeleteError(apiErrorMessage(err, 'We couldn’t schedule your account deletion. Please try again or contact support@brandthread.app.'));
      }
    } finally {
      setDeleting(false);
    }
  }

  function goBack() {
    if (step === 'confirm') { setStep('overview'); return; }
    goBackOr(router, '/settings' as never);
  }

  if (step === 'done') {
    return (
      <View style={[s.root, { paddingTop: headerTopInset + SP.xxl, paddingBottom: insets.bottom + SP.lg }]}>
        <View style={s.doneBody}>
          <View style={s.doneIcon}><Feather name="check" size={30} color={theme.onAccent} /></View>
          <Text style={s.title}>Your account is scheduled for deletion</Text>
          <Text style={s.lead}>
            {`Your profile is now hidden and you’ve been signed out on every device. Your account and personal data will be permanently deleted on ${formatScheduledDate(scheduledFor)}. Sign back in before then if you change your mind.`}
          </Text>
        </View>
        <View style={{ paddingHorizontal: SP.md }}>
          <PrimaryButton label="Done" onPress={() => router.replace('/sign-in' as never)} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Delete account" onBack={goBack} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }} keyboardShouldPersistTaps="handled">
        {step === 'overview' ? (
          <>
            <View style={s.heroIcon}><Feather name="trash-2" size={24} color={theme.error} /></View>
            <Text style={s.title}>Delete your Brandthread account</Text>
            <Text style={s.lead}>
              {`Your account${isSeller ? ' and storefront are' : ' is'} hidden right away and permanently deleted after ${graceDays} days. Sign back in any time during those ${graceDays} days to restore it. After that it can’t be recovered.`}
            </Text>

            {loading ? (
              <View style={s.loadingCard}>
                <ActivityIndicator color={theme.text} />
                <Text style={s.loadingText}>Checking your account…</Text>
              </View>
            ) : checkError ? (
              <View style={s.errorCard}>
                <Feather name="wifi-off" size={16} color={theme.error} />
                <Text style={s.errorText}>{checkError}</Text>
                <PressableScale onPress={loadCheck} accessibilityRole="button"><Text style={s.link}>Retry</Text></PressableScale>
              </View>
            ) : blockers.length > 0 ? (
              <View style={s.blockerCard}>
                <View style={s.blockerHeader}>
                  <Feather name="alert-triangle" size={16} color={theme.warning} />
                  <Text style={s.blockerHeading}>Settle these first</Text>
                </View>
                <Text style={s.blockerIntro}>
                  {isSeller
                    ? 'To protect your buyers and the money held for them, deletion is paused until every order and payment below is settled.'
                    : 'To make sure nobody is left waiting on you, finish these before deleting.'}
                </Text>
                {blockers.map((blocker) => (
                  <View key={blocker.code} style={s.blockerRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.blockerTitle}>{blocker.title}</Text>
                      <Text style={s.blockerDetail}>{blocker.detail}</Text>
                    </View>
                    <PressableScale
                      onPress={() => router.push(blocker.actionRoute as never)}
                      style={s.blockerBtn}
                      accessibilityRole="button"
                      accessibilityLabel={blocker.actionLabel}
                    >
                      <Text style={s.blockerBtnText}>{blocker.actionLabel}</Text>
                    </PressableScale>
                  </View>
                ))}
                <PressableScale onPress={loadCheck} style={s.recheck} accessibilityRole="button">
                  <Feather name="refresh-cw" size={14} color={theme.text} />
                  <Text style={s.recheckText}>Check again</Text>
                </PressableScale>
              </View>
            ) : (
              <View style={s.readyCard}>
                <Feather name="check-circle" size={16} color={theme.success} />
                <Text style={s.readyText}>Nothing is holding up deletion.</Text>
              </View>
            )}

            {check ? (
              <>
                <Text style={s.sectionLabel}>WHAT WE DELETE</Text>
                <View style={s.listCard}>
                  {check.willDelete.map((line) => (
                    <View key={line} style={s.listRow}>
                      <Feather name="x" size={14} color={theme.muted} style={{ marginTop: 3 }} />
                      <Text style={s.listText}>{line}</Text>
                    </View>
                  ))}
                </View>

                <Text style={s.sectionLabel}>WHAT WE KEEP</Text>
                <View style={s.listCard}>
                  {check.willRetain.map((line) => (
                    <View key={line} style={s.listRow}>
                      <Feather name="archive" size={14} color={theme.muted} style={{ marginTop: 3 }} />
                      <Text style={s.listText}>{line}</Text>
                    </View>
                  ))}
                </View>
                {isSeller ? (
                  <Text style={s.footnote}>
                    Payouts already sent to your bank aren’t affected. Any balance in your Stripe account stays with Stripe under your Stripe agreement.
                  </Text>
                ) : null}
              </>
            ) : null}

            <PressableScale
              onPress={() => router.push((isSeller ? '/seller-data-export' : '/buyer-download-data') as never)}
              style={s.exportRow}
              accessibilityRole="button"
            >
              <Feather name="download" size={16} color={theme.text} />
              <Text style={s.exportText}>Download a copy of your data first</Text>
              <Feather name="chevron-right" size={16} color={theme.subtle} />
            </PressableScale>

            <PrimaryButton
              label="Continue"
              onPress={() => { setStep('confirm'); setDeleteError(null); }}
              disabled={!canContinue}
              style={{ marginTop: SP.lg }}
            />
            <SecondaryButton label="Keep my account" onPress={goBack} accent={theme.text} style={{ marginTop: SP.sm }} />
          </>
        ) : (
          <>
            <View style={s.heroIcon}><Feather name="alert-octagon" size={24} color={theme.error} /></View>
            <Text style={s.title}>Are you absolutely sure?</Text>
            <Text style={s.lead}>
              {`Your account will be hidden now and you’ll be signed out on every device. It is permanently deleted after ${graceDays} days, unless you sign back in to restore it.`}
            </Text>

            <Text style={s.fieldLabel}>Type <Text style={{ color: theme.text, fontFamily: FONT.bold }}>{CONFIRM_WORD}</Text> to confirm</Text>
            <TextInput
              style={[s.input, typed.trim() === CONFIRM_WORD && { borderColor: theme.error }]}
              value={typed}
              onChangeText={setTyped}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={theme.subtle}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Type DELETE to confirm"
            />

            {usesCode ? (
              <>
                <Text style={s.fieldLabel}>Enter the 6-digit code we email you</Text>
                <TextInput
                  style={s.input}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={theme.subtle}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  accessibilityLabel="Email verification code"
                />
                <PressableScale onPress={sendCode} disabled={sendingCode} style={s.codeLink} accessibilityRole="button">
                  {sendingCode
                    ? <ActivityIndicator color={theme.text} />
                    : <Text style={s.link}>{codeSent ? 'Send a new code' : 'Email me a code'}</Text>}
                </PressableScale>
              </>
            ) : (
              <>
                <Text style={s.fieldLabel}>Enter your password to confirm it’s you</Text>
                <TextInput
                  style={[s.input, s.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={theme.subtle}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="current-password"
                  textContentType="password"
                  accessibilityLabel="Password"
                />
              </>
            )}

            <PressableScale
              onPress={() => { Haptics.selectionAsync(); setAcknowledged((v) => !v); }}
              style={s.ackRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
            >
              <View style={[s.checkbox, acknowledged && s.checkboxOn]}>
                {acknowledged ? <Feather name="check" size={14} color={theme.onAccent} /> : null}
              </View>
              <Text style={s.ackText}>
                I understand my {isSeller ? 'storefront, listings, ' : ''}profile, posts, comments and messages will be permanently deleted after {graceDays} days.
              </Text>
            </PressableScale>

            {deleteError ? (
              <View style={s.errorCard}>
                <Feather name="alert-circle" size={16} color={theme.error} />
                <Text style={s.errorText}>{deleteError}</Text>
              </View>
            ) : null}

            <PressableScale
              onPress={deleteNow}
              disabled={!confirmValid || deleting}
              style={[s.deleteBtn, (!confirmValid || deleting) && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
            >
              {deleting
                ? <ActivityIndicator color={theme.onAccent} />
                : <Text style={s.deleteText}>Delete account</Text>}
            </PressableScale>
            <SecondaryButton label="Cancel" onPress={goBack} accent={theme.text} style={{ marginTop: SP.sm }} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.error + '55', marginTop: SP.md, marginBottom: SP.md,
  },
  title: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.6 },
  lead: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 23, marginTop: SP.sm },
  loadingCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.lg, padding: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  loadingText: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md, padding: SP.md,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.error + '55', backgroundColor: theme.card,
  },
  errorText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19 },
  link: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  blockerCard: {
    marginTop: SP.lg, padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: theme.warning + '55', backgroundColor: theme.card, gap: SP.sm,
  },
  blockerHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  blockerHeading: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.base },
  blockerIntro: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  blockerRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingTop: SP.sm,
    borderTopWidth: 1, borderTopColor: theme.borderSubtle,
  },
  blockerTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  blockerDetail: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, lineHeight: 17, marginTop: 2 },
  blockerBtn: {
    paddingHorizontal: 12, height: 34, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
  },
  blockerBtnText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.xs },
  recheck: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: SP.sm },
  recheckText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  readyCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.lg, padding: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  readyText: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm },
  sectionLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1, marginTop: SP.lg, marginBottom: SP.sm },
  listCard: { padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, gap: 10 },
  listRow: { flexDirection: 'row', gap: SP.sm },
  listText: { flex: 1, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  footnote: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17, marginTop: SP.sm },
  exportRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.lg, padding: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  exportText: { flex: 1, color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  fieldLabel: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.sm, marginTop: SP.xl, marginBottom: SP.sm },
  input: {
    height: 54, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
    color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: 2, paddingHorizontal: SP.md,
  },
  passwordInput: { fontFamily: FONT.medium, fontSize: FS.base, letterSpacing: 0 },
  codeLink: { alignSelf: 'flex-start', marginTop: SP.sm, minHeight: 28, justifyContent: 'center' },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, marginTop: SP.lg },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.muted,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  ackText: { flex: 1, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  deleteBtn: {
    height: 54, borderRadius: RADIUS.md, backgroundColor: theme.error, marginTop: SP.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.base },
  doneBody: { flex: 1, paddingHorizontal: SP.lg, alignItems: 'center' },
  doneIcon: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: theme.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg,
  },
});

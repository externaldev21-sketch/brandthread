import * as Haptics from 'expo-haptics';
import { MEDIA } from '@/lib/theme';
/**
 * Delete account (App Store guideline 5.1.1(v)) — fully in-app for buyer and
 * seller accounts.
 *
 * 1. Overview: explains exactly what is deleted and what the law requires us
 *    to keep, and lists anything that must be settled first (open orders,
 *    held drop funds, disputes, payouts in flight…) with a shortcut to fix it.
 * 2. Confirm: type DELETE, acknowledge, and re-authenticate: password, or for
 *    accounts without one (Apple / Google) Sign in with Apple on iPhone, a
 *    fresh sign-in, or an emailed code (QA-0074). A store-billed plan shows how
 *    to cancel it in the store, since deletion cannot (QA-0073).
 * 3. Done: the account is hidden and scheduled for deletion in 30 days, every
 *    session is signed out, and signing back in within 30 days cancels it.
 *    The hard delete runs server-side after the grace period.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TextInput, StyleSheet, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { haptics } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS, FILL_ELEVATED, TEXT_DISABLED } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { clearAccountLifecycleState } from '@/lib/accountService';
import { PressableScale, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';
import { apiErrorCode, apiErrorDetails, apiErrorMessage } from '@/lib/safety';
import type { AccountDeletionCheck, DeletionBlocker } from '@/lib/safetyTypes';
import { radius } from '@/constants/radii';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  DELETE_ACCOUNT_REAUTH_ROUTE, deletionReauthPlan, deletionReauthSatisfied,
} from '@/lib/deletionReauth';
import { storeSubscriptionsUrl } from '@/lib/currentPlan';
import { isOAuthCancellationError } from '@/lib/oauthFlow';
import { ListRow } from '@/components/ui';
import { useLinkedProfiles } from '@/hooks/useLinkedProfiles';

type Step = 'overview' | 'confirm' | 'done';

function formatScheduledDate(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return 'in 30 days';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const tabBarInset = useSellerTabBarInset();
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
  const passwordRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [appleProof, setAppleProof] = useState<{ identityToken: string; authorizationCode: string | null } | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);
  // One login can hold a buyer and a seller profile. Deleting this profile
  // keeps the other one; "Delete login" deletes both.
  const linked = useLinkedProfiles();
  const thisProfile = linked.data?.profiles.find((p) => p.isCurrent) ?? null;
  const otherProfiles = (linked.data?.profiles ?? []).filter((p) => !p.isCurrent && !p.pendingDeletion);
  const hasOther = otherProfiles.length > 0;
  const [scope, setScope] = useState<'profile' | 'login'>('profile');
  const handleOf = (p: { username: string | null; displayName: string | null } | null | undefined, fallback: string) =>
    p?.username ? `@${p.username}` : (p?.displayName || fallback);
  const thisHandle = handleOf(thisProfile, 'this profile');
  const otherHandle = handleOf(otherProfiles[0], otherProfiles[0]?.role === 'seller' ? 'your store' : 'your buyer profile');
  const keepsOther = hasOther && scope === 'profile';

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
  const reauthPlan = deletionReauthPlan({ reauth: check?.reauth, reauthOptions: check?.reauthOptions, os: Platform.OS });
  const usesCode = reauthPlan.mode === 'sso';
  const reauthFilled = deletionReauthSatisfied(reauthPlan, { password, code, appleIdentityToken: appleProof?.identityToken ?? null });
  const storeManageUrl = storeSubscriptionsUrl(Platform.OS);
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

  async function confirmWithApple() {
    if (appleBusy) return;
    setAppleBusy(true);
    setDeleteError(null);
    try {
      // Fresh Sign in with Apple on this iPhone. The server checks Apple's
      // signature and that it is the Apple ID on this account, and uses the
      // one-time code to revoke our Apple tokens (App Store 5.1.1(v)).
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      if (!credential.identityToken) throw new Error('Apple did not return a sign-in token.');
      setAppleProof({ identityToken: credential.identityToken, authorizationCode: credential.authorizationCode ?? null });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      if (!isOAuthCancellationError(err) && (err as { code?: string })?.code !== 'ERR_REQUEST_CANCELED') {
        setDeleteError('We couldn’t confirm it’s you with Apple. Try again.');
      }
    } finally {
      setAppleBusy(false);
    }
  }

  async function signInAgain() {
    // A fresh sign-in counts as confirmation for 10 minutes; sign-in brings
    // the person straight back here.
    await signOut().catch(() => {});
    router.replace(DELETE_ACCOUNT_REAUTH_ROUTE as never);
  }

  async function deleteNow() {
    if (!confirmValid || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const reauth = !usesCode ? { password }
          : appleProof ? { appleIdentityToken: appleProof.identityToken, appleAuthorizationCode: appleProof.authorizationCode ?? undefined }
            : code.trim() ? { code: code.trim() }
              : {};
      const result = scope === 'login' && hasOther
        ? await api.accounts.deleteLogin(reauth)
        : await api.auth.deleteAccount(reauth);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScheduledFor(result.scheduledFor);
      setStep('done');
      if (!keepsOther) {
        await clearAccountLifecycleState().catch(() => {});
        // Every session was revoked server-side; clear the local one too.
        signOut().catch(() => {});
      }
    } catch (err) {
      haptics.error();
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
          <View style={s.doneIcon}><Icon name="check" size={30} color={theme.onAccent} /></View>
          <Text style={s.title}>{keepsOther ? `${thisHandle} is scheduled for deletion` : 'Your account is scheduled for deletion'}</Text>
          <Text style={s.lead}>
            {keepsOther
              ? `${thisHandle} is hidden now and will be permanently deleted on ${formatScheduledDate(scheduledFor)}. ${otherHandle} keeps working with your login.`
              : `Your account is hidden and you’ve been signed out on every device. It will be permanently deleted on ${formatScheduledDate(scheduledFor)}. Sign back in before then to cancel.`}
          </Text>
        </View>
        <View style={{ paddingHorizontal: SP.md }}>
          <PrimaryButton
            label={keepsOther ? `Go to ${otherHandle}` : 'Done'}
            onPress={() => {
              if (keepsOther && otherProfiles[0]) {
                linked.switchTo(otherProfiles[0].clerkId).catch(() => router.replace('/sign-in' as never));
              } else {
                router.replace('/sign-in' as never);
              }
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Delete account" onBack={goBack} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl + tabBarInset }} keyboardShouldPersistTaps="handled">
        {step === 'overview' ? (
          <>
            <View style={s.heroIcon}><Icon name="trash-2" size={24} color={theme.error} /></View>
            <Text style={s.title}>Delete your Brandthread account</Text>
            <Text style={s.lead}>
              {`Your account${isSeller ? ' and storefront are' : ' is'} hidden right away and permanently deleted after ${graceDays} days. Sign back in before then to cancel.`}
            </Text>

            {hasOther ? (
              <View style={s.scopeList} accessibilityRole="radiogroup">
                <ListRow
                  title={`Delete ${thisHandle} only`}
                  subtitle={`${otherHandle} keeps working with your login.`}
                  subtitleNumberOfLines={2}
                  onPress={() => setScope('profile')}
                  right={scope === 'profile' ? <Feather name="check" size={20} color={theme.text} /> : undefined}
                  divider
                  testID="delete-scope-profile"
                />
                <ListRow
                  title="Delete login"
                  subtitle={`Deletes ${thisHandle}, ${otherHandle} and the login they share.`}
                  subtitleNumberOfLines={2}
                  onPress={() => setScope('login')}
                  right={scope === 'login' ? <Feather name="check" size={20} color={theme.text} /> : undefined}
                  testID="delete-scope-login"
                />
              </View>
            ) : null}

            {check?.deletionCancelledAt ? (
              <View style={s.readyCard}>
                <Icon name="check-circle" size={16} color={theme.success} />
                <Text style={s.readyText}>Deletion cancelled. You signed back in, so your account is active.</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={s.loadingCard}>
                <ActivityIndicator color={theme.text} />
                <Text style={s.loadingText}>Checking your account…</Text>
              </View>
            ) : checkError ? (
              <View style={s.errorCard}>
                <Icon name="wifi-off" size={16} color={theme.error} />
                <Text style={s.errorText}>{checkError}</Text>
                <PressableScale onPress={loadCheck} accessibilityRole="button"><Text style={s.link}>Retry</Text></PressableScale>
                {/* Never a dead end: if the check can't run, support deletes it for you. */}
                <PressableScale
                  onPress={() => { Linking.openURL('mailto:support@brandthread.app?subject=Delete%20my%20Brandthread%20account').catch(() => {}); }}
                  accessibilityRole="link"
                >
                  <Text style={s.link}>Email support to delete</Text>
                </PressableScale>
              </View>
            ) : blockers.length > 0 ? (
              <View style={s.blockerCard}>
                <View style={s.blockerHeader}>
                  <Icon name="alert-triangle" size={16} color={theme.warning} />
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
                  <Icon name="refresh-cw" size={14} color={theme.text} />
                  <Text style={s.recheckText}>Check again</Text>
                </PressableScale>
              </View>
            ) : (
              <View style={s.readyCard}>
                <Icon name="check-circle" size={16} color={theme.success} />
                <Text style={s.readyText}>Nothing is holding up deletion.</Text>
              </View>
            )}

            {check?.subscriptionNotice ? (
              <View style={s.blockerCard}>
                <View style={s.blockerHeader}>
                  <Icon name="credit-card" size={16} color={theme.text} />
                  <Text style={s.blockerHeading}>{check.subscriptionNotice.title}</Text>
                </View>
                <Text style={s.blockerIntro}>{check.subscriptionNotice.detail}</Text>
                {storeManageUrl ? (
                  <PressableScale
                    onPress={() => { void Linking.openURL(storeManageUrl); }}
                    style={[s.blockerBtn, { alignSelf: 'flex-start' }]}
                    accessibilityRole="link"
                    accessibilityLabel="Manage subscription"
                  >
                    <Text style={s.blockerBtnText}>Manage subscription</Text>
                  </PressableScale>
                ) : null}
              </View>
            ) : null}

            {check ? (
              <>
                <Text style={s.sectionLabel}>WHAT WE DELETE</Text>
                <View style={s.listCard}>
                  {check.willDelete.map((line) => (
                    <View key={line} style={s.listRow}>
                      <Icon name="x" size={14} color={theme.muted} style={{ marginTop: 3 }} />
                      <Text style={s.listText}>{line}</Text>
                    </View>
                  ))}
                </View>

                <Text style={s.sectionLabel}>WHAT WE KEEP</Text>
                <View style={s.listCard}>
                  {check.willRetain.map((line) => (
                    <View key={line} style={s.listRow}>
                      <Icon name="archive" size={14} color={theme.muted} style={{ marginTop: 3 }} />
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
              <Icon name="download" size={16} color={theme.text} />
              <Text style={s.exportText}>Download a copy of your data first</Text>
              <Icon name="chevron-right" size={16} color={theme.subtle} />
            </PressableScale>

            <PrimaryButton
              label="Continue"
              onPress={() => { setStep('confirm'); setDeleteError(null); }}
              disabled={!canContinue}
              // Disabled fill matches the page — outline it so it still reads
              // as a full-width button (audit QA-1025), not floating text.
              style={[{ marginTop: SP.lg }, !canContinue && { borderWidth: 1, borderColor: theme.border }]}
            />
            <SecondaryButton label="Keep my account" onPress={goBack} accent={theme.text} style={{ marginTop: SP.sm }} />
          </>
        ) : (
          <>
            <View style={s.heroIcon}><Icon name="alert-octagon" size={24} color={theme.error} /></View>
            <Text style={s.title}>Are you absolutely sure?</Text>
            <Text style={s.lead}>
              {keepsOther
                ? `${thisHandle} will be hidden now and permanently deleted after ${graceDays} days. ${otherHandle} keeps working.`
                : scope === 'login' && hasOther
                  ? `${thisHandle}, ${otherHandle} and your login will be hidden now and permanently deleted after ${graceDays} days. Signing back in before then cancels it.`
                  : `Your account will be hidden now and permanently deleted after ${graceDays} days. Signing back in before then cancels it.`}
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
              autoComplete="off"
              returnKeyType={usesCode ? 'done' : 'next'}
              blurOnSubmit={usesCode}
              onSubmitEditing={usesCode ? undefined : () => passwordRef.current?.focus()}
              accessibilityLabel="Type DELETE to confirm"
            />

            {usesCode && reauthPlan.alreadyConfirmed ? (
              <View style={s.readyCard}>
                <Icon name="check-circle" size={16} color={theme.success} />
                <Text style={s.readyText}>You just signed in, so it’s confirmed it’s you.</Text>
              </View>
            ) : usesCode ? (
              <>
                <Text style={s.fieldLabel}>Confirm it’s you</Text>
                {appleProof ? (
                  <View style={s.readyCard}>
                    <Icon name="check-circle" size={16} color={theme.success} />
                    <Text style={s.readyText}>Confirmed with Apple.</Text>
                  </View>
                ) : reauthPlan.showApple ? (
                  <PressableScale
                    onPress={confirmWithApple}
                    disabled={appleBusy}
                    style={s.appleBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Apple"
                  >
                    {appleBusy
                      ? <ActivityIndicator color={MEDIA.foreground} />
                      : (
                        <>
                          <Ionicons name="logo-apple" size={20} color={MEDIA.foreground} />
                          <Text style={s.appleBtnText}>Continue with Apple</Text>
                        </>
                      )}
                  </PressableScale>
                ) : null}
                {!appleProof && reauthPlan.showSignInAgain ? (
                  <PressableScale onPress={signInAgain} style={s.codeLink} accessibilityRole="button">
                    <Text style={s.link}>Sign in again</Text>
                  </PressableScale>
                ) : null}
              </>
            ) : null}

            {usesCode && !reauthPlan.alreadyConfirmed && !appleProof && reauthPlan.showEmailCode ? (
              <>
                <Text style={s.fieldLabel}>Or enter the 6-digit code we email you</Text>
                <TextInput returnKeyType="done"
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
            ) : usesCode ? null : (
              <>
                <Text style={s.fieldLabel}>Enter your password to confirm it’s you</Text>
                <TextInput
                  ref={passwordRef}
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
                  returnKeyType="done"
                  accessibilityLabel="Password"
                />
              </>
            )}

            <PressableScale
              onPress={() => { haptics.selection(); setAcknowledged((v) => !v); }}
              style={s.ackRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
            >
              <View style={[s.checkbox, acknowledged && s.checkboxOn]}>
                {acknowledged ? <Icon name="check" size={14} color={theme.onAccent} /> : null}
              </View>
              <Text style={s.ackText}>
                I understand my {isSeller ? 'storefront, listings, ' : ''}profile, posts, comments and messages will be permanently deleted after {graceDays} days.
              </Text>
            </PressableScale>

            {deleteError ? (
              <View style={s.errorCard}>
                <Icon name="alert-circle" size={16} color={theme.error} />
                <Text style={s.errorText}>{deleteError}</Text>
              </View>
            ) : null}

            <PressableScale
              onPress={deleteNow}
              disabled={!confirmValid || deleting}
              style={[s.deleteBtn, (!confirmValid || deleting) && { backgroundColor: FILL_ELEVATED }]}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
            >
              {deleting
                ? <ActivityIndicator color={TEXT_DISABLED} />
                : <Text style={[s.deleteText, !confirmValid && { color: TEXT_DISABLED }]}>Delete account</Text>}
            </PressableScale>
            <SecondaryButton label="Cancel" onPress={goBack} accent={theme.text} style={{ marginTop: SP.sm }} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
    scopeList: { marginTop: SP.lg },
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
    paddingHorizontal: 12, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.border,
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
  sectionLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, marginTop: SP.lg, marginBottom: SP.sm },
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
    color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg, paddingHorizontal: SP.md,
  },
  passwordInput: { fontFamily: FONT.medium, fontSize: FS.base, letterSpacing: 0 },
  codeLink: { alignSelf: 'flex-start', marginTop: SP.sm, minHeight: 28, justifyContent: 'center' },
  // Sign in with Apple button per Apple HIG: solid black, white logo + label.
  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    minHeight: 50, borderRadius: RADIUS.lg, backgroundColor: MEDIA.background,
    borderWidth: 1, borderColor: theme.border,
  },
  appleBtnText: { color: MEDIA.foreground, fontFamily: FONT.semibold, fontSize: FS.base },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, marginTop: SP.lg },
  checkbox: {
    width: 22, height: 22, borderRadius: 8, borderWidth: 1.5, borderColor: theme.muted,
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

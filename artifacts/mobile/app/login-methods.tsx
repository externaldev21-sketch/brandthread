/**
 * Brandthread — Login Methods
 * Shows all connected sign-in methods for the current account.
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import QRCode from 'react-native-qrcode-svg';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, SUCCESS, SUCCESS_DIM, CARD_ELEVATED, RED, RED_DIM,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { Header } from '@/components/layout';

WebBrowser.maybeCompleteAuthSession();

type MethodRow = {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  connected: boolean;
};

type OAuthProvider = 'google' | 'apple';

export default function LoginMethods() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoaded } = useUser();
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [totpModal, setTotpModal] = useState<{ secret: string; uri: string; backupCodes: string[] } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [removingProvider, setRemovingProvider] = useState<OAuthProvider | null>(null);
  const [passwordSetupOpen, setPasswordSetupOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSetupError, setPasswordSetupError] = useState('');
  const [passwordSetupSaving, setPasswordSetupSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const externalAccounts = user?.externalAccounts ?? [];
  const hasGoogle  = externalAccounts.some(a => a.provider === 'google');
  const hasApple   = externalAccounts.some(a => a.provider === 'apple');
  const hasPassword = user?.passwordEnabled ?? false;
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const twoFactorEnabled = user?.twoFactorEnabled ?? false;

  const googleAccount = externalAccounts.find(a => a.provider === 'google');
  const appleAccount  = externalAccounts.find(a => a.provider === 'apple');

  const methods: MethodRow[] = [
    {
      id: 'email',
      label: 'Email address',
      sublabel: email || 'No email set',
      icon: <Feather name="mail" size={20} color={email ? FG : SUBTLE} />,
      connected: !!email,
    },
    {
      id: 'password',
      label: 'Password',
      sublabel: hasPassword ? 'Enabled — you can sign in with your password' : 'Not set',
      icon: <Feather name="lock" size={20} color={hasPassword ? FG : SUBTLE} />,
      connected: hasPassword,
    },
    {
      id: 'google',
      label: 'Google',
      sublabel: hasGoogle
        ? (googleAccount?.emailAddress ?? 'Connected')
        : 'Not connected',
      icon: <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: 'Inter_700Bold', fontSize: 12, color: '#FFFFFF', lineHeight: 14 }}>G</Text></View>,
      connected: hasGoogle,
    },
    {
      id: 'apple',
      label: 'Apple',
      sublabel: hasApple
        ? (appleAccount?.emailAddress ?? 'Connected')
        : 'Not connected',
      icon: <Ionicons name="logo-apple" size={20} color={colors.text} />,
      connected: hasApple,
    },
  ];

  function openPasswordSetup() {
    setNewPassword('');
    setConfirmPassword('');
    setPasswordSetupError('');
    setShowPassword(false);
    setPasswordSetupOpen(true);
  }

  function closePasswordSetup() {
    if (passwordSetupSaving) return;
    setPasswordSetupOpen(false);
    setPasswordSetupError('');
  }

  async function savePassword() {
    if (!user || passwordSetupSaving) return;

    if (newPassword.length < 8) {
      setPasswordSetupError('Use at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordSetupError('Passwords do not match.');
      return;
    }

    setPasswordSetupSaving(true);
    setPasswordSetupError('');
    try {
      await user.updatePassword({ newPassword });
      // Clerk updates passwordEnabled asynchronously. Reload before closing so
      // the removal guard can never run against stale account state.
      await user.reload();
      setPasswordSetupOpen(false);
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password added', 'You can now remove a connected account while keeping your password as a sign-in method.');
    } catch (e: any) {
      setPasswordSetupError("Couldn't add your password. Try again.");
    } finally {
      setPasswordSetupSaving(false);
    }
  }

  // ── OAuth linking ────────────────────────────────────────────────────────────
  async function linkOAuth(strategy: 'oauth_google' | 'oauth_apple', provider: string) {
    if (!user) return;
    setLinkingProvider(provider);
    try {
      const redirectUrl = AuthSession.makeRedirectUri({ scheme: 'brandthread' });
      const externalAccount = await user.createExternalAccount({
        strategy,
        redirectUrl,
      });
      const verificationUrl =
        (externalAccount as any).verification?.externalVerificationRedirectURL?.href;
      if (!verificationUrl) {
        Alert.alert('Connection failed', `Couldn't connect ${provider}. Try again.`);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(verificationUrl, redirectUrl);
      if (result.type === 'success') {
        // Reload user so externalAccounts list reflects the newly linked account
        await user.reload();
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // User closed the browser — do nothing
      } else {
        Alert.alert('Connection failed', `Couldn't connect ${provider}. Try again.`);
      }
    } catch (e: any) {
      Alert.alert('Connection failed', `Couldn't connect ${provider}. Try again.`);
    } finally {
      setLinkingProvider(null);
    }
  }

  // ── OAuth unlinking ──────────────────────────────────────────────────────────
  async function removeOAuth(provider: OAuthProvider, externalAccount: (typeof externalAccounts)[number]) {
    if (!user) return;

    const remainingLoginMethods =
      (hasPassword ? 1 : 0) + externalAccounts.filter(account => account.id !== externalAccount.id).length;

    if (remainingLoginMethods === 0) {
      Alert.alert(
        'Keep a login method',
        'This is your only sign-in method. Add a password or connect another account before removing it.',
        [{ text: 'OK' }],
      );
      return;
    }

    const providerLabel = provider === 'google' ? 'Google' : 'Apple';
    Alert.alert(
      `Remove ${providerLabel}?`,
      `You will no longer be able to sign in with this ${providerLabel} account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingProvider(provider);
            try {
              await externalAccount.destroy();
              await user.reload();
            } catch (e: any) {
              Alert.alert('Removal failed', `Couldn't remove ${providerLabel}. Try again.`);
            } finally {
              setRemovingProvider(null);
            }
          },
        },
      ],
    );
  }

  // ── 2FA helpers ─────────────────────────────────────────────────────────────
  async function handleEnable2FA() {
    if (!user) return;
    setTwoFaLoading(true);
    try {
      const totp = await (user as any).createTOTP();
      setTotpModal({
        secret: totp.secret,
        uri: totp.uri,
        backupCodes: totp.backupCodes ?? [],
      });
    } catch (e: any) {
      Alert.alert("Couldn't start 2FA setup", 'Try again.');
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleVerifyTOTP() {
    if (!user || !verifyCode.trim()) return;
    setVerifying(true);
    try {
      await (user as any).verifyTOTP({ code: verifyCode.trim() });
      setTotpModal(null);
      setVerifyCode('');
      Alert.alert('Two-factor authentication enabled', 'Your account is now protected with 2FA.');
    } catch (e: any) {
      Alert.alert("That code isn't right", 'Try again.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisable2FA() {
    if (!user) return;
    Alert.alert(
      'Disable two-factor authentication?',
      'This will make your account less secure. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: async () => {
            setTwoFaLoading(true);
            try {
              await (user as any).disableTOTP();
              Alert.alert('Two-factor authentication disabled');
            } catch (e: any) {
              Alert.alert("Couldn't turn off 2FA", 'Try again.');
            } finally {
              setTwoFaLoading(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={s.root}>
      <Header title="Login Methods" />

      {!isLoaded ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.desc}>
            The sign-in methods connected to your Brandthread account.
          </Text>

          {/* Methods card */}
          <View style={s.card}>
            {methods.map((method, idx) => {
              const isOAuth = method.id === 'google' || method.id === 'apple';
              const strategy = method.id === 'google' ? 'oauth_google' : 'oauth_apple';
              const isLinking = linkingProvider === method.label;
              const externalAccount = method.id === 'google' ? googleAccount : appleAccount;
              const isRemoving = removingProvider === method.id;
              const isPassword = method.id === 'password';
              const tappable = (isOAuth || isPassword) && !method.connected;

              const rowContent = (
                <View style={s.row}>
                  <View style={[
                    s.iconWrap,
                    method.connected && [s.iconWrapActive, { backgroundColor: colors.accent, borderColor: colors.primary }],
                  ]}>
                    {method.icon}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.methodLabel}>{method.label}</Text>
                    <Text style={s.methodSub} numberOfLines={1}>{method.sublabel}</Text>
                  </View>
                  {method.connected ? (
                    <View style={s.connectedActions}>
                      <View style={s.activeBadge}>
                        <Feather name="check" size={11} color={SUCCESS} />
                        <Text style={s.activeBadgeText}>Active</Text>
                      </View>
                      {isOAuth && externalAccount && (
                        <TouchableOpacity
                          testID={`remove-${method.id}-login-method`}
                          activeOpacity={0.7}
                          disabled={!!linkingProvider || !!removingProvider}
                          onPress={() => removeOAuth(method.id as OAuthProvider, externalAccount)}
                          style={[s.removeBtn, isRemoving && s.removeBtnLoading]}
                        >
                          {isRemoving ? (
                            <ActivityIndicator size="small" color={RED} />
                          ) : (
                            <Text style={s.removeBtnText}>Remove</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : isOAuth || isPassword ? (
                    isLinking ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <View
                        style={[s.enableBtn, { backgroundColor: colors.accent, borderColor: colors.primary }]}
                      >
                        <Text style={[s.enableBtnText, { color: colors.primary }]}>
                          {isPassword ? 'Set up' : 'Connect'}
                        </Text>
                      </View>
                    )
                  ) : (
                    <Text style={s.inactiveBadge}>Not set</Text>
                  )}
                </View>
              );

              return (
                <View key={method.id}>
                  {idx > 0 && <View style={s.divider} />}
                  {tappable ? (
                    <TouchableOpacity
                      testID={isPassword ? 'setup-password-login-method' : `connect-${method.id}-login-method`}
                      activeOpacity={0.7}
                      disabled={!!linkingProvider || !!removingProvider || passwordSetupSaving}
                      onPress={() => {
                        if (isPassword) {
                          openPasswordSetup();
                        } else {
                          linkOAuth(strategy as 'oauth_google' | 'oauth_apple', method.label);
                        }
                      }}
                    >
                      {rowContent}
                    </TouchableOpacity>
                  ) : (
                    rowContent
                  )}
                </View>
              );
            })}
          </View>

          {/* Two-factor authentication section */}
          <Text style={s.sectionLabel}>Two-Factor Authentication</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[
                s.iconWrap,
                twoFactorEnabled && [s.iconWrapActive, { backgroundColor: colors.accent, borderColor: colors.primary }],
              ]}>
                <Feather name="shield" size={20} color={twoFactorEnabled ? colors.primary : SUBTLE} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.methodLabel}>Authenticator app (TOTP)</Text>
                <Text style={s.methodSub}>
                  {twoFactorEnabled ? 'Active — required at every sign-in' : 'Adds a one-time code requirement at sign-in'}
                </Text>
              </View>
              {twoFaLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : twoFactorEnabled ? (
                <TouchableOpacity onPress={handleDisable2FA} style={s.disableBtn}>
                  <Text style={s.disableBtnText}>Disable</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleEnable2FA}
                  style={[s.enableBtn, { backgroundColor: colors.accent, borderColor: colors.primary }]}
                >
                  <Text style={[s.enableBtnText, { color: colors.primary }]}>Enable</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Info note */}
          <View style={s.note}>
            <Feather name="info" size={14} color={MUTED} style={{ marginTop: 1 }} />
            <Text style={s.noteText}>
              Tap <Text style={{ color: FG }}>Connect</Text> on Google or Apple to link
              that account for faster future sign-ins. Your primary email is used for
              account recovery.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Password setup sheet */}
      <Modal
        visible={passwordSetupOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closePasswordSetup}
      >
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Add a password</Text>
            <TouchableOpacity
              onPress={closePasswordSetup}
              style={s.modalClose}
              disabled={passwordSetupSaving}
              testID="close-password-setup"
            >
              <Feather name="x" size={20} color={FG} />
            </TouchableOpacity>
          </View>

          <KeyboardAwareScrollViewCompat
            contentContainerStyle={s.passwordSetupBody}
            bottomOffset={80}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.passwordSetupIntro}>
              Create a password so you can keep signing in if you disconnect your social account.
            </Text>

            <Text style={s.passwordSetupLabel}>New password</Text>
            <View style={s.passwordInputRow}>
              <TextInput
                testID="new-password-input"
                style={s.passwordInput}
                value={newPassword}
                onChangeText={(value) => {
                  setNewPassword(value);
                  setPasswordSetupError('');
                }}
                placeholder="Minimum 8 characters"
                placeholderTextColor={SUBTLE}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword((visible) => !visible)}
                style={s.passwordVisibilityButton}
                testID="toggle-password-visibility"
              >
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={MUTED} />
              </TouchableOpacity>
            </View>

            <Text style={s.passwordSetupLabel}>Confirm password</Text>
            <TextInput
              testID="confirm-password-input"
              style={s.passwordInputStandalone}
              value={confirmPassword}
              onChangeText={(value) => {
                setConfirmPassword(value);
                setPasswordSetupError('');
              }}
              placeholder="Enter it again"
              placeholderTextColor={SUBTLE}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              onSubmitEditing={savePassword}
              returnKeyType="done"
            />

            {passwordSetupError ? (
              <View style={s.passwordErrorBox}>
                <Feather name="alert-circle" size={14} color={RED} />
                <Text testID="password-setup-error" style={s.passwordErrorText}>
                  {passwordSetupError}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              testID="save-password-button"
              style={[
                s.verifyBtn,
                { backgroundColor: colors.primary, opacity: passwordSetupSaving ? 0.6 : 1 },
              ]}
              onPress={savePassword}
              disabled={passwordSetupSaving}
              activeOpacity={0.85}
            >
              {passwordSetupSaving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[s.verifyBtnText, { color: colors.primaryForeground }]}>
                  Add password
                </Text>
              )}
            </TouchableOpacity>
          </KeyboardAwareScrollViewCompat>
        </View>
      </Modal>

      {/* TOTP setup modal */}
      <Modal visible={!!totpModal} animationType="slide" presentationStyle="pageSheet">
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Set up authenticator app</Text>
            <TouchableOpacity onPress={() => { setTotpModal(null); setVerifyCode(''); }} style={s.modalClose}>
              <Feather name="x" size={20} color={FG} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.modalBody}>
            <Text style={s.modalStep}>1. Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)</Text>
            <Text style={s.modalStep}>2. Scan this code with your authenticator app, or enter the key below.</Text>

            {totpModal?.uri ? (
              // theme-exempt: QR codes need black modules on a white background to scan reliably
              <View style={s.qrWrap}>
                <QRCode value={totpModal.uri} size={180} backgroundColor="#FFFFFF" color="#000000" />
              </View>
            ) : null}

            <View style={s.secretBox}>
              <Text style={[s.secretText, { color: colors.primary }]} selectable>{totpModal?.secret}</Text>
            </View>

            <Text style={s.modalStep}>3. Enter the 6-digit code shown in your app:</Text>

            <TextInput
              style={s.codeInput}
              value={verifyCode}
              onChangeText={setVerifyCode}
              placeholder="000000"
              placeholderTextColor={SUBTLE}
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
            />

            {totpModal?.backupCodes && totpModal.backupCodes.length > 0 && (
              <>
                <Text style={s.modalStep}>4. Save these backup codes somewhere safe:</Text>
                <View style={s.backupCodesBox}>
                  {totpModal.backupCodes.map((code, i) => (
                    <Text key={i} style={s.backupCode} selectable>{code}</Text>
                  ))}
                </View>
              </>
            )}

            <TouchableOpacity
              style={[
                s.verifyBtn,
                { backgroundColor: colors.primary, opacity: verifyCode.length < 6 ? 0.5 : 1 },
              ]}
              onPress={handleVerifyTOTP}
              disabled={verifyCode.length < 6 || verifying}
            >
              {verifying ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[s.verifyBtnText, { color: colors.primaryForeground }]}>Verify &amp; enable 2FA</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: 'transparent' },
  header:  {
    height: 56, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  desc: {
    fontSize: FS.sm, fontFamily: FONT.regular,
    color: MUTED, lineHeight: 20, marginBottom: SP.lg,
  },

  sectionLabel: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: SP.sm, marginTop: SP.lg, paddingHorizontal: 2,
  },

  card: {
    backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    marginBottom: SP.lg,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingVertical: 14, gap: 12,
  },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md },

  iconWrap: {
    width: 40, height: 40, borderRadius: RADIUS.sm,
    backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  iconWrapActive: {
  },

  methodLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  methodSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.pill,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  activeBadgeText: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: SUCCESS,
  },
  connectedActions: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  inactiveBadge: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE,
  },

  enableBtn: {
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1,
  },
  enableBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold },

  removeBtn: {
    minWidth: 56, minHeight: 30, alignItems: 'center', justifyContent: 'center',
    backgroundColor: RED_DIM, borderRadius: RADIUS.sm,
    paddingHorizontal: 8, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
  },
  removeBtnLoading: { opacity: 0.7 },
  removeBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: RED },

  disableBtn: {
    backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: RADIUS.sm,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  disableBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: '#EF4444' },

  note: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    paddingHorizontal: SP.sm,
  },
  noteText: {
    flex: 1, fontSize: FS.xs, fontFamily: FONT.regular,
    color: MUTED, lineHeight: 18,
  },

  // TOTP modal
  modal: { flex: 1, backgroundColor: BG },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingTop: SP.xl, paddingBottom: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  modalBody: { paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: 40 },
  modalStep: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
    lineHeight: 22, marginBottom: SP.md,
  },
  modalNote: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED,
    lineHeight: 18, marginBottom: SP.lg,
  },
  qrWrap: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderRadius: RADIUS.sm,
    padding: SP.md, marginBottom: SP.md, alignSelf: 'center',
  },
  secretBox: {
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: SP.sm, marginBottom: SP.md,
    alignItems: 'center',
  },
  secretText: {
    fontSize: FS.base, fontFamily: FONT.semibold,
    letterSpacing: 2,
  },
  codeInput: {
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: 14,
    fontSize: 28, fontFamily: FONT.bold, color: FG,
    letterSpacing: 8, marginBottom: SP.lg,
  },
  backupCodesBox: {
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: SP.sm, marginBottom: SP.lg,
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  backupCode: {
    fontFamily: FONT.regular, fontSize: FS.sm, color: FG,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 3,
  },
  verifyBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: 16, alignItems: 'center',
  },
  verifyBtnText: { fontSize: FS.base, fontFamily: FONT.semibold },

  passwordSetupBody: { paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: 40 },
  passwordSetupIntro: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
    lineHeight: 21, marginBottom: SP.lg,
  },
  passwordSetupLabel: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED,
    marginBottom: 6, marginTop: SP.sm,
  },
  passwordInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: BORDER,
  },
  passwordInput: {
    flex: 1, paddingHorizontal: SP.md, paddingVertical: 14,
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },
  passwordInputStandalone: {
    backgroundColor: CARD, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: 14,
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },
  passwordVisibilityButton: { paddingHorizontal: SP.md, paddingVertical: 12 },
  passwordErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: RED_DIM, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
    paddingHorizontal: SP.sm, paddingVertical: 10, marginTop: SP.md,
  },
  passwordErrorText: {
    flex: 1, fontSize: FS.xs, fontFamily: FONT.regular,
    color: RED, lineHeight: 18,
  },
});

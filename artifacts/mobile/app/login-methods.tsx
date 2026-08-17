/**
 * Brandthread — Login Methods
 * Shows all connected sign-in methods for the current account.
 */
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, TextInput, Modal, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, BORDER_ACTIVE,
  FONT, FS, SP, RADIUS, SUCCESS, SUCCESS_DIM, CARD_ELEVATED,
} from '@/lib/theme';

WebBrowser.maybeCompleteAuthSession();

type MethodRow = {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  connected: boolean;
};

export default function LoginMethods() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoaded } = useUser();
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [totpModal, setTotpModal] = useState<{ secret: string; uri: string; backupCodes: string[] } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);

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
      icon: <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: '#FFFFFF', lineHeight: 22 }}></Text>,
      connected: hasApple,
    },
  ];

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
        Alert.alert('Could not start linking', 'No redirect URL returned from Clerk. Please try again.');
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(verificationUrl, redirectUrl);
      if (result.type === 'success') {
        // Reload user so externalAccounts list reflects the newly linked account
        await user.reload();
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        // User closed the browser — do nothing
      } else {
        Alert.alert(`${provider} linking failed`, 'The browser session did not complete. Please try again.');
      }
    } catch (e: any) {
      const msg = e?.errors?.[0]?.message ?? e?.message ?? 'Please try again.';
      Alert.alert(`Could not link ${provider}`, msg);
    } finally {
      setLinkingProvider(null);
    }
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
      Alert.alert('Could not start 2FA setup', e?.errors?.[0]?.message ?? 'Please try again.');
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
      Alert.alert('Invalid code', e?.errors?.[0]?.message ?? 'The code was incorrect. Try again.');
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
              Alert.alert('Error', e?.errors?.[0]?.message ?? 'Could not disable 2FA.');
            } finally {
              setTwoFaLoading(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Login Methods</Text>
        <View style={{ width: 40 }} />
      </View>

      {!isLoaded ? (
        <View style={s.loading}>
          <ActivityIndicator color={PURPLE} />
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
              const tappable = isOAuth && !method.connected;

              const rowContent = (
                <View style={s.row}>
                  <View style={[s.iconWrap, method.connected && s.iconWrapActive]}>
                    {method.icon}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.methodLabel}>{method.label}</Text>
                    <Text style={s.methodSub} numberOfLines={1}>{method.sublabel}</Text>
                  </View>
                  {method.connected ? (
                    <View style={s.activeBadge}>
                      <Feather name="check" size={11} color={SUCCESS} />
                      <Text style={s.activeBadgeText}>Active</Text>
                    </View>
                  ) : isOAuth ? (
                    isLinking ? (
                      <ActivityIndicator size="small" color={PURPLE} />
                    ) : (
                      <View style={s.enableBtn}>
                        <Text style={s.enableBtnText}>Connect</Text>
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
                      activeOpacity={0.7}
                      disabled={!!linkingProvider}
                      onPress={() => linkOAuth(strategy as 'oauth_google' | 'oauth_apple', method.label)}
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
              <View style={[s.iconWrap, twoFactorEnabled && s.iconWrapActive]}>
                <Feather name="shield" size={20} color={twoFactorEnabled ? PURPLE : SUBTLE} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.methodLabel}>Authenticator app (TOTP)</Text>
                <Text style={s.methodSub}>
                  {twoFactorEnabled ? 'Active — required at every sign-in' : 'Adds a one-time code requirement at sign-in'}
                </Text>
              </View>
              {twoFaLoading ? (
                <ActivityIndicator size="small" color={PURPLE} />
              ) : twoFactorEnabled ? (
                <TouchableOpacity onPress={handleDisable2FA} style={s.disableBtn}>
                  <Text style={s.disableBtnText}>Disable</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={handleEnable2FA} style={s.enableBtn}>
                  <Text style={s.enableBtnText}>Enable</Text>
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
            <Text style={s.modalStep}>2. Add a new account and enter this secret key manually:</Text>

            <View style={s.secretBox}>
              <Text style={s.secretText} selectable>{totpModal?.secret}</Text>
            </View>

            <Text style={s.modalNote}>
              Or scan the QR code using your authenticator's camera feature. The URI is:{'\n'}
              <Text style={{ fontFamily: FONT.regular, fontSize: 10, color: MUTED }}>{totpModal?.uri}</Text>
            </Text>

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
              style={[s.verifyBtn, { opacity: verifyCode.length < 6 ? 0.5 : 1 }]}
              onPress={handleVerifyTOTP}
              disabled={verifyCode.length < 6 || verifying}
            >
              {verifying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.verifyBtnText}>Verify &amp; enable 2FA</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
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
    backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE,
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
  inactiveBadge: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE,
  },

  enableBtn: {
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  enableBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE },

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
  secretBox: {
    backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: SP.sm, marginBottom: SP.md,
    alignItems: 'center',
  },
  secretText: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: PURPLE,
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
    backgroundColor: PURPLE, borderRadius: RADIUS.md,
    paddingVertical: 16, alignItems: 'center',
  },
  verifyBtnText: { fontSize: FS.base, fontFamily: FONT.semibold, color: '#fff' },
});

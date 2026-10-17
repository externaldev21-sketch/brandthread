/**
 * Account Type Settings — lets a user see their current account type
 * and switch between Buyer and Seller modes. The switch applies right away:
 * the server accountType is updated first, then the local role (RoleContext
 * + AuthGate's 'user_role') and the app routes to the new home. A buyer with
 * no brand yet sets one up here and continues into the store setup checklist.
 */
import React, { useState, useEffect, useRef } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView, TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAgeStatus } from '@/lib/ageGate';
import { AgeAskInline, AgeRestrictedInline } from '@/components/age/AgeNotices';
import { useRole } from '@/contexts/RoleContext';
import {
  SELLER_BRAND_STAGES,
  accountTypeSwitchErrorMessage,
  destinationAfterSwitch,
  emitAccountRoleChanged,
  needsSellerSetup,
} from '@/lib/accountTypeSwitch';

type AccountType = 'seller' | 'buyer';

export default function AccountTypeSettingsScreen() {
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const requestRef = useRef(0);
  const age = useAgeStatus();
  const { setRole } = useRole();

  const [currentType, setCurrentType] = useState<AccountType | null>(null);
  const [selectedType, setSelectedType] = useState<AccountType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Brand fields every seller account needs (see needsSellerSetup).
  const [sellerSetupNeeded, setSellerSetupNeeded] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [brandStage, setBrandStage] = useState('');
  const accountInfo: Record<AccountType, { icon: keyof typeof Feather.glyphMap; color: string; title: string; bullets: string[] }> = {
    seller: {
      icon: 'shopping-bag',
      color: colors.primary,
      title: 'Seller',
      bullets: ['List products and collections', 'Receive orders and payments', 'Access analytics and insights', 'Design studio and AI tools', 'Brand storefront'],
    },
    buyer: {
      icon: 'user',
      color: colors.accentForeground,
      title: 'Buyer',
      bullets: ['Browse seller storefronts', 'Purchase products', 'Follow sellers and friends', 'Save and share items'],
    },
  };

  function fetchProfile() {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    api.auth.me()
      .then((profile) => {
        if (requestId !== requestRef.current) return;
        const t: AccountType = profile?.accountType === 'buyer' ? 'buyer' : 'seller';
        setCurrentType(t);
        setSelectedType(t);
        const brand = profile as { brandName?: string | null; brandStage?: string | null };
        setSellerSetupNeeded(needsSellerSetup(brand));
        setBrandName(brand.brandName?.trim() ?? '');
        setBrandStage(brand.brandStage?.trim() ?? '');
      })
      .catch((error) => {
        if (requestId !== requestRef.current) return;
        setLoadError(accountTypeSwitchErrorMessage(error));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // Clerk resolving isn't the same as "never resolves" — once auth state is
    // known, either fetch the real profile or stop showing the spinner. Only
    // waiting on `isSignedIn` left this screen spinning forever whenever it
    // was reached without a live Clerk session (e.g. this dev preview).
    if (!authLoaded) return;
    if (isSignedIn) fetchProfile();
    else setLoading(false);
  }, [authLoaded, isSignedIn]);

  useEffect(() => {
    // Defensive guard: never let this screen spin forever, even if Clerk
    // itself never finishes hydrating (e.g. a misconfigured/dev environment).
    const timeout = setTimeout(() => setLoading(false), 4000);
    return () => clearTimeout(timeout);
  }, []);

  const isDirty = selectedType !== null && selectedType !== currentType;
  const showSellerSetup = isDirty && selectedType === 'seller' && sellerSetupNeeded;
  const sellerSetupValid = brandName.trim().length > 0 && brandStage.length > 0;
  const canSave = isDirty && (!showSellerSetup || sellerSetupValid);

  async function applySwitch(target: AccountType) {
    setSaving(true);
    try {
      const settingUpSeller = target === 'seller' && sellerSetupNeeded;
      if (settingUpSeller) {
        // Same server write seller onboarding uses for the brand fields.
        await api.auth.onboarding({ brandName: brandName.trim(), brandStage });
      }
      // Server is authoritative (it also enforces the seller age gate).
      await api.auth.updateProfile({ accountType: target });
      if (settingUpSeller) setSellerSetupNeeded(false);
      setCurrentType(target);
      // AuthGate routes by this key; RoleContext keeps its own per-user key.
      await AsyncStorage.setItem('user_role', target).catch(() => {});
      await setRole(target).catch(() => {});
      emitAccountRoleChanged(target);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const dest = destinationAfterSwitch(target, { completedSellerSetupNow: settingUpSeller });
      router.replace(dest.home as never);
      if (dest.next) router.push(dest.next as never);
    } catch (error) {
      Alert.alert('Could not switch account type', accountTypeSwitchErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!selectedType || !canSave) return;
    const target = selectedType;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      `Switch to ${accountInfo[target].title}?`,
      target === 'seller' && sellerSetupNeeded
        ? 'We\u2019ll save your brand and take you to your store setup checklist. You can switch back at any time.'
        : 'Switching account type changes the features available to you. You can switch back at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => { void applySwitch(target); } },
      ],
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Account type" onBack={() => goBackOr(router, '/buyer-settings-menu')} />

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : loadError && !currentType ? (
        <View style={s.loadingWrap}>
          <Text style={s.errorText}>{loadError}</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={fetchProfile}>
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 60 }}
          keyboardShouldPersistTaps="handled"
        >

          {/* Current badge */}
          {currentType && (
            <View style={s.currentBadge}>
              <Feather name={accountInfo[currentType].icon} size={ICON.sm} color={accountInfo[currentType].color} />
              <Text style={[s.currentBadgeText, { color: accountInfo[currentType].color }]}>
                Current: {accountInfo[currentType].title}
              </Text>
            </View>
          )}

          <Text style={s.sectionLabel}>Select account type</Text>

          {/* Type cards */}
          {(['seller', 'buyer'] as AccountType[]).map((type) => {
            const info = accountInfo[type];
            const isSelected = selectedType === type;
            const isCurrent = currentType === type;
            return (
              <TouchableOpacity
                key={type}
                style={[s.typeCard, isSelected && { borderColor: info.color, backgroundColor: info.color + '0D' }]}
                activeOpacity={0.8}
                onPress={() => { Haptics.selectionAsync(); setSelectedType(type); }}
              >
                <View style={s.typeCardTop}>
                  <View style={[s.typeIconWrap, { backgroundColor: info.color + '22' }]}>
                    <Feather name={info.icon} size={ICON.md} color={info.color} />
                  </View>
                  <View style={{ flex: 1, marginLeft: SP.sm }}>
                    <Text style={s.typeTitle}>{info.title}</Text>
                    {isCurrent && (
                      <Text style={[s.currentTag, { color: info.color }]}>Current plan</Text>
                    )}
                  </View>
                  <View style={[s.radioOuter, isSelected && { borderColor: info.color }]}>
                    {isSelected && <View style={[s.radioInner, { backgroundColor: info.color }]} />}
                  </View>
                </View>
                <View style={s.typeCardBullets}>
                  {info.bullets.map((b) => (
                    <View key={b} style={s.bulletRow}>
                      <Feather name="check" size={12} color={info.color} style={{ marginRight: 8, marginTop: 2 }} />
                      <Text style={s.bulletText}>{b}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Seller setup — a buyer with no brand yet sets one up before switching */}
          {showSellerSetup && age.status === 'ok' && (
            <View style={s.setupWrap}>
              <Text style={s.sectionLabel}>Set up your brand</Text>
              <Text style={s.setupHint}>
                Seller accounts need a brand. After switching you'll continue to your store setup checklist.
              </Text>
              <TextInput
                style={s.input}
                value={brandName}
                onChangeText={setBrandName}
                placeholder="Brand name"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                maxLength={60}
                accessibilityLabel="Brand name"
              />
              {SELLER_BRAND_STAGES.map((stage) => {
                const isSel = brandStage === stage.value;
                return (
                  <TouchableOpacity
                    key={stage.value}
                    style={[s.stageRow, isSel && { borderColor: colors.primary }]}
                    activeOpacity={0.8}
                    onPress={() => { Haptics.selectionAsync(); setBrandStage(stage.value); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSel }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.typeTitle}>{stage.label}</Text>
                      <Text style={s.bulletText}>{stage.sub}</Text>
                    </View>
                    <View style={[s.radioOuter, isSel && { borderColor: colors.primary }]}>
                      {isSel && <View style={[s.radioInner, { backgroundColor: colors.primary }]} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Save button */}
          {age.status !== 'ok' && selectedType === 'seller' ? (age.status === 'restricted' ? <AgeRestrictedInline /> : <AgeAskInline onResolved={age.setBand} />) : <TouchableOpacity
            style={[s.saveBtn, { backgroundColor: colors.primary }, !canSave && s.saveBtnDisabled]}
            activeOpacity={0.85}
            disabled={!canSave || saving}
            onPress={handleSave}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[s.saveBtnText, { color: colors.primaryForeground }, !canSave && { color: colors.mutedForeground }]}>
                {isDirty ? `Switch to ${selectedType ? accountInfo[selectedType].title : ''}` : 'No changes'}
              </Text>
            )}
          </TouchableOpacity>}

          <Text style={s.disclaimer}>
            Switching account types changes the features available to you. Your existing data (orders, products, etc.) is preserved.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root:        { flex: 1, backgroundColor: 'transparent' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  currentBadge:    { flexDirection: 'row', alignItems: 'center', gap: SP.xs, backgroundColor: colors.card, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SP.sm, paddingVertical: SP.xs, alignSelf: 'flex-start', marginBottom: SP.md },
  currentBadgeText:{ fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.semibold },

  sectionLabel: { fontSize: FS.xs, lineHeight: 14, fontFamily: FONT.semibold, color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },

  typeCard:        { backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, padding: SP.md, marginBottom: SP.sm },
  typeCardTop:     { flexDirection: 'row', alignItems: 'center' },
  typeIconWrap:    { width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  typeTitle:       { fontSize: FS.base, lineHeight: 19, fontFamily: FONT.semibold, color: colors.foreground },
  currentTag:      { fontSize: FS.xs, lineHeight: 14, fontFamily: FONT.medium, marginTop: 2 },
  radioOuter:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioInner:      { width: 10, height: 10, borderRadius: 5 },
  typeCardBullets: { marginTop: SP.sm, gap: 6 },
  bulletRow:       { flexDirection: 'row', alignItems: 'flex-start' },
  bulletText:      { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.regular, color: colors.mutedForeground, flex: 1 },

  saveBtn:        { borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SP.md, minHeight: 48 },
  saveBtnDisabled:{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  saveBtnText:    { fontSize: FS.base, lineHeight: 19, fontFamily: FONT.bold },

  setupWrap:  { marginTop: SP.sm },
  setupHint:  { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.regular, color: colors.mutedForeground, marginBottom: SP.sm },
  input:      { backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SP.md, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular, color: colors.foreground, marginBottom: SP.sm },
  stageRow:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, padding: SP.md, marginBottom: SP.xs },
  errorText:  { fontSize: FS.sm, lineHeight: 18, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', paddingHorizontal: SP.lg },
  retryBtn:   { marginTop: SP.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: SP.lg, paddingVertical: 10 },
  retryText:  { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.semibold, color: colors.foreground },

  disclaimer: { fontSize: FS.xs, lineHeight: 18, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', marginTop: SP.md },
});

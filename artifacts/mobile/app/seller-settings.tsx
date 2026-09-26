/**
 * Seller Settings Hub — its own screen, separate from Buyer Settings.
 * Profile card + search + compact grouped iOS-Settings-style sections.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { getInitials } from '@/lib/format';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { useApi } from '@/hooks/useApi';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { SELLER_SETTINGS_CATALOG, SettingsCatalogItem } from '@/services/settingsCatalog';
import { SettingsProfileCard, SettingsSearchBar, SettingsSection, SettingsRow, ConfirmSheet } from '@/components/settings/SettingsKit';
import { IconButton } from '@/components/BrandthreadUI';
import PlanUpsellModal from '@/components/PlanUpsellModal';
import StripeConnectWarning from '@/components/StripeConnectWarning';

export default function SellerSettingsScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();

  const [query, setQuery] = useState('');
  const [isModerator, setIsModerator] = useState(false);
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [scopeVisible, setScopeVisible] = useState(false);
  const [accountScope, setAccountScope] = useState<'global' | 'us'>('global');
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState<'global' | 'us' | null>(null);

  useEffect(() => {
    let active = true;
    api.moderation.me()
      .then((result) => { if (active) setIsModerator(result.isModerator); })
      .catch(() => { if (active) setIsModerator(false); });
    return () => { active = false; };
  }, [api]);

  const profileName = user?.fullName || user?.username || 'Your Brandthread store';
  // Initials are derived from the exact same `profileName` string shown next
  // to the avatar (not a separate first/last-name pair that may be blank),
  // so the avatar and the name text can never disagree.
  const profileInitials = getInitials(profileName, 'BT');
  const topPad = insets.top;
  const tabBarInset = useTabBarMetrics(2).occupiedHeight;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = SELLER_SETTINGS_CATALOG
      .map((group) => ({ ...group, items: group.items.filter((item) => !item.requiresModerator || isModerator) }))
      .filter((group) => group.items.length > 0);
    if (!q) return visible;
    return visible
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.label} ${item.description} ${item.aliases.join(' ')}`.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [query, isModerator]);

  async function openAccountScope() {
    setScopeVisible(true);
    setScopeLoading(true);
    try {
      const data = await api.seller.getSettings();
      setAccountScope(data.settings?.accountScope === 'us' ? 'us' : 'global');
    } finally {
      setScopeLoading(false);
    }
  }

  async function chooseAccountScope(nextScope: 'global' | 'us') {
    if (scopeSaving || nextScope === accountScope) { setScopeVisible(false); return; }
    hapticLight();
    setScopeSaving(nextScope);
    try {
      await api.seller.updateSettings({ accountScope: nextScope });
      setAccountScope(nextScope);
      setScopeVisible(false);
    } finally {
      setScopeSaving(null);
    }
  }

  async function handleItem(item: SettingsCatalogItem) {
    hapticLight();
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      item.requiresGrowth &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      setUpsellFeature(item.label);
      return;
    }
    if (item.action === 'sign-out') { setSignOutVisible(true); return; }
    if (item.action === 'delete-account') { router.push('/delete-account' as never); return; }
    if (item.action === 'account-scope') { await openAccountScope(); return; }
    if (item.route) router.push(item.route as never);
  }

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      hapticSuccess();
      router.replace('/sign-in' as never);
    } finally {
      setSigningOut(false);
      setSignOutVisible(false);
    }
  }

  return (
    <View style={s.page}>
      <View style={[s.header, { paddingTop: topPad + 12 }]}>
        <Text style={s.headerTitle}>Settings</Text>
        <IconButton name="x" color={colors.foreground} onPress={() => { hapticLight(); router.back(); }} accessibilityLabel="Close settings" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: tabBarInset + SP.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SettingsProfileCard
          eyebrow="Seller account"
          name={profileName}
          subtitle={user?.primaryEmailAddress?.emailAddress}
          initials={profileInitials}
          onPress={() => router.push('/edit-profile' as never)}
        />

        <SettingsSearchBar value={query} onChangeText={setQuery} />

        <View style={{ marginBottom: 18 }}>
          <StripeConnectWarning />
        </View>

        {groups.map((group) => (
          <SettingsSection key={group.title} title={group.title}>
            {group.items.map((item, i) => (
              <SettingsRow
                key={item.label}
                icon={item.icon}
                label={item.label}
                subtitle={item.description}
                destructive={item.destructive}
                soon={item.soon}
                badge={item.requiresGrowth && GROWTH_PLAN_ENFORCEMENT_ENABLED && !planLoading && !hasPlan('growth') ? 'Growth' : undefined}
                last={i === group.items.length - 1}
                onPress={() => handleItem(item)}
              />
            ))}
          </SettingsSection>
        ))}

        <Text style={s.version}>Brandthread v1.0.0</Text>
      </ScrollView>

      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => { setUpsellFeature(null); router.push('/subscription' as never); }}
      />

      <ConfirmSheet
        visible={signOutVisible}
        title="Sign out?"
        message="You can sign back in to this Brandthread account anytime."
        confirmLabel="Sign out"
        loading={signingOut}
        onConfirm={confirmSignOut}
        onCancel={() => setSignOutVisible(false)}
      />

      <AccountScopeSheet
        visible={scopeVisible}
        loading={scopeLoading}
        saving={scopeSaving}
        value={accountScope}
        onChoose={chooseAccountScope}
        onClose={() => { if (!scopeSaving) setScopeVisible(false); }}
      />
    </View>
  );
}

function AccountScopeSheet({
  visible, loading, saving, value, onChoose, onClose,
}: {
  visible: boolean;
  loading: boolean;
  saving: 'global' | 'us' | null;
  value: 'global' | 'us';
  onChoose: (v: 'global' | 'us') => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const s = useMemo(() => makeScopeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close account reach options" />
        <View style={s.card}>
          <View style={s.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Account reach</Text>
              <Text style={s.subtitle}>Choose where your seller account is available.</Text>
            </View>
            <TouchableOpacity style={s.close} onPress={onClose} disabled={!!saving} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          {loading ? (
            <View style={{ minHeight: 150, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              {([
                { value: 'global' as const, label: 'Global account', description: 'Make your account available worldwide.', icon: 'globe' as const },
                { value: 'us' as const, label: 'United States only', description: 'Limit your account to the United States.', icon: 'map-pin' as const },
              ]).map((option) => {
                const selected = value === option.value;
                const isSaving = saving === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    activeOpacity={0.75}
                    disabled={!!saving}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: !!saving }}
                    onPress={() => onChoose(option.value)}
                    style={[s.option, { borderColor: selected ? colors.primary : colors.border }, selected && { backgroundColor: colors.secondary }]}
                  >
                    <View style={s.optionIcon}>
                      <Feather name={option.icon} size={18} color={colors.foreground} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.optionTitle}>{option.label}</Text>
                      <Text style={s.optionDescription}>{option.description}</Text>
                    </View>
                    {isSaving ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? colors.primary : colors.mutedForeground} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: 20 },
    headerTitle: { fontSize: 30, fontFamily: FONT.bold, color: colors.foreground },
    version: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', marginTop: 4 },
  });
}

function makeScopeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: (colors as any).overlay ?? 'rgba(0,0,0,0.68)' },
    card: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginBottom: 18 },
    title: { fontSize: 20, fontFamily: FONT.bold, color: colors.foreground },
    subtitle: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 4 },
    close: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    option: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
    optionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
    optionTitle: { fontSize: 15, fontFamily: FONT.semibold, color: colors.foreground },
    optionDescription: { fontSize: 12, lineHeight: 17, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  });
}

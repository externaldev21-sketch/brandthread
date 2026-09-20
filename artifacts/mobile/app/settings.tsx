import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth, useUser } from '@clerk/expo';
import { useRole } from '@/contexts/RoleContext';
import { SETTINGS_CATALOG, SettingsCatalogGroup, SettingsCatalogItem } from '@/services/settingsCatalog';
import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { useApi } from '@/hooks/useApi';


interface SettingsItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route?: string;
  action?: 'sign-out' | 'delete-account' | 'account-scope';
  destructive?: boolean;
}

interface SettingsGroup {
  title: string;
  items: SettingsItem[];
}

const STATIC_GROUPS: SettingsGroup[] = [
  {
    title: 'Account',
    items: [
      { label: 'Edit profile',         icon: 'user',        route: '/edit-profile' },
      { label: 'Edit brand setup',     icon: 'briefcase',   route: '/general-settings' },
      { label: 'Freelance jobs',       icon: 'zap',         route: '/freelancer-jobs' },
      { label: 'Shopping preferences', icon: 'shopping-bag', route: '/shopping-preferences' },
      { label: 'Account type',         icon: 'layers',      route: '/account-type-settings' },
      { label: 'Connected login methods', icon: 'link',     route: '/login-methods' },
      { label: 'Identity verification', icon: 'shield',     route: '/seller-verification' },
    ],
  },
  {
    title: 'App settings',
    items: [
      { label: 'Push notifications', icon: 'bell',       route: '/push-notifications' },
      { label: 'App Theme',          icon: 'droplet',    route: '/app-theme' },
      { label: 'App icon',           icon: 'smartphone', route: '/app-icon' },
      { label: 'Biometric unlock',   icon: 'unlock',     route: '/biometric-unlock' },
    ],
  },
  {
    title: 'Store settings',
    items: [
      { label: 'General',                    icon: 'home',          route: '/general-settings' },
      { label: 'Plan & subscription',        icon: 'star',          route: '/subscription' },
      { label: 'Payouts',                    icon: 'dollar-sign',   route: '/payouts' },
      { label: 'Billing history',            icon: 'clipboard',     route: '/billing' },
      { label: 'Users',                      icon: 'users',         route: '/users' },
      { label: 'Roles',                      icon: 'users',         route: '/roles' },
      { label: 'Security',                   icon: 'shield',        route: '/security' },
      { label: 'Payments',                   icon: 'credit-card',   route: '/payments' },
      { label: 'Checkout',                   icon: 'shopping-cart', route: '/checkout' },
      { label: 'Customer accounts',          icon: 'user',          route: '/customer-accounts' },
      { label: 'Shipping and delivery',      icon: 'truck',         route: '/shipping-delivery' },
      { label: 'Taxes and duties',           icon: 'percent',       route: '/taxes-duties' },
      { label: 'Locations',                  icon: 'map-pin',       route: '/locations' },
      { label: 'Bundles',                    icon: 'package',       route: '/product-bundles' },
      { label: 'Account reach',              icon: 'globe',         action: 'account-scope' },
      { label: 'Integrations',              icon: 'link',          route: '/integrations' },
      { label: 'Customer events',            icon: 'activity',      route: '/customer-events' },
      { label: 'Notifications',             icon: 'bell',          route: '/notifications-settings' },
      { label: 'Metafields and metaobjects', icon: 'database',      route: '/metafields' },
      { label: 'Languages',                  icon: 'message-square', route: '/languages' },
      { label: 'Customer privacy',           icon: 'lock',          route: '/customer-privacy' },
      { label: 'Policies',                   icon: 'file' },
    ],
  },
  {
    title: 'Danger zone',
    items: [
      { label: 'Sign out',      icon: 'log-out',  action: 'sign-out', destructive: true },
      { label: 'Delete account', icon: 'trash-2', action: 'delete-account', destructive: true },
    ],
  },
];

export default function SettingsScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const api = useApi();
  const { signOut } = useAuth();
  const { user } = useUser();
  const { role, isLoaded: isRoleLoaded } = useRole();
  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const [query, setQuery]       = useState('');
  const [upsellFeature, setUpsellFeature] = useState<string | null>(null);
  const [scopeVisible, setScopeVisible] = useState(false);
  const [accountScope, setAccountScope] = useState<'global' | 'us'>('global');
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeSaving, setScopeSaving] = useState<'global' | 'us' | null>(null);

  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const profileName = user?.fullName || user?.username || 'Your Brandthread profile';
  const profileInitials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || 'BT';
  const profileRoute = role === 'seller' ? '/edit-profile' : '/(buyer)/edit-profile';

  function haptic() { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
  function handleClose() { haptic(); router.back(); }

  async function openAccountScope() {
    setScopeVisible(true);
    setScopeLoading(true);
    try {
      const data = await api.seller.getSettings();
      setAccountScope(data.settings?.accountScope === 'us' ? 'us' : 'global');
    } catch {
      Alert.alert('Could not load account reach', 'Check your connection and try again.');
      setScopeVisible(false);
    } finally {
      setScopeLoading(false);
    }
  }

  async function chooseAccountScope(nextScope: 'global' | 'us') {
    if (scopeSaving) return;
    if (nextScope === accountScope) {
      setScopeVisible(false);
      return;
    }
    haptic();
    setScopeSaving(nextScope);
    try {
      await api.seller.updateSettings({ accountScope: nextScope });
      setAccountScope(nextScope);
      setScopeVisible(false);
    } catch {
      Alert.alert('Could not save account reach', 'Your previous selection is still active. Please try again.');
    } finally {
      setScopeSaving(null);
    }
  }

  async function handleItem(item: SettingsItem | SettingsCatalogItem) {
    haptic();
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      'requiresGrowth' in item &&
      item.requiresGrowth &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      setUpsellFeature(item.label);
      return;
    }
    if (item.action === 'sign-out') {
      Alert.alert('Sign out', 'Are you sure you want to sign out?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out', style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/sign-in' as never);
          },
        },
      ]);
      return;
    }
    if (item.action === 'delete-account') {
      router.push('/buyer-account-control' as never);
      return;
    }
    if (item.action === 'account-scope') {
      await openAccountScope();
      return;
    }
    if (item.route) router.push(item.route as never);
  }

  const filteredGroups = useMemo<SettingsCatalogGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const visible = SETTINGS_CATALOG.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.audience === 'shared' || (isRoleLoaded && item.audience === role),
      ),
    })).filter((group) => group.items.length > 0);
    if (!q) return visible;
    return visible.map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        `${i.label} ${i.description} ${i.aliases.join(' ')}`.toLowerCase().includes(q),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query, role, isRoleLoaded]);

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <View style={[styles.header, { backgroundColor: '#0D0B08', paddingTop: topPad + 12 }]}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerTitle}>Settings</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            activeOpacity={0.7}
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={[styles.sheet, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.profileHeader, { borderBottomColor: colors.border }]}>
          <View style={[styles.profileAvatar, { backgroundColor: colors.primary }]}>
            <Text style={[styles.profileAvatarText, { color: colors.primaryForeground }]}>{profileInitials}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={[styles.profileEyebrow, { color: colors.mutedForeground }]}>
              {role === 'seller' ? 'Seller account' : 'Buyer account'}
            </Text>
            <Text style={[styles.profileName, { color: colors.foreground }]} numberOfLines={1}>{profileName}</Text>
            <Text style={[styles.profileSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {user?.primaryEmailAddress?.emailAddress || 'Manage your account and preferences'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.profileEdit, { borderColor: colors.border }]}
            onPress={() => router.push(profileRoute as never)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
          >
            <Feather name="edit-2" size={15} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.searchWrap, { backgroundColor: colors.secondary }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search settings"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>

        {filteredGroups.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>{group.title}</Text>
            <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {group.items.map((item, i) => (
                <TouchableOpacity
                  key={item.label}
                  onPress={() => handleItem(item)}
                  activeOpacity={0.7}
                  style={[
                    styles.row,
                    i !== group.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  ]}
                >
                  <Feather
                    name={item.icon}
                    size={17}
                    color={item.destructive ? '#EF4444' : colors.foreground}
                    style={{ width: 22 }}
                  />
                  <View style={styles.rowCopy}>
                    <Text
                      style={[styles.rowLabel, { color: item.destructive ? '#EF4444' : colors.foreground }]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {'description' in item && (
                      <Text style={[styles.rowDescription, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.description}
                      </Text>
                    )}
                  </View>
                  {!item.destructive && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <Text style={[styles.versionText, { color: colors.mutedForeground }]}>Brandthread v1.0.0</Text>
      </ScrollView>
      <PlanUpsellModal
        visible={upsellFeature !== null}
        featureName={upsellFeature ?? ''}
        requiredPlan="growth"
        onClose={() => setUpsellFeature(null)}
        onUpgrade={() => {
          setUpsellFeature(null);
          router.push('/subscription' as never);
        }}
      />
      <Modal
        visible={scopeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!scopeSaving) setScopeVisible(false);
        }}
      >
        <View style={styles.scopeBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Close account reach options"
            onPress={() => {
              if (!scopeSaving) setScopeVisible(false);
            }}
          />
          <View style={[styles.scopeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.scopeHeader}>
              <View style={styles.scopeHeaderCopy}>
                <Text style={[styles.scopeTitle, { color: colors.foreground }]}>Account reach</Text>
                <Text style={[styles.scopeSubtitle, { color: colors.mutedForeground }]}>
                  Choose where your seller account is available.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.scopeClose, { borderColor: colors.border }]}
                onPress={() => setScopeVisible(false)}
                disabled={!!scopeSaving}
                accessibilityRole="button"
                accessibilityLabel="Close account reach options"
              >
                <Feather name="x" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            {scopeLoading ? (
              <View style={styles.scopeLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.scopeOptions} accessibilityRole="radiogroup">
                {([
                  {
                    value: 'global',
                    label: 'Global account',
                    description: 'Make your account available worldwide.',
                    icon: 'globe',
                  },
                  {
                    value: 'us',
                    label: 'United States only',
                    description: 'Limit your account to the United States.',
                    icon: 'map-pin',
                  },
                ] as const).map((option) => {
                  const selected = accountScope === option.value;
                  const saving = scopeSaving === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      activeOpacity={0.75}
                      disabled={!!scopeSaving}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: !!scopeSaving }}
                      onPress={() => chooseAccountScope(option.value)}
                      style={[
                        styles.scopeOption,
                        { borderColor: selected ? colors.primary : colors.border },
                        selected && { backgroundColor: colors.secondary },
                      ]}
                    >
                      <View style={[styles.scopeOptionIcon, { backgroundColor: colors.secondary }]}>
                        <Feather name={option.icon} size={18} color={colors.foreground} />
                      </View>
                      <View style={styles.scopeOptionCopy}>
                        <Text style={[styles.scopeOptionTitle, { color: colors.foreground }]}>{option.label}</Text>
                        <Text style={[styles.scopeOptionDescription, { color: colors.mutedForeground }]}>
                          {option.description}
                        </Text>
                      </View>
                      {saving ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather
                          name={selected ? 'check-circle' : 'circle'}
                          size={20}
                          color={selected ? colors.primary : colors.mutedForeground}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 28 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 30, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sheet: { flex: 1, marginTop: -16, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 20 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 2, paddingBottom: 20, marginBottom: 18, borderBottomWidth: 1 },
  profileAvatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  profileCopy: { flex: 1, marginLeft: 12, marginRight: 10 },
  profileEyebrow: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  profileName: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  profileSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 3 },
  profileEdit: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  group: { marginBottom: 22 },
  groupTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14 },
  rowCopy: { flex: 1 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  rowDescription: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  versionText: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
  scopeBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  scopeCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
  },
  scopeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  scopeHeaderCopy: { flex: 1 },
  scopeTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  scopeSubtitle: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_400Regular', marginTop: 4 },
  scopeClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeLoading: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  scopeOptions: { gap: 10 },
  scopeOption: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scopeOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeOptionCopy: { flex: 1 },
  scopeOptionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  scopeOptionDescription: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular', marginTop: 2 },
});

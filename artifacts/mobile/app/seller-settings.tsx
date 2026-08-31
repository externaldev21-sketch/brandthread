/**
 * Seller Settings & Tools — Stack Screen
 *
 * Replaces the old "More" tab. Accessible via the gear icon on the Profile tab.
 * Contains the 6 section groups (Store, Design Studio, Operations, Growth,
 * Money, Account) plus Sign out. The user card lives on the Profile tab now,
 * so this screen is purely a navigation hub.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { getSetupState, completionPercent } from '@/lib/setupStore';
import { BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE, SUCCESS, BLUE, ORANGE, RED, GOLD, FONT, FS, SP, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { NavigationCard } from '@/components/BrandthreadUI';
import { SecondaryButton } from '@/components/BrandthreadUI';
import StripeConnectWarning from '@/components/StripeConnectWarning';

// ─── Enable LayoutAnimation on Android ────────────────────────────────────────
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  desc: string;
  accent: string;
  badge?: boolean;
  route?: string;
}

// ─── Section definitions (same as old More screen) ───────────────────────────

const STORE_ITEMS: NavItem[] = [
  { icon: 'layout', label: 'Store Builder', desc: 'Customize your storefront',  accent: PURPLE, route: '/store-builder' },
  { icon: 'grid',   label: 'Collections',   desc: 'Group products',              accent: CYAN,   route: '/store-collections' },
  { icon: 'globe',  label: 'Domains',       desc: 'Custom domain settings',      accent: BLUE,   route: '/store-domain' },
  { icon: 'tag',    label: 'Discounts',     desc: 'Coupon codes and offers',      accent: GOLD, route: '/discounts' },
];

const STUDIO_ITEMS: NavItem[] = [
  { icon: 'edit-3',      label: 'Design Studio',      desc: 'Create designs and mockups',  accent: PURPLE, route: '/design' },
  { icon: 'camera',      label: 'AI Photoshoot',      desc: 'Generate product photos',     accent: BLUE,   route: '/design-ai-photoshoot' },
  { icon: 'scissors',    label: 'Background Removal', desc: 'Clean image backgrounds',     accent: CYAN,   route: '/design-bg-removal' },
  { icon: 'trending-up', label: 'Campaign Generator', desc: 'Create campaign assets',      accent: ORANGE, route: '/design-campaign' },
  { icon: 'layers',      label: 'Brand Assets',       desc: 'Logos, colors and graphics',  accent: GOLD,   route: '/design-brand-assets' },
];

const OPERATIONS_ITEMS: NavItem[] = [
  { icon: 'archive',   label: 'Inventory',        desc: 'Track stock levels',             accent: BLUE,   route: '/inventory' },
  { icon: 'truck',     label: 'Shipping',         desc: 'Rates, zones and carriers',      accent: ORANGE, route: '/shipping' },
  { icon: 'tool',      label: 'Manufacturer Hub', desc: 'Find and manage manufacturers',  accent: PURPLE, badge: true, route: '/manufacturer-hub' },
  { icon: 'users',     label: 'Customers',        desc: 'Browse your customer list',      accent: PURPLE_LIGHT, route: '/customer-accounts' },
  { icon: 'sun',       label: 'Vacation Mode',    desc: 'Pause your store while away',    accent: ORANGE, route: '/vacation-mode' },
  { icon: 'flag',      label: 'Review Reports',   desc: 'Moderate flagged content',       accent: RED,    route: '/admin-reports' },
];

const GROWTH_ITEMS: NavItem[] = [
  { icon: 'message-circle', label: 'Messages',   desc: 'Read and reply to buyer DMs',       accent: PURPLE, route: '/seller-inbox' },
  { icon: 'zap',            label: 'Boost Posts', desc: 'Promote content for wider reach',   accent: GOLD,   route: '/boost' },
  { icon: 'trending-up',    label: 'Marketing',  desc: 'Campaigns and promotions',           accent: ORANGE, route: '/(tabs)/marketing' },
  { icon: 'bar-chart-2',    label: 'Analytics',  desc: 'Sales, traffic and insights',        accent: BLUE,   route: '/(tabs)/analytics' },
  { icon: 'video',          label: 'Content',    desc: 'Posts, drafts and scheduled',        accent: CYAN,   route: '/content' },
  { icon: 'briefcase',      label: 'Community',  desc: 'Hire freelance creatives',           accent: CYAN,   route: '/community' },
];

const MONEY_ITEMS: NavItem[] = [
  { icon: 'dollar-sign', label: 'Payouts',          desc: 'Bank account and payout history', accent: SUCCESS, route: '/payouts' },
  { icon: 'star',        label: 'Subscription',     desc: 'Manage your Brandthread plan',    accent: GOLD, badge: true, route: '/subscription' },
  { icon: 'percent',     label: 'Taxes and Duties', desc: 'Tax rules and collection',        accent: MUTED, route: '/taxes-duties' },
];

const ACCOUNT_ITEMS: NavItem[] = [
  { icon: 'users',       label: 'Team',           desc: 'Invite collaborators',          accent: BLUE,   route: '/team' },
  { icon: 'link',        label: 'Integrations',   desc: 'Connect third-party services',  accent: PURPLE, route: '/integrations/klaviyo' },
  { icon: 'bell',        label: 'Notifications',  desc: 'Push and email preferences',    accent: ORANGE, route: '/notifications-settings' },
  { icon: 'droplet',     label: 'App Theme',      desc: 'Choose your Brandthread finish', accent: PURPLE, route: '/app-theme' },
  { icon: 'gift',        label: 'Invite Friends', desc: 'Share your referral code and see rewards', accent: GOLD, route: '/buyer-invite' },
  { icon: 'download',    label: 'Download My Data', desc: 'Export your products, orders and customers', accent: BLUE, route: '/seller-data-export' },
  { icon: 'settings',    label: 'Settings',       desc: 'App and account settings',      accent: MUTED,  route: '/settings' },
  { icon: 'trash-2',     label: 'Delete Account', desc: 'Permanently erase your account', accent: RED, route: '/buyer-account-control' },
  { icon: 'help-circle', label: 'Help & Support', desc: 'Guides, FAQs and contact us',  accent: CYAN,   route: '/help' },
];

const SECTIONS: {
  key: string;
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: NavItem[];
}[] = [
  { key: 'store',      title: 'Store',          icon: 'layout',      items: STORE_ITEMS },
  { key: 'studio',     title: 'Design Studio',  icon: 'zap',         items: STUDIO_ITEMS },
  { key: 'operations', title: 'Operations',     icon: 'tool',        items: OPERATIONS_ITEMS },
  { key: 'growth',     title: 'Growth',         icon: 'trending-up', items: GROWTH_ITEMS },
  { key: 'money',      title: 'Money',          icon: 'dollar-sign', items: MONEY_ITEMS },
  { key: 'account',    title: 'Account',        icon: 'user',        items: ACCOUNT_ITEMS },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SellerSettingsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [setupPct, setSetupPct] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map(s => [s.key, true])),
  );

  useEffect(() => {
    getSetupState().then(s => setSetupPct(completionPercent(s)));
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      await AsyncStorage.removeItem('@brandthread/onboarding_complete');
      router.replace('/sign-in');
    } catch {
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleNavPress = (item: NavItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.route) {
      router.push(item.route as any);
    }
  };

  const toggleSection = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Custom header with back button ─────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.75}
        >
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings & Tools</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >

        {/* ── Setup progress strip ──────────────────────────────────────── */}
        {setupPct < 100 && (
          <TouchableOpacity
            style={s.progressStrip}
            onPress={() => router.push('/(tabs)/index' as any)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.progressLabel}>Store setup</Text>
                <Text style={[s.progressLabel, { color: PURPLE_LIGHT }]}>{setupPct}%</Text>
              </View>
              <View style={s.track}>
                <View style={[s.fill, { width: `${setupPct}%` }]} />
              </View>
            </View>
            <Feather name="chevron-right" size={15} color={MUTED} />
          </TouchableOpacity>
        )}

        {/* ── Collapsible sections ──────────────────────────────────────── */}
        {SECTIONS.map(({ key, title, icon, items }) => {
          const isOpen = expanded[key];
          return (
            <View key={key} style={s.section}>
              <TouchableOpacity
                style={s.sectionHeader}
                onPress={() => toggleSection(key)}
                activeOpacity={0.7}
              >
                <View style={s.sectionHeaderLeft}>
                  <Feather name={icon} size={13} color={SUBTLE} />
                  <Text style={s.sectionTitle}>{title.toUpperCase()}</Text>
                </View>
                <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={SUBTLE} />
              </TouchableOpacity>

              {isOpen && (
                <>
                  {key === 'account' && <StripeConnectWarning />}
                  <View style={s.sectionItems}>
                    {items.map((item) => (
                      <NavigationCard
                        key={item.label}
                        icon={item.icon}
                        label={item.label}
                        description={item.desc}
                        accent={item.accent}
                        badge={item.badge}
                        onPress={() => handleNavPress(item)}
                      />
                    ))}
                  </View>
                </>
              )}
            </View>
          );
        })}

        {/* ── Sign out ──────────────────────────────────────────────────── */}
        <View style={s.signOutWrap}>
          <SecondaryButton label="Sign out" accent={RED} onPress={handleSignOut} />
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  scrollContent: { paddingBottom: 120, paddingTop: SP.sm },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },

  // Setup strip
  progressStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    marginHorizontal: SP.md,
    marginBottom: SP.md,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  progressLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  track: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: PURPLE,
    borderRadius: 99,
  },

  // Sections
  section:      { marginBottom: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SP.md,
    paddingVertical: 10,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: SUBTLE,
    letterSpacing: 1.5,
  },
  sectionItems: {
    marginHorizontal: SP.md,
    gap: SP.sm,
    marginBottom: SP.sm,
  },

  // Sign out
  signOutWrap: {
    marginHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: 32,
  },
  });
};

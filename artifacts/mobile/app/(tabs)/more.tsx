/**
 * More Screen — Brandthread Seller App
 * Hub for store, studio, operations, growth, money, and account.
 *
 * Sections are collapsible. All previously-dead links are wired.
 * Payouts de-duplicated (single entry in Money).
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, LayoutAnimation,
  Platform, UIManager,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser, useAuth } from '@clerk/expo';
import { getSetupState, completionPercent, SetupState } from '@/lib/setupStore';
import {
  BG, SURFACE, CARD, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, BLUE, ORANGE, RED, GOLD,
  FONT, FS, SP,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, SecondaryButton, NavigationCard,
  StatusBadge,
} from '@/components/BrandthreadUI';

// Enable LayoutAnimation on Android
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
  /** undefined = coming soon; string = real route */
  route?: string;
}

// ─── Section definitions ──────────────────────────────────────────────────────
// FIX: Payouts de-duplicated — appears only once, in Money.
// FIX: Shipping → /shipping, Customers → /customer-accounts, Team → /team,
//      Taxes and Duties → /taxes-duties (all previously had no route).

const STORE_ITEMS: NavItem[] = [
  { icon: 'layout', label: 'Store Builder', desc: 'Customize your storefront',  accent: PURPLE, route: '/store-builder' },
  { icon: 'grid',   label: 'Collections',   desc: 'Group products',              accent: CYAN,   route: '/store-collections' },
  { icon: 'globe',  label: 'Domains',       desc: 'Custom domain settings',      accent: BLUE,   route: '/store-domain' },
  { icon: 'tag',    label: 'Discounts',     desc: 'Coupon codes and offers',      accent: GOLD },
  // Discounts has no screen yet — shows "coming soon" until wired
];

const STUDIO_ITEMS: NavItem[] = [
  { icon: 'edit-3',      label: 'Design Studio',      desc: 'Create designs and mockups',  accent: PURPLE, route: '/design' },
  { icon: 'camera',      label: 'AI Photoshoot',      desc: 'Generate product photos',     accent: BLUE,   route: '/design-ai-photoshoot' },
  { icon: 'scissors',    label: 'Background Removal', desc: 'Clean image backgrounds',     accent: CYAN,   route: '/design-bg-removal' },
  { icon: 'trending-up', label: 'Campaign Generator', desc: 'Create campaign assets',      accent: ORANGE, route: '/design-campaign' },
  { icon: 'layers',      label: 'Brand Assets',       desc: 'Logos, colors and graphics',  accent: GOLD,   route: '/design-brand-assets' },
];

const OPERATIONS_ITEMS: NavItem[] = [
  { icon: 'archive', label: 'Inventory',        desc: 'Track stock levels',             accent: BLUE,         route: '/inventory' },
  { icon: 'truck',   label: 'Shipping',         desc: 'Rates, zones and carriers',      accent: ORANGE,       route: '/shipping' },
  // FIX ↑ previously had no route — now wired to shipping.tsx
  { icon: 'tool',    label: 'Manufacturer Hub', desc: 'Find and manage manufacturers',  accent: PURPLE, badge: true, route: '/manufacturer-hub' },
  { icon: 'users',   label: 'Customers',        desc: 'Browse your customer list',      accent: PURPLE_LIGHT, route: '/customer-accounts' },
  // FIX ↑ previously had no route — now wired to customer-accounts.tsx
];

const GROWTH_ITEMS: NavItem[] = [
  { icon: 'message-circle', label: 'Messages',  desc: 'Read and reply to buyer DMs',  accent: PURPLE, route: '/seller-inbox' },
  { icon: 'trending-up',    label: 'Marketing', desc: 'Campaigns and promotions',      accent: ORANGE, route: '/(tabs)/marketing' },
  { icon: 'bar-chart-2',    label: 'Analytics', desc: 'Sales, traffic and insights',   accent: BLUE,   route: '/(tabs)/analytics' },
  { icon: 'video',          label: 'Content',   desc: 'Posts, drafts and scheduled',   accent: CYAN,   route: '/content' },
];

const MONEY_ITEMS: NavItem[] = [
  { icon: 'dollar-sign', label: 'Payouts',          desc: 'Bank account and payout history', accent: SUCCESS, route: '/payouts' },
  // ↑ De-duplicated: was also in OPERATIONS without a route — removed from there.
  { icon: 'star',        label: 'Subscription',     desc: 'Manage your Brandthread plan',    accent: GOLD, badge: true, route: '/subscription' },
  { icon: 'percent',     label: 'Taxes and Duties', desc: 'Tax rules and collection',        accent: MUTED, route: '/taxes-duties' },
  // FIX ↑ previously had no route — now wired to taxes-duties.tsx
];

const ACCOUNT_ITEMS: NavItem[] = [
  { icon: 'users',       label: 'Team',           desc: 'Invite collaborators',          accent: BLUE,   route: '/team' },
  // FIX ↑ previously had no route — now wired to team.tsx
  { icon: 'link',        label: 'Integrations',   desc: 'Connect third-party services',  accent: PURPLE, route: '/integrations/klaviyo' },
  { icon: 'bell',        label: 'Notifications',  desc: 'Push and email preferences',    accent: ORANGE, route: '/notifications-settings' },
  { icon: 'settings',    label: 'Settings',       desc: 'App and account settings',      accent: MUTED,  route: '/settings' },
  { icon: 'help-circle', label: 'Help & Support', desc: 'Guides, FAQs and contact us',  accent: CYAN,   route: '/help' },
];

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTIONS: { key: string; title: string; icon: keyof typeof Feather.glyphMap; items: NavItem[] }[] = [
  { key: 'store',      title: 'Store',          icon: 'layout',     items: STORE_ITEMS },
  { key: 'studio',     title: 'Design Studio',  icon: 'zap',        items: STUDIO_ITEMS },
  { key: 'operations', title: 'Operations',     icon: 'tool',       items: OPERATIONS_ITEMS },
  { key: 'growth',     title: 'Growth',         icon: 'trending-up',items: GROWTH_ITEMS },
  { key: 'money',      title: 'Money',          icon: 'dollar-sign',items: MONEY_ITEMS },
  { key: 'account',    title: 'Account',        icon: 'user',       items: ACCOUNT_ITEMS },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MoreScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { user } = useUser();
  const { signOut } = useAuth();

  const [setupState, setSetupState]   = useState<SetupState | null>(null);
  const [expanded, setExpanded]       = useState<Record<string, boolean>>(
    // All sections open by default
    Object.fromEntries(SECTIONS.map(s => [s.key, true])),
  );

  useEffect(() => {
    getSetupState().then(setSetupState);
  }, []);

  const percent     = setupState ? completionPercent(setupState) : 0;
  const firstName   = user?.firstName ?? 'Seller';
  const lastName    = user?.lastName  ?? '';
  const displayName = lastName ? `${firstName} ${lastName}` : firstName;
  const email       = user?.primaryEmailAddress?.emailAddress ?? '';
  const avatarLetter = (user?.firstName?.[0] ?? 'S').toUpperCase();

  // ─── Handlers ─────────────────────────────────────────────────────────────

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
      try {
        router.push(item.route as any);
      } catch {
        Alert.alert(item.label, 'Coming soon');
      }
    } else {
      Alert.alert(item.label, 'Coming soon');
    }
  };

  const toggleSection = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* USER HEADER */}
        <GradientCard
          glow
          colors={['rgba(139,92,246,0.18)', 'rgba(34,211,238,0.06)']}
          style={styles.userCard}
        >
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>{avatarLetter}</Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{displayName}</Text>
              {!!email && <Text style={styles.userEmail}>{email}</Text>}
              <View style={styles.badgeRow}>
                <StatusBadge label="PRO" variant="purple" />
              </View>
            </View>
          </View>
          <SecondaryButton
            label="Edit profile"
            small
            accent={PURPLE}
            onPress={() => router.push('/edit-profile' as any)}
            style={styles.editProfileBtn}
          />
        </GradientCard>

        {/* STORE SETUP PROGRESS */}
        <BrandthreadCard style={styles.setupCard}>
          <View style={styles.setupRow}>
            <Text style={[styles.setupLabel, { color: MUTED, fontSize: FS.sm }]}>Store setup</Text>
            <Text style={[styles.setupLabel, { color: PURPLE_LIGHT, fontSize: FS.sm, fontFamily: FONT.bold }]}>
              {percent}%
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
          <TouchableOpacity
            onPress={() => Alert.alert('Setup', 'Guided setup coming soon')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.continueSetup}>Continue setup →</Text>
          </TouchableOpacity>
        </BrandthreadCard>

        {/* COLLAPSIBLE SECTIONS */}
        {SECTIONS.map(({ key, title, icon, items }) => {
          const isOpen = expanded[key];
          return (
            <View key={key} style={styles.section}>
              {/* Section header — tappable to expand/collapse */}
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleSection(key)}
                activeOpacity={0.7}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Feather name={icon} size={13} color={SUBTLE} style={styles.sectionIcon} />
                  <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
                </View>
                <Feather
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={SUBTLE}
                />
              </TouchableOpacity>

              {/* Items — hidden when collapsed */}
              {isOpen && (
                <View style={styles.sectionItems}>
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
              )}
            </View>
          );
        })}

        {/* SIGN OUT */}
        <View style={styles.signOutWrap}>
          <SecondaryButton
            label="Sign out"
            accent={RED}
            onPress={handleSignOut}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    paddingBottom: 160,
    paddingTop: SP.sm,
  },

  // User card
  userCard: {
    marginHorizontal: SP.md,
    marginBottom: SP.md,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    marginBottom: SP.sm,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
  },
  userInfo: {
    flex: 1,
    gap: 3,
  },
  userName: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
  },
  userEmail: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  editProfileBtn: {
    alignSelf: 'flex-start',
  },

  // Setup progress
  setupCard: {
    marginHorizontal: SP.md,
    marginBottom: SP.lg ?? SP.md,
  },
  setupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SP.sm,
  },
  setupLabel: {
    fontFamily: FONT.regular,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: PURPLE,
    borderRadius: 99,
  },
  continueSetup: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
    marginTop: SP.sm,
  },

  // Sections
  section: {
    marginBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SP.md,
    paddingVertical: 10,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionIcon: {
    opacity: 0.7,
  },
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

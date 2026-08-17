/**
 * More Screen — Brandthread Seller App
 * Hub for operations, growth, store settings and account management.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser, useAuth } from '@clerk/expo';
import { getSetupState, completionPercent, SetupState } from '@/lib/setupStore';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, GREEN_BRIGHT, BLUE, ORANGE,
  RED, GOLD, GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON, SHADOW_PURPLE,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadCard, GradientCard, PrimaryButton,
  SecondaryButton, IconButton, NavigationCard, SectionHeader,
  StatusBadge, NewFeatureBadge, EmptyState, GuidedTip,
} from '@/components/BrandthreadUI';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  desc: string;
  accent: string;
  badge?: boolean;
  route?: string;
}

// ─── Section data ─────────────────────────────────────────────────────────────

const OPERATIONS: NavItem[] = [
  { icon: 'tool',        label: 'Manufacturer Hub', desc: 'Find and manage manufacturers',  accent: PURPLE,       badge: true, route: '/manufacturer-hub' },
  { icon: 'archive',     label: 'Inventory',         desc: 'Track stock levels',             accent: BLUE,   route: '/inventory' },
  { icon: 'truck',       label: 'Shipping',          desc: 'Rates, zones and carriers',      accent: ORANGE },
  { icon: 'credit-card', label: 'Payouts',           desc: 'Bank accounts and earnings',     accent: SUCCESS },
];

const GROWTH: NavItem[] = [
  { icon: 'message-circle', label: 'Messages', desc: 'Read and reply to buyer DMs',   accent: PURPLE,       route: '/seller-inbox' },
  { icon: 'video',        label: 'Content',    desc: 'Posts, drafts and scheduled',   accent: CYAN,         route: '/content' },
  { icon: 'users',        label: 'Customers',  desc: 'Browse your customer list',      accent: PURPLE_LIGHT },
  { icon: 'trending-up',  label: 'Marketing',  desc: 'Campaigns and promotions',       accent: ORANGE,       route: '/(tabs)/marketing' },
  { icon: 'bar-chart-2',  label: 'Analytics',  desc: 'Sales, traffic and insights',    accent: BLUE,         route: '/(tabs)/analytics' },
];

const STORE: NavItem[] = [
  { icon: 'layout', label: 'Store Builder', desc: 'Customize your storefront', accent: PURPLE, route: '/store-builder' },
  { icon: 'grid',   label: 'Collections',   desc: 'Group products',            accent: CYAN,   route: '/store-collections' },
  { icon: 'tag',    label: 'Discounts',     desc: 'Coupon codes and offers',   accent: GOLD },
  { icon: 'globe',  label: 'Domains',       desc: 'Custom domain settings',    accent: BLUE,   route: '/store-domain' },
];

const CREATIVE: NavItem[] = [
  { icon: 'edit-3',      label: 'Design Studio',       desc: 'Create designs and mockups',    accent: PURPLE, route: '/design' },
  { icon: 'camera',      label: 'AI Photoshoot',       desc: 'Generate product photos',       accent: BLUE,   route: '/design-ai-photoshoot' },
  { icon: 'scissors',    label: 'Background Removal',  desc: 'Clean image backgrounds',       accent: CYAN,   route: '/design-bg-removal' },
  { icon: 'trending-up', label: 'Campaign Generator',  desc: 'Create campaign assets',        accent: ORANGE, route: '/design-campaign' },
  { icon: 'layers',      label: 'Brand Assets',        desc: 'Logos, colors and graphics',    accent: GOLD,   route: '/design-brand-assets' },
];

const ACCOUNT: NavItem[] = [
  { icon: 'star',         label: 'Subscription',   desc: 'Manage your Brandthread plan',    accent: GOLD,   badge: true, route: '/subscription' },
  { icon: 'dollar-sign',  label: 'Payouts',        desc: 'Bank account and payout history', accent: SUCCESS, route: '/payouts' },
  { icon: 'link',         label: 'Integrations',   desc: 'Connect third-party services',    accent: PURPLE, route: '/integrations/klaviyo' },
  { icon: 'users',        label: 'Team',           desc: 'Invite collaborators',            accent: BLUE },
  { icon: 'bell',         label: 'Notifications',  desc: 'Push and email preferences',      accent: ORANGE, route: '/notifications-settings' },
  { icon: 'settings',     label: 'Settings',       desc: 'App and account settings',        accent: MUTED,  route: '/settings' },
  { icon: 'help-circle',  label: 'Help & Support', desc: 'Guides, FAQs and contact us',    accent: CYAN,   route: '/help' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { signOut } = useAuth();
  const [setupState, setSetupState] = useState<SetupState | null>(null);

  useEffect(() => {
    getSetupState().then(setSetupState);
  }, []);

  const percent = setupState ? completionPercent(setupState) : 0;

  const firstName = user?.firstName ?? 'Seller';
  const lastName = user?.lastName ?? '';
  const displayName = lastName ? `${firstName} ${lastName}` : firstName;
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const avatarLetter = (user?.firstName?.[0] ?? 'S').toUpperCase();

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    try {
      await signOut();
      await AsyncStorage.removeItem('@brandthread/onboarding_complete');
      router.replace('/sign-in');
    } catch (e) {
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

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const renderSection = (title: string, items: NavItem[]) => (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeaderText}>{title}</Text>
      </View>
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
    </>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 1. USER HEADER */}
        <GradientCard
          glow
          colors={['rgba(139,92,246,0.18)', 'rgba(34,211,238,0.06)']}
          style={styles.userCard}
        >
          <View style={styles.userRow}>
            {/* Avatar */}
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>{avatarLetter}</Text>
            </View>
            {/* User info */}
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

        {/* 2. SETUP PROGRESS */}
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

        {/* 3. SECTIONS */}
        {renderSection('OPERATIONS', OPERATIONS)}
        {renderSection('GROWTH', GROWTH)}
        {renderSection('CREATIVE', CREATIVE)}
        {renderSection('STORE', STORE)}
        {renderSection('ACCOUNT', ACCOUNT)}

        {/* 4. SIGN OUT */}
        <View style={styles.signOutWrap}>
          <SecondaryButton
            label="Sign out"
            accent="#F87171"
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
    marginBottom: SP.sm,
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
  sectionHeaderRow: {
    marginHorizontal: SP.md,
    marginTop: SP.md,
    marginBottom: SP.sm,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: SUBTLE,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  sectionItems: {
    marginHorizontal: SP.md,
    gap: SP.sm,
  },

  // Sign out
  signOutWrap: {
    marginHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: 32,
  },
});

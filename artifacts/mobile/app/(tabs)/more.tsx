import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, Dimensions } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W } = Dimensions.get('window');

interface FeatureItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  color: string;
  badge?: string;
  pinned?: boolean;
}

interface FeatureGroup {
  title: string;
  items: FeatureItem[];
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'Brand & Design',
    items: [
      { label: 'Brand Creation',    icon: 'aperture',        route: '/brand',        color: '#EC4899', badge: 'AI', pinned: true },
      { label: 'AI Design Studio',  icon: 'zap',             route: '/ai-studio',    color: '#F59E0B', badge: 'AI', pinned: true },
      { label: 'Website Builder',   icon: 'layout',          route: '/website',      color: '#0EA5E9', badge: 'Pro' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Manufacturer Hub',       icon: 'tool',         route: '/manufacturer', color: '#8B5CF6' },
      { label: 'Shipping & Fulfillment', icon: 'truck',        route: '/shipping',     color: '#F97316' },
      { label: 'Payments',               icon: 'credit-card',  route: '/payments',     color: '#10B981', pinned: true },
    ],
  },
  {
    title: 'Customers & Finance',
    items: [
      { label: 'CRM',                icon: 'users',        route: '/customers', color: '#EF4444' },
      { label: 'Finance & Reports',  icon: 'bar-chart-2',  route: '/finance',   color: '#06B6D4', pinned: true },
      { label: 'Loyalty & Rewards',  icon: 'star',         route: '/customers', color: '#FBBF24', badge: 'New' },
    ],
  },
  {
    title: 'Business Tools',
    items: [
      { label: 'AI Assistant', icon: 'message-circle', route: '/ai-assistant', color: '#6366F1', badge: 'AI' },
      { label: 'Automation',   icon: 'cpu',             route: '/automation',   color: '#14B8A6' },
      { label: 'Team & Security', icon: 'shield',       route: '/team',         color: '#DC2626' },
    ],
  },
  {
    title: 'Community & Growth',
    items: [
      { label: 'Marketing',           icon: 'send',        route: '/marketing', color: '#F43F5E' },
      { label: 'Community Hub',       icon: 'globe',       route: '/community', color: '#3B82F6' },
      { label: 'Mobile App Builder',  icon: 'smartphone',  route: '/community', color: '#A855F7', badge: 'Pro' },
    ],
  },
];

const ACCOUNT_ITEMS: Array<{ label: string; icon: keyof typeof Feather.glyphMap; value?: string }> = [
  { label: 'Two-Factor Auth', icon: 'lock', value: 'On' },
  { label: 'Audit Logs', icon: 'file-text' },
  { label: 'User Permissions', icon: 'shield' },
];

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  function handleNav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function IconTile({ item }: { item: FeatureItem }) {
    return (
      <TouchableOpacity
        key={item.label}
        onPress={() => handleNav(item.route)}
        activeOpacity={0.7}
        style={styles.tile}
      >
        <View style={styles.tileIconWrap}>
          {item.badge != null && (
            <View
              style={[
                styles.badgeDot,
                { backgroundColor: item.badge === 'AI' ? colors.primary : item.badge === 'New' ? colors.success : colors.mutedForeground },
              ]}
            >
              <Text style={styles.badgeDotText}>{item.badge}</Text>
            </View>
          )}
          <View style={[styles.tileIconCircle, { backgroundColor: item.color + '1F' }]}>
            <Feather name={item.icon} size={22} color={item.color} />
          </View>
        </View>
        <Text style={[styles.tileLabel, { color: colors.foreground }]} numberOfLines={2}>
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={styles.tabsRow}>
          <Text style={[styles.tabText, { color: colors.foreground }]}>All Tools</Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.7}
          style={[styles.helpBtn, { borderColor: colors.border }]}
          onPress={() => Alert.alert('Need help?', 'Browse Brandthread help articles or contact support.', [{ text: 'Got it' }])}
        >
          <Feather name="help-circle" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Plan strip */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleNav('/plans')}
          style={[styles.planStrip, { backgroundColor: colors.primary + '14' }]}
        >
          <Text style={[styles.planStripText, { color: colors.primary }]}>Brandthread Pro · all features unlocked</Text>
          <Feather name="chevron-right" size={16} color={colors.primary} />
        </TouchableOpacity>

        {FEATURE_GROUPS.map((group, gi) => (
          <View key={group.title}>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{group.title.toUpperCase()}</Text>
              <View style={styles.grid}>
                {group.items.map((item) => <IconTile key={item.label} item={item} />)}
              </View>
            </View>
            {gi < FEATURE_GROUPS.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          </View>
        ))}

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Account & Security — list style */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT & SECURITY</Text>
          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {ACCOUNT_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={item.label}
                activeOpacity={0.75}
                style={[styles.listRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (item.label === 'Two-Factor Auth') {
                    Alert.alert('Two-Factor Auth', '2FA is currently enabled on your account.', [
                      { text: 'Disable 2FA', style: 'destructive', onPress: () => {} },
                      { text: 'OK', style: 'cancel' },
                    ]);
                  } else if (item.label === 'User Permissions') {
                    handleNav('/team');
                  } else {
                    Alert.alert(item.label, 'This feature is coming soon in a future update.', [{ text: 'Got it' }]);
                  }
                }}
              >
                <View style={styles.listRowCenterGroup}>
                  <View style={[styles.listIconWrap, { backgroundColor: colors.secondary }]}>
                    <Feather name={item.icon} size={16} color={colors.mutedForeground} />
                  </View>
                  <Text style={[styles.listLabel, { color: colors.foreground }]}>{item.label}</Text>
                  {item.value != null && (
                    <Text style={[styles.listValue, { color: colors.success }]}>{item.value}</Text>
                  )}
                </View>
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} style={styles.listChevron} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const H_PAD = 20;
const GAP = 8;
const TILE_W = (SCREEN_W - H_PAD * 2 - GAP * 3) / 4;

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: H_PAD,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  tabsRow: { flexDirection: 'row', gap: 22, justifyContent: 'center' },
  tabBtn: { paddingBottom: 10, alignItems: 'center' },
  tabText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  tabUnderline: { height: 2, borderRadius: 1, marginTop: 8, alignSelf: 'center' },
  helpBtn: {
    position: 'absolute',
    right: H_PAD,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  planStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: H_PAD,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  planStripText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },

  section: { paddingHorizontal: H_PAD, marginBottom: 20, alignItems: 'center' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14, width: '100%', position: 'relative' },
  sectionHeaderIcon: { position: 'absolute', right: 0 },
  sectionTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.1, marginBottom: 14, textAlign: 'center', alignSelf: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: 18, justifyContent: 'center' },
  tile: { width: TILE_W, alignItems: 'center', gap: 8 },
  tileIconWrap: { position: 'relative' },
  tileIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 1,
  },
  badgeDotText: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#0D0D0D' },
  tileLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'center', lineHeight: 15 },

  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: H_PAD, marginBottom: 20 },

  // List (account section)
  listCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', width: '100%' },
  listRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, position: 'relative' },
  listRowCenterGroup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  listIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  listValue: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  listChevron: { position: 'absolute', right: 14 },
});

import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

interface FeatureItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  badge?: string;
  accent?: boolean;
}

interface FeatureGroup {
  title: string;
  items: FeatureItem[];
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'Brand & Design',
    items: [
      { label: 'Brand Creation', icon: 'aperture', route: '/brand', badge: 'AI', accent: true },
      { label: 'AI Design Studio', icon: 'zap', route: '/ai-studio', badge: 'AI', accent: true },
      { label: 'Website Builder', icon: 'layout', route: '/website', badge: 'Pro' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Manufacturer Hub', icon: 'tool', route: '/manufacturer' },
      { label: 'Shipping & Fulfillment', icon: 'truck', route: '/shipping' },
      { label: 'Payments', icon: 'credit-card', route: '/payments' },
    ],
  },
  {
    title: 'Customers & Finance',
    items: [
      { label: 'CRM', icon: 'users', route: '/customers' },
      { label: 'Finance & Reports', icon: 'bar-chart-2', route: '/finance' },
      { label: 'Loyalty & Rewards', icon: 'star', route: '/customers', badge: 'New' },
    ],
  },
  {
    title: 'Business Tools',
    items: [
      { label: 'AI Assistant', icon: 'message-circle', route: '/ai-assistant', badge: 'AI', accent: true },
      { label: 'Automation', icon: 'cpu', route: '/automation' },
      { label: 'Team & Security', icon: 'shield', route: '/team' },
    ],
  },
  {
    title: 'Community & Growth',
    items: [
      { label: 'Community Hub', icon: 'globe', route: '/community' },
      { label: 'Mobile App Builder', icon: 'smartphone', route: '/community', badge: 'Pro' },
      { label: 'Social Media', icon: 'share-2', route: '/marketing' },
    ],
  },
];

const ACCOUNT_ITEMS: Array<{ label: string; icon: keyof typeof Feather.glyphMap; value?: string }> = [
  { label: 'Two-Factor Auth', icon: 'lock', value: 'On' },
  { label: 'Audit Logs', icon: 'file-text' },
  { label: 'User Permissions', icon: 'shield' },
  { label: 'Backup & Recovery', icon: 'cloud' },
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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 20, paddingBottom: 140, paddingHorizontal: 20 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Page title */}
      <Text style={[styles.pageTitle, { color: colors.foreground }]}>More</Text>
      <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>All Brandthread features</Text>

      {/* Plan card */}
      <View style={[styles.planCard, { backgroundColor: '#1A1500', borderColor: '#C9A96E33' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.planLabel, { color: '#C9A96E88' }]}>CURRENT PLAN</Text>
          <Text style={[styles.planName, { color: colors.primary }]}>Brandthread Pro</Text>
          <Text style={[styles.planSub, { color: colors.mutedForeground }]}>
            All features unlocked · Renews Aug 1
          </Text>
        </View>
        <View style={[styles.planBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.planBadgeText, { color: colors.primaryForeground }]}>PRO</Text>
        </View>
      </View>

      {/* Feature groups — 3-column icon grid */}
      {FEATURE_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>
            {group.title.toUpperCase()}
          </Text>
          <View style={styles.gridRow}>
            {group.items.map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => handleNav(item.route)}
                activeOpacity={0.72}
                style={[
                  styles.gridCard,
                  {
                    backgroundColor: item.accent ? '#1A1500' : colors.card,
                    borderColor: item.accent ? '#C9A96E33' : colors.border,
                  },
                ]}
              >
                {/* Badge dot */}
                {item.badge != null && (
                  <View
                    style={[
                      styles.badgeDot,
                      {
                        backgroundColor:
                          item.badge === 'AI'
                            ? colors.primary
                            : item.badge === 'New'
                            ? colors.success
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    <Text style={styles.badgeDotText}>{item.badge}</Text>
                  </View>
                )}

                <View
                  style={[
                    styles.gridIconWrap,
                    { backgroundColor: item.accent ? '#C9A96E22' : colors.secondary },
                  ]}
                >
                  <Feather
                    name={item.icon}
                    size={20}
                    color={item.accent ? colors.primary : colors.foreground}
                  />
                </View>
                <Text
                  style={[styles.gridLabel, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* Account & Security — list style */}
      <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>ACCOUNT & SECURITY</Text>
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {ACCOUNT_ITEMS.map((item, i) => (
          <TouchableOpacity
            key={item.label}
            activeOpacity={0.75}
            style={[styles.listRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <View style={[styles.listIconWrap, { backgroundColor: colors.secondary }]}>
              <Feather name={item.icon} size={16} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.listLabel, { color: colors.foreground }]}>{item.label}</Text>
            {item.value != null && (
              <Text style={[styles.listValue, { color: colors.success }]}>{item.value}</Text>
            )}
            <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pageTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 24 },

  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    marginBottom: 32,
    gap: 12,
  },
  planLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2, marginBottom: 3 },
  planName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  planSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },
  planBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9 },
  planBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1 },

  group: { marginBottom: 24 },
  groupTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.1, marginBottom: 10, marginLeft: 2 },

  // 3-column grid
  gridRow: { flexDirection: 'row', gap: 10 },
  gridCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 10,
    minHeight: 100,
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeDotText: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#0D0D0D' },
  gridIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    lineHeight: 15,
  },

  // List (account section)
  listCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  listIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  listLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },
  listValue: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});

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
      { label: 'Brand Creation', icon: 'aperture' as const, route: '/brand', badge: 'AI', accent: true },
      { label: 'AI Design Studio', icon: 'zap' as const, route: '/ai-studio', badge: 'AI', accent: true },
      { label: 'Website Builder', icon: 'layout' as const, route: '/website', badge: 'Pro' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Manufacturer Hub', icon: 'tool' as const, route: '/manufacturer' },
      { label: 'Shipping & Fulfillment', icon: 'truck' as const, route: '/shipping' },
      { label: 'Payments', icon: 'credit-card' as const, route: '/payments' },
    ],
  },
  {
    title: 'Customers & Finance',
    items: [
      { label: 'Customer Management', icon: 'users' as const, route: '/customers' },
      { label: 'Finance & Reports', icon: 'bar-chart-2' as const, route: '/finance' },
      { label: 'Loyalty & Rewards', icon: 'star' as const, route: '/customers', badge: 'New' },
    ],
  },
  {
    title: 'Business Tools',
    items: [
      { label: 'AI Assistant', icon: 'message-circle' as const, route: '/ai-assistant', badge: 'AI', accent: true },
      { label: 'Automation', icon: 'cpu' as const, route: '/automation' },
      { label: 'Team Management', icon: 'shield' as const, route: '/team' },
    ],
  },
  {
    title: 'Community & Growth',
    items: [
      { label: 'Community Hub', icon: 'globe' as const, route: '/community' },
      { label: 'Mobile App Builder', icon: 'smartphone' as const, route: '/community', badge: 'Pro' },
      { label: 'Social Media', icon: 'share-2' as const, route: '/marketing' },
    ],
  },
];

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  function handleNav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: colors.foreground }]}>More</Text>
      <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>All Brandthread features</Text>

      {/* Plan Card */}
      <View style={[styles.planCard, { backgroundColor: '#1A1500', borderColor: '#C9A96E44' }]}>
        <View>
          <Text style={[styles.planLabel, { color: '#C9A96E88' }]}>CURRENT PLAN</Text>
          <Text style={[styles.planName, { color: colors.primary }]}>Brandthread Pro</Text>
          <Text style={[styles.planSub, { color: colors.mutedForeground }]}>All features unlocked · Renews Aug 1</Text>
        </View>
        <View style={[styles.planBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.planBadgeText, { color: colors.primaryForeground }]}>PRO</Text>
        </View>
      </View>

      {FEATURE_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>{group.title.toUpperCase()}</Text>
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {group.items.map((item, i) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => handleNav(item.route)}
                activeOpacity={0.75}
                style={[
                  styles.itemRow,
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  item.accent && { backgroundColor: '#C9A96E08' },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: item.accent ? '#C9A96E22' : colors.secondary }]}>
                  <Feather name={item.icon} size={17} color={item.accent ? colors.primary : colors.mutedForeground} />
                </View>
                <Text style={[styles.itemLabel, { color: colors.foreground }]}>{item.label}</Text>
                {item.badge != null && (
                  <View style={[styles.badge, { backgroundColor: item.badge === 'AI' ? '#C9A96E22' : item.badge === 'New' ? '#22C55E22' : colors.secondary }]}>
                    <Text style={[styles.badgeText, { color: item.badge === 'AI' ? colors.primary : item.badge === 'New' ? colors.success : colors.mutedForeground }]}>
                      {item.badge}
                    </Text>
                  </View>
                )}
                <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* Security */}
      <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>ACCOUNT & SECURITY</Text>
      <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Two-Factor Authentication', icon: 'lock' as const, value: 'On' },
          { label: 'Audit Logs', icon: 'file-text' as const },
          { label: 'User Permissions', icon: 'shield' as const },
          { label: 'Backup & Recovery', icon: 'cloud' as const },
        ].map((item, i) => (
          <TouchableOpacity
            key={item.label}
            activeOpacity={0.75}
            style={[styles.itemRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.secondary }]}>
              <Feather name={item.icon} size={17} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.itemLabel, { color: colors.foreground }]}>{item.label}</Text>
            {item.value && <Text style={[styles.valueText, { color: colors.success }]}>{item.value}</Text>}
            <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pageTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  planCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 28 },
  planLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 2 },
  planName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  planSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  planBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  planBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  group: { marginBottom: 20 },
  groupTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  groupCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  valueText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});

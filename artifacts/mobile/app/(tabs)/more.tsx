import React from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG      = '#0A0B0A';
const CARD    = '#111311';
const BORDER  = '#1E221E';
const FG      = '#EAF2ED';
const MUTED   = '#5A6B5C';
const GREEN   = '#39FF88';
const GREEN_D = '#0D2B1A';

// ─── Data ─────────────────────────────────────────────────────────────────────
interface ToolItem {
  label: string;
  desc: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
  iconColor: string;
  iconBg: string;
  badge?: 'AI' | 'Pro' | 'New';
}

interface ToolGroup {
  title: string;
  items: ToolItem[];
}

const GROUPS: ToolGroup[] = [
  {
    title: 'Brand & Design',
    items: [
      {
        label: 'Brand Creation', desc: 'Create your brand identity with AI.',
        icon: 'aperture', route: '/brand',
        iconColor: '#EC4899', iconBg: '#EC489920', badge: 'AI',
      },
      {
        label: 'AI Design Studio', desc: 'Generate stunning designs in seconds.',
        icon: 'zap', route: '/ai-studio',
        iconColor: '#F97316', iconBg: '#F9731620', badge: 'AI',
      },
      {
        label: 'Website Builder', desc: 'Build your store with no code.',
        icon: 'layout', route: '/website',
        iconColor: '#0EA5E9', iconBg: '#0EA5E920', badge: 'Pro',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        label: 'Manufacturer Hub', desc: 'Find and connect with trusted manufacturers.',
        icon: 'tool', route: '/manufacturer',
        iconColor: '#8B5CF6', iconBg: '#8B5CF620',
      },
      {
        label: 'Shipping & Fulfillment', desc: 'Manage orders and delivery seamlessly.',
        icon: 'truck', route: '/shipping',
        iconColor: '#F97316', iconBg: '#F9731620',
      },
      {
        label: 'Payments', desc: 'Track payouts and manage your transactions.',
        icon: 'credit-card', route: '/payments',
        iconColor: '#10B981', iconBg: '#10B98120',
      },
    ],
  },
  {
    title: 'Customers & Finance',
    items: [
      {
        label: 'CRM', desc: 'Manage customer relationships and interactions.',
        icon: 'users', route: '/customers',
        iconColor: '#EF4444', iconBg: '#EF444420',
      },
      {
        label: 'Finance & Reports', desc: 'Track revenue, profit and other key financials.',
        icon: 'bar-chart-2', route: '/finance',
        iconColor: '#06B6D4', iconBg: '#06B6D420',
      },
      {
        label: 'Loyalty & Rewards', desc: 'Reward customers and build brand loyalty.',
        icon: 'star', route: '/plans',
        iconColor: '#FBBF24', iconBg: '#FBBF2420', badge: 'New',
      },
    ],
  },
  {
    title: 'Business Tools',
    items: [
      {
        label: 'AI Assistant', desc: 'Your smart assistant for everything Brandthread.',
        icon: 'message-circle', route: '/ai-assistant',
        iconColor: '#8B5CF6', iconBg: '#8B5CF620', badge: 'AI',
      },
      {
        label: 'Automation', desc: 'Automate tasks and scale your brand effortlessly.',
        icon: 'cpu', route: '/automation',
        iconColor: '#14B8A6', iconBg: '#14B8A620',
      },
      {
        label: 'Team & Security', desc: 'Manage your team and keep your brand secure.',
        icon: 'shield', route: '/team',
        iconColor: '#EF4444', iconBg: '#EF444420',
      },
    ],
  },
];

const ACCOUNT_ITEMS = [
  { label: 'Two-Factor Authentication', icon: 'lock' as const, value: 'On' },
  { label: 'Audit Logs',                icon: 'file-text' as const },
  { label: 'User Permissions',          icon: 'users' as const },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  function go(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* ── Header ── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>All Tools</Text>
          <Text style={s.headerSub}>Everything you need to build, scale, and run your brand.</Text>
        </View>
        <TouchableOpacity
          style={s.helpBtn}
          onPress={() => go('/help')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="help-circle" size={22} color={MUTED} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, paddingTop: 16, gap: 20 }}
      >
        {/* ── Pro Banner ── */}
        <TouchableOpacity style={s.proBanner} activeOpacity={0.85} onPress={() => go('/plans')}>
          <View style={s.proBannerLeft}>
            <View style={s.proIconWrap}>
              <Feather name="award" size={20} color={GREEN} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={s.proTitleRow}>
                <Text style={s.proTitle}>Brandthread Pro</Text>
                <View style={s.proPill}>
                  <Text style={s.proPillText}>Pro</Text>
                </View>
              </View>
              <Text style={s.proSub}>All features unlocked.</Text>
              <View style={s.proLinkRow}>
                <Text style={s.proLink}>View Pro Benefits</Text>
                <Feather name="arrow-right" size={12} color={GREEN} />
              </View>
            </View>
          </View>
          {/* Crown glow graphic */}
          <View style={s.crownWrap}>
            <View style={s.crownGlow} />
            <Feather name="star" size={40} color={GREEN} style={{ opacity: 0.9 }} />
          </View>
        </TouchableOpacity>

        {/* ── Tool Groups ── */}
        {GROUPS.map((group) => (
          <View key={group.title} style={s.group}>
            {/* Section header */}
            <View style={s.groupHeader}>
              <View style={s.groupHeaderLeft}>
                <View style={s.greenDot} />
                <Text style={s.groupTitle}>{group.title}</Text>
              </View>
              <TouchableOpacity onPress={() => go(group.items[0].route)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>

            {/* 3-col card grid */}
            <View style={s.cardGrid}>
              {group.items.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={s.toolCard}
                  activeOpacity={0.75}
                  onPress={() => go(item.route)}
                >
                  {/* Badge */}
                  {item.badge && (
                    <View style={[s.badge, {
                      backgroundColor:
                        item.badge === 'AI'  ? GREEN + 'CC' :
                        item.badge === 'Pro' ? '#0EA5E9CC' :
                                              '#FBBF24CC',
                    }]}>
                      <Text style={s.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                  {/* Icon */}
                  <View style={[s.cardIconWrap, { backgroundColor: item.iconBg }]}>
                    <Feather name={item.icon} size={20} color={item.iconColor} />
                  </View>
                  {/* Text */}
                  <Text style={s.cardLabel} numberOfLines={2}>{item.label}</Text>
                  <Text style={s.cardDesc}  numberOfLines={3}>{item.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* ── Account & Security ── */}
        <View style={s.group}>
          <View style={s.groupHeader}>
            <View style={s.groupHeaderLeft}>
              <Feather name="lock" size={13} color={MUTED} />
              <Text style={s.groupTitle}>Account & Security</Text>
            </View>
          </View>
          <View style={s.listCard}>
            {ACCOUNT_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={item.label}
                style={[s.listRow, i > 0 && s.listRowBorder]}
                activeOpacity={0.75}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (item.label === 'User Permissions')              go('/team');
                  else if (item.label === 'Two-Factor Authentication') go('/security');
                  else if (item.label === 'Audit Logs')               go('/settings');
                  else go('/settings');
                }}
              >
                <View style={s.listIconWrap}>
                  <Feather name={item.icon} size={15} color={MUTED} />
                </View>
                <Text style={s.listLabel}>{item.label}</Text>
                {item.value && <Text style={s.listValue}>{item.value}</Text>}
                <Feather name="chevron-right" size={15} color={MUTED} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },

  // Header
  header:     { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6, gap: 12 },
  headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2, lineHeight: 17 },
  helpBtn:     { marginTop: 4 },

  // Pro banner
  proBanner: {
    backgroundColor: '#0D1A12',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: GREEN + '33',
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  proBannerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 },
  proIconWrap:   { width: 38, height: 38, borderRadius: 10, backgroundColor: GREEN_D, borderWidth: 1, borderColor: GREEN + '44', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  proTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proTitle:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  proPill:       { backgroundColor: GREEN + 'CC', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  proPillText:   { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  proSub:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  proLinkRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  proLink:       { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: GREEN },
  crownWrap:     { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  crownGlow:     { position: 'absolute', width: 70, height: 70, borderRadius: 35, backgroundColor: GREEN, opacity: 0.12 },

  // Groups
  group:       { gap: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greenDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  groupTitle:  { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  viewAll:     { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },

  // Tool cards — 3-col grid
  cardGrid: { flexDirection: 'row', gap: 10 },
  toolCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    gap: 8,
    minHeight: 130,
  },
  badge:        { position: 'absolute', top: 10, right: 10, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText:    { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  cardIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardLabel:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: FG, lineHeight: 16 },
  cardDesc:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 15 },

  // Account list
  listCard:    { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  listRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  listRowBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  listIconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  listLabel:   { fontSize: 14, fontFamily: 'Inter_500Medium', color: FG, flex: 1 },
  listValue:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },
});

import React from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from '@clerk/expo';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06B6D4';
const ORANGE = '#F97316';
const RED    = '#EF4444';

// ─── Menu structure ───────────────────────────────────────────────────────────
interface MenuItem {
  label: string;
  desc:  string;
  icon:  keyof typeof Feather.glyphMap;
  color: string;
  bg:    string;
  route: string;
  badge?: string;
}

interface MenuGroup {
  title: string;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Operations',
    items: [
      { label: 'Manufacturer Hub', desc: 'Find partners & track production.', icon: 'tool',       color: PURPLE, bg: '#2A1A4A', route: '/manufacturer' },
      { label: 'Inventory',        desc: 'Manage stock and restocks.',         icon: 'layers',     color: CYAN,   bg: '#0E2830', route: '/inventory'    },
      { label: 'Store Builder',    desc: 'Customise your online storefront.',  icon: 'layout',     color: BLUE,   bg: '#0E1B30', route: '/store-builder', badge: 'Pro' },
    ],
  },
  {
    title: 'Content & Customers',
    items: [
      { label: 'Content',   desc: 'Create and schedule posts.',           icon: 'video',  color: '#EC4899', bg: '#2A0D22', route: '/content'   },
      { label: 'Customers', desc: 'CRM, orders and lifetime value.',      icon: 'users',  color: GREEN,     bg: '#0D2420', route: '/customers' },
      { label: 'Marketing', desc: 'Discounts, email and automations.',    icon: 'send',   color: ORANGE,    bg: '#2A1508', route: '/(tabs)/marketing', badge: 'New' },
    ],
  },
  {
    title: 'Finance & Growth',
    items: [
      { label: 'Analytics',   desc: 'Sales, traffic and product reports.', icon: 'bar-chart-2', color: BLUE,   bg: '#0E1B30', route: '/(tabs)/analytics'   },
      { label: 'Payouts',     desc: 'Balance, history and bank accounts.', icon: 'dollar-sign', color: GREEN,  bg: '#0D2420', route: '/payments'    },
      { label: 'Subscription',desc: 'Plan, billing and features.',         icon: 'credit-card', color: '#FBBF24', bg: '#2A200A', route: '/plans'    },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', desc: 'Orders, payouts and alerts.',      icon: 'bell',    color: ORANGE, bg: '#2A1508', route: '/notifications-settings' },
      { label: 'Team',          desc: 'Manage roles and permissions.',     icon: 'users',   color: CYAN,   bg: '#0E2830', route: '/team'          },
      { label: 'Integrations',  desc: 'Connect third-party services.',    icon: 'link',    color: PURPLE, bg: '#2A1A4A', route: '/integrations'  },
    ],
  },
];

const BOTTOM_ITEMS = [
  { label: 'Profile',  icon: 'user'        as const, route: '/(tabs)/profile'   },
  { label: 'Settings', icon: 'settings'    as const, route: '/settings'          },
  { label: 'Help',     icon: 'help-circle' as const, route: '/help'              },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  function go(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out of Brandthread?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.multiRemove(['onboarding_complete', 'user_role', 'onboarding_draft', 'splash_seen']);
          router.replace('/sign-in' as never);
        },
      },
    ]);
  }

  const initials = user?.firstName
    ? user.firstName.charAt(0).toUpperCase() + (user.lastName?.charAt(0).toUpperCase() ?? '')
    : 'D';

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.avatarWrap}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.userName}>{user?.firstName ?? 'Devon'} {user?.lastName ?? 'Walker'}</Text>
            <Text style={s.userEmail}>{user?.primaryEmailAddress?.emailAddress ?? 'seller@brandthread.co'}</Text>
          </View>
          <TouchableOpacity
            style={s.editBtn}
            onPress={() => go('/edit-profile')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="edit-2" size={15} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, paddingTop: 8, gap: 20 }}
      >
        {/* ── Subscription banner ── */}
        <TouchableOpacity style={s.proBanner} onPress={() => go('/plans')} activeOpacity={0.85}>
          <View style={[s.proIconWrap]}>
            <Feather name="award" size={20} color={GREEN} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={s.proTitleRow}>
              <Text style={s.proTitle}>Brandthread Pro</Text>
              <View style={s.proPill}><Text style={s.proPillText}>Active</Text></View>
            </View>
            <Text style={s.proSub}>All features unlocked. Renews Aug 14, 2026.</Text>
          </View>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </TouchableOpacity>

        {/* ── Menu groups ── */}
        {MENU_GROUPS.map(group => (
          <View key={group.title} style={s.group}>
            <Text style={s.groupTitle}>{group.title}</Text>
            <View style={s.groupCard}>
              {group.items.map((item, i) => (
                <TouchableOpacity
                  key={item.label}
                  style={[s.menuRow, i > 0 && s.menuBorder]}
                  onPress={() => go(item.route)}
                  activeOpacity={0.8}
                >
                  <View style={[s.menuIcon, { backgroundColor: item.bg }]}>
                    <Feather name={item.icon} size={17} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.menuLabelRow}>
                      <Text style={s.menuLabel}>{item.label}</Text>
                      {item.badge && (
                        <View style={[s.badge, { backgroundColor: item.badge === 'Pro' ? BLUE + 'CC' : GREEN + 'CC' }]}>
                          <Text style={s.badgeText}>{item.badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.menuDesc}>{item.desc}</Text>
                  </View>
                  <Feather name="chevron-right" size={15} color={MUTED} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* ── Account links ── */}
        <View style={s.group}>
          <Text style={s.groupTitle}>More</Text>
          <View style={s.groupCard}>
            {BOTTOM_ITEMS.map((item, i) => (
              <TouchableOpacity
                key={item.label}
                style={[s.simpleRow, i > 0 && s.menuBorder]}
                onPress={() => go(item.route)}
                activeOpacity={0.8}
              >
                <View style={s.simpleIconWrap}>
                  <Feather name={item.icon} size={16} color={MUTED} />
                </View>
                <Text style={s.simpleLabel}>{item.label}</Text>
                <Feather name="chevron-right" size={15} color={MUTED} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.simpleRow, s.menuBorder]}
              onPress={handleLogout}
              activeOpacity={0.8}
            >
              <View style={[s.simpleIconWrap, { backgroundColor: RED + '15' }]}>
                <Feather name="log-out" size={16} color={RED} />
              </View>
              <Text style={[s.simpleLabel, { color: RED }]}>Log out</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={s.version}>Brandthread v2.0.0 · Seller Dashboard</Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 6 },
  avatarWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  avatarText:{ fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  userName:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  userEmail: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  editBtn:   { padding: 6 },

  proBanner: {
    backgroundColor: '#0D1A12', borderRadius: 18, borderWidth: 1, borderColor: GREEN + '33',
    padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  proIconWrap: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#0F2A1A', borderWidth: 1, borderColor: GREEN + '33', alignItems: 'center', justifyContent: 'center' },
  proTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proTitle:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  proPill:     { backgroundColor: GREEN, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proPillText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  proSub:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  group:      { gap: 8 },
  groupTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase', marginLeft: 4 },
  groupCard:  { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },

  menuRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  menuBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  menuIcon:   { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  menuLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  menuLabel:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  menuDesc:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  badge:      { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText:  { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  simpleRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  simpleIconWrap:{ width: 34, height: 34, borderRadius: 10, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  simpleLabel:   { fontSize: 14, fontFamily: 'Inter_500Medium', color: FG },

  version: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginTop: 4 },
});

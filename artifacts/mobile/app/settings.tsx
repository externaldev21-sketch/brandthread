import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

interface SettingsItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route?: string;
}

interface SettingsGroup {
  title: string;
  items: SettingsItem[];
}

const GROUPS: SettingsGroup[] = [
  {
    title: 'App settings',
    items: [
      { label: 'Push notifications', icon: 'bell', route: '/push-notifications' },
      { label: 'App icon', icon: 'smartphone', route: '/app-icon' },
      { label: 'Biometric unlock', icon: 'unlock', route: '/biometric-unlock' },
    ],
  },
  {
    title: 'Store settings',
    items: [
      { label: 'General', icon: 'home', route: '/general-settings' },
      { label: 'Plan', icon: 'file-text', route: '/plan-details' },
      { label: 'Billing', icon: 'clipboard', route: '/billing' },
      { label: 'Users', icon: 'users', route: '/users' },
      { label: 'Roles', icon: 'users', route: '/roles' },
      { label: 'Security', icon: 'shield', route: '/security' },
      { label: 'Payments', icon: 'credit-card', route: '/payments' },
      { label: 'Checkout', icon: 'shopping-cart', route: '/checkout' },
      { label: 'Customer accounts', icon: 'user', route: '/customer-accounts' },
      { label: 'Shipping and delivery', icon: 'truck', route: '/shipping-delivery' },
      { label: 'Taxes and duties', icon: 'percent' },
      { label: 'Locations', icon: 'map-pin' },
      { label: 'Apps', icon: 'grid' },
      { label: 'Sales channels', icon: 'settings' },
      { label: 'Domains', icon: 'globe' },
      { label: 'Customer events', icon: 'activity' },
      { label: 'Notifications', icon: 'bell' },
      { label: 'Metafields and metaobjects', icon: 'database' },
      { label: 'Languages', icon: 'message-square' },
      { label: 'Customer privacy', icon: 'lock' },
      { label: 'Policies', icon: 'file' },
      { label: 'Acknowledgements', icon: 'code' },
    ],
  },
];

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleClose() {
    haptic();
    router.back();
  }

  function handleItem(item: SettingsItem) {
    haptic();
    if (item.route) router.push(item.route as never);
  }

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
                  <Feather name={item.icon} size={17} color={colors.foreground} style={{ width: 22 }} />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        <Text style={[styles.versionText, { color: colors.mutedForeground }]}>Brandthread v1.0.0</Text>
      </ScrollView>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  group: { marginBottom: 22 },
  groupTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14 },
  rowLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },
  versionText: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
});

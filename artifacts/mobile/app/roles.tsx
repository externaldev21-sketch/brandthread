import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { Alert } from 'react-native';

// Fallback role data if API not connected
const DEFAULT_ROLES = [
  { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access to all features', staffCount: 1 },
  { key: 'admin', name: 'Admin', group: 'Organization', description: 'Products, orders, inventory, analytics, customers, marketing, payouts and team', staffCount: 0 },
  { key: 'finance', name: 'Finance', group: 'Store', description: 'Balance, payouts, transactions and statements', staffCount: 0 },
  { key: 'orders', name: 'Orders', group: 'Store', description: 'Orders, fulfillment and inventory', staffCount: 0 },
  { key: 'marketing', name: 'Marketing', group: 'Store', description: 'Ads, boosts and discount codes', staffCount: 0 },
  { key: 'viewer', name: 'Viewer', group: 'Store', description: 'Read-only analytics and store data', staffCount: 0 },
];

export default function RolesScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [roles, setRoles] = useState(DEFAULT_ROLES);

  useEffect(() => {
    api.team.roles().then(r => { if (r?.length) setRoles(r); }).catch(() => {});
  }, []);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Roles"
        rightElement={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => { haptic(); router.push('/team' as never); }}
              activeOpacity={0.7}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessibilityLabel="Invite a team member"
            >
              <Feather name="plus" size={17} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                haptic();
                Alert.alert('Roles', 'Permissions are enforced per role on the server — team members only see and do what their role allows.', [
                  { text: 'Manage team', onPress: () => router.push('/team' as never) },
                  { text: 'OK', style: 'cancel' },
                ]);
              }}
              activeOpacity={0.7}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessibilityLabel="About roles"
            >
              <Feather name="more-horizontal" size={17} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.toolbarRow}>
          <View style={[styles.allPill, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.allPillText, { color: colors.foreground }]}>All</Text>
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
            <Feather name="sliders" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={styles.listWrap}>
          {roles.map((role: any, i) => (
            <TouchableOpacity
              key={role.name}
              onPress={() => {
                haptic();
                router.push(`/users?role=${role.key ?? role.name.toLowerCase()}` as never);
              }}
              activeOpacity={0.7}
              style={[styles.roleRow, i !== roles.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.roleName, { color: colors.foreground }]}>{role.name}</Text>
                <Text style={[styles.roleSub, { color: colors.mutedForeground }]}>
                  {role.group} · {role.staffCount ?? 0} staff{role.pendingCount ? ` · ${role.pendingCount} invited` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.footerNote, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Learn more about <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>roles</Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  allPill: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  allPillText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  iconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  listWrap: { paddingHorizontal: 20 },
  roleRow: { paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  roleName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  roleSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  footerNote: { paddingVertical: 18, alignItems: 'center', marginTop: 4 },
  footerText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
});

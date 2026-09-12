import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';

// Fallback role data if API not connected
const DEFAULT_ROLES = [
  { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access to all features', staffCount: 1 },
  { key: 'manager', name: 'Manager', group: 'Store', description: 'Products, orders, inventory', staffCount: 0 },
  { key: 'staff', name: 'Staff', group: 'Store', description: 'Fulfillment and shipping only', staffCount: 0 },
];

export default function RolesScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [bannerVisible, setBannerVisible] = useState(true);
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
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="plus" size={17} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="more-horizontal" size={17} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {bannerVisible && (
          <View style={[styles.banner, { backgroundColor: colors.primary + '14', borderBottomColor: colors.primary + '33' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.foreground }]}>POS roles update</Text>
              <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
                User management and device setup permissions in previous POS roles are now replaced with new system roles. Only specific administrators can create and edit POS roles.{' '}
                <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>Learn more</Text>
              </Text>
            </View>
            <TouchableOpacity onPress={() => { haptic(); setBannerVisible(false); }} activeOpacity={0.7}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

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
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  bannerTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  bannerBody: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
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

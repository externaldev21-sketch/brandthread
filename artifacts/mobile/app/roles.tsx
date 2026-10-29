import { haptic as emitHaptic } from '@/lib/haptics';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { Alert } from 'react-native';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { RetryRow } from '@/components/ui/RetryRow';
import { ROLE_FILTERS, filterRoles, permissionSummary, roleFilterLabel, type RoleFilter, type RoleRow } from '@/lib/rolesFilter';

import { FONT, FS } from '@/lib/theme';
// Role definitions shown while the live list (with member counts) loads or
// if it fails. No member counts here: those only come from the server.
const DEFAULT_ROLES: RoleRow[] = [
  { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access to all features including billing, payouts, and team management', permissions: ['*'] },
  { key: 'admin', name: 'Admin', group: 'Organization', description: 'Manage products, orders, inventory, analytics, customers, marketing, payouts and the team', permissions: ['products', 'orders', 'inventory', 'analytics', 'customers', 'marketing', 'payouts', 'team'] },
  { key: 'finance', name: 'Finance', group: 'Store', description: 'View balance, payouts, transactions and statements', permissions: ['payouts', 'analytics'] },
  { key: 'orders', name: 'Orders', group: 'Store', description: 'Manage orders, fulfillment and inventory', permissions: ['orders', 'inventory'] },
  { key: 'marketing', name: 'Marketing', group: 'Store', description: 'Manage ads, boosts and discount codes', permissions: ['marketing', 'analytics'] },
  { key: 'viewer', name: 'Viewer', group: 'Store', description: 'Read-only access to analytics and store data', permissions: ['analytics'] },
];

export default function RolesScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [roles, setRoles] = useState<RoleRow[]>(DEFAULT_ROLES);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const load = useCallback(() => {
    setLoadError(false);
    api.team.roles()
      .then(r => {
        if (Array.isArray(r) && r.length) setRoles(r);
        setCountsLoaded(true);
      })
      .catch(() => setLoadError(true));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const visibleRoles = useMemo(() => filterRoles(roles, query, filter), [roles, query, filter]);


  function openFilter() {
    emitHaptic('select');
    setFilterSheetOpen(true);
  }

  function toggleSearch() {
    emitHaptic('select');
    if (searchOpen) setQuery('');
    setSearchOpen(!searchOpen);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Roles"
        rightElement={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => { emitHaptic('select'); router.push('/team' as never); }}
              activeOpacity={0.7}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              accessibilityLabel="Invite a team member"
            >
              <Feather name="plus" size={17} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                emitHaptic('select');
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.toolbarRow}>
          <TouchableOpacity
            onPress={filter === 'all' ? openFilter : () => { emitHaptic('select'); setFilter('all'); }}
            activeOpacity={0.7}
            style={[styles.allPill, { backgroundColor: colors.secondary, flexDirection: 'row', alignItems: 'center', gap: 6 }]}
            accessibilityRole="button"
            accessibilityLabel={filter === 'all' ? 'Filter roles' : `Filter: ${roleFilterLabel(filter)}. Tap to clear`}
          >
            <Text style={[styles.allPillText, { color: colors.foreground }]}>{roleFilterLabel(filter)}</Text>
            {filter !== 'all' && <Feather name="x" size={12} color={colors.foreground} />}
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={toggleSearch}
            activeOpacity={0.7}
            style={[styles.iconBtn, { borderColor: searchOpen ? colors.foreground : colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Close search' : 'Search roles'}
          >
            <Feather name={searchOpen ? 'x' : 'search'} size={16} color={searchOpen ? colors.foreground : colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openFilter}
            activeOpacity={0.7}
            style={[styles.iconBtn, { borderColor: filter !== 'all' ? colors.foreground : colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Filter roles"
          >
            <Feather name="sliders" size={16} color={filter !== 'all' ? colors.foreground : colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {searchOpen && (
          <View style={styles.searchWrap}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search roles or permissions"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              accessibilityLabel="Search roles"
            />
          </View>
        )}

        {loadError && (
          <View style={styles.listWrap}>
            <RetryRow label="Couldn't load team counts" onRetry={load} />
          </View>
        )}

        <View style={styles.listWrap}>
          {visibleRoles.length === 0 ? (
            <Text style={[styles.roleSub, { color: colors.mutedForeground, paddingVertical: 14 }]}>
              No roles match{query.trim() ? ` "${query.trim()}"` : ''}.
            </Text>
          ) : visibleRoles.map((role, i) => (
            <TouchableOpacity
              key={role.name}
              onPress={() => {
                emitHaptic('select');
                router.push(`/users?role=${role.key ?? role.name.toLowerCase()}` as never);
              }}
              activeOpacity={0.7}
              style={[styles.roleRow, i !== visibleRoles.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.roleName, { color: colors.foreground }]}>{role.name}</Text>
                <Text style={[styles.roleSub, { color: colors.mutedForeground }]}>
                  {role.group}
                  {countsLoaded ? ` · ${role.staffCount ?? 0} staff${role.pendingCount ? ` · ${role.pendingCount} invited` : ''}` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.footerNote, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Learn more about{' '}
            <Text
              style={{ textDecorationLine: 'underline' }}
              onPress={() => { emitHaptic('select'); setLearnMoreOpen(v => !v); }}
              accessibilityRole="button"
            >
              roles
            </Text>
          </Text>
          {learnMoreOpen && (
            <View style={styles.learnMore}>
              <Text style={[styles.learnMoreText, { color: colors.foreground }]}>
                Each teammate gets one role. The role decides what they can see and change in your store, and Brandthread checks it on the server for every action, not just in the app.
              </Text>
              {roles.map(role => (
                <View key={role.name} style={styles.learnMoreRow}>
                  <Text style={[styles.roleName, { color: colors.foreground }]}>{role.name}</Text>
                  {role.description ? <Text style={[styles.roleSub, { color: colors.mutedForeground }]}>{role.description}</Text> : null}
                  {permissionSummary(role.permissions) ? (
                    <Text style={[styles.roleSub, { color: colors.mutedForeground }]}>Access: {permissionSummary(role.permissions)}</Text>
                  ) : null}
                </View>
              ))}
              <Text style={[styles.learnMoreText, { color: colors.mutedForeground }]}>
                To change someone's role, open the role, find the member and tap Change Role. Invites expire after 7 days.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <OptionSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter roles"
        options={ROLE_FILTERS.map(f => ({ id: f.key, label: f.label }))}
        selectedId={filter}
        onSelect={(id) => { setFilter(id as RoleFilter); setFilterSheetOpen(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  allPill: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  allPillText: { fontSize: 13, fontFamily: FONT.semibold },
  iconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { paddingHorizontal: 20, paddingBottom: 8 },
  searchInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: FS.base, fontFamily: FONT.regular },
  listWrap: { paddingHorizontal: 20 },
  roleRow: { paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  roleName: { fontSize: FS.base, fontFamily: FONT.semibold },
  roleSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  footerNote: { paddingVertical: 18, alignItems: 'center', marginTop: 4 },
  footerText: { fontSize: 13, fontFamily: FONT.regular },
  learnMore: { alignSelf: 'stretch', paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  learnMoreText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  learnMoreRow: { gap: 1 },
});

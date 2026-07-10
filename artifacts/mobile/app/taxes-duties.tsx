import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Switch, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type TaxKind = 'Shopify Tax' | 'Manual Tax' | 'Basic Tax';

const REGIONS: { name: string; flag: string; kind: TaxKind }[] = [
  { name: 'United States', flag: '🇺🇸', kind: 'Shopify Tax' },
  { name: 'Algeria', flag: '🇩🇿', kind: 'Manual Tax' },
  { name: 'Argentina', flag: '🇦🇷', kind: 'Manual Tax' },
  { name: 'Australia', flag: '🇦🇺', kind: 'Basic Tax' },
  { name: 'Bahrain', flag: '🇧🇭', kind: 'Manual Tax' },
  { name: 'Bermuda', flag: '🇧🇲', kind: 'Manual Tax' },
  { name: 'Canada', flag: '🇨🇦', kind: 'Shopify Tax' },
  { name: 'Chile', flag: '🇨🇱', kind: 'Manual Tax' },
  { name: 'China', flag: '🇨🇳', kind: 'Manual Tax' },
  { name: 'Colombia', flag: '🇨🇴', kind: 'Manual Tax' },
  { name: 'Egypt', flag: '🇪🇬', kind: 'Manual Tax' },
  { name: 'European Union', flag: '🇪🇺', kind: 'Shopify Tax' },
  { name: 'Hong Kong SAR', flag: '🇭🇰', kind: 'Manual Tax' },
  { name: 'Indonesia', flag: '🇮🇩', kind: 'Manual Tax' },
  { name: 'Isle of Man', flag: '🇮🇲', kind: 'Manual Tax' },
];

export default function TaxesDutiesScreen() {
  const colors = useColors();
  const [search, setSearch] = useState('');
  const [dutiesEnabled, setDutiesEnabled] = useState(false);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const filtered = useMemo(
    () => REGIONS.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [search]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Taxes and duties" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax service</Text>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: colors.foreground }]}>Manage</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.serviceRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.serviceIcon, { backgroundColor: '#22C55E' }]}>
              <Feather name="dollar-sign" size={13} color="#FFFFFF" />
            </View>
            <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Brandthread tax services</Text>
            <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
              <Text style={[styles.onPillText, { color: colors.success }]}>Active</Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax regions</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Areas where your customers will pay tax, and where you will collect and remit. Create a{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>shipping zone</Text> to add a new tax region. If you're unsure about your tax liability, check with a tax professional.
          </Text>

          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: colors.secondary }]}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
              />
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.sortBtn, { borderColor: colors.border }]}>
              <Feather name="arrow-up" size={13} color={colors.mutedForeground} />
              <Feather name="arrow-down" size={13} color={colors.mutedForeground} style={{ marginLeft: -6 }} />
            </TouchableOpacity>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {filtered.map((r, i) => (
              <TouchableOpacity
                key={r.name}
                onPress={haptic}
                activeOpacity={0.7}
                style={[styles.regionRow, i !== filtered.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <Text style={styles.flag}>{r.flag}</Text>
                <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>{r.name}</Text>
                <Text style={[styles.kindText, { color: colors.mutedForeground }]}>{r.kind}</Text>
              </TouchableOpacity>
            ))}
            {filtered.length === 0 && (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>No regions match "{search}"</Text>
              </View>
            )}
          </View>

          <View style={styles.pagerRow}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.reportRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="bar-chart-2" size={17} color={colors.foreground} style={styles.rowIcon} />
            <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Global collected tax report</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Duties and import taxes</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>

          <View style={[styles.dutiesRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Collect duties and import taxes at checkout</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Prevent surprise costs for customers by collecting duties and import taxes upfront
              </Text>
            </View>
            <Switch
              value={dutiesEnabled}
              onValueChange={() => { haptic(); setDutiesEnabled((v) => !v); }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
            />
          </View>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              <Text style={{ textDecorationLine: 'underline', color: colors.primary }} onPress={haptic}>Delivered duty paid (DDP)</Text>{' '}
              shipping labels are only available when you ship from some countries.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 14, lineHeight: 17 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  divider: { height: 10 },
  manageBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  manageBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14 },
  serviceIcon: { width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 },
  onPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  onPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  searchBox: { flex: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { fontSize: 14, fontFamily: 'Inter_400Regular', padding: 0 },
  sortBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  flag: { fontSize: 20 },
  kindText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  pagerRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pagerBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
  rowIcon: { width: 20 },
  dutiesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginTop: 12 },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
});

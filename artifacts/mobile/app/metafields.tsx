/**
 * Brandthread — Metafields and Metaobjects
 * Shows real counts of custom field definitions per resource type.
 */
import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

const DEFINITIONS: { key: string; icon: keyof typeof Feather.glyphMap; label: string }[] = [
  { key: 'products',          icon: 'tag',      label: 'Products' },
  { key: 'variants',          icon: 'copy',     label: 'Variants' },
  { key: 'collections',       icon: 'tag',      label: 'Collections' },
  { key: 'customers',         icon: 'user',     label: 'Customers' },
  { key: 'orders',            icon: 'inbox',    label: 'Orders' },
  { key: 'draft-orders',      icon: 'edit-3',   label: 'Draft orders' },
  { key: 'companies',         icon: 'briefcase',label: 'Companies' },
  { key: 'company-locations', icon: 'map',      label: 'Company locations' },
  { key: 'locations',         icon: 'map-pin',  label: 'Locations' },
  { key: 'transfers',         icon: 'shuffle',  label: 'Transfers' },
  { key: 'pages',             icon: 'file',     label: 'Pages' },
  { key: 'blogs',             icon: 'edit-2',   label: 'Blogs' },
  { key: 'blog-posts',        icon: 'edit',     label: 'Blog posts' },
  { key: 'markets',           icon: 'globe',    label: 'Markets' },
  { key: 'shop',              icon: 'home',     label: 'Shop' },
];

export default function MetafieldsScreen() {
  const colors = useColors();
  const api = useApi();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.seller.metafieldCounts() as any;
      setCounts(data.counts ?? {});
    } catch {
      setCounts({});
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Metafields and metaobjects" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Metafield definitions */}
        <View style={s.section}>
          <View style={s.rowStart}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Metafield definitions</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Add a custom piece of data to a specific part of your store.
          </Text>

          {loading ? (
            <View style={s.loadingRow}><ActivityIndicator size="small" color={colors.primary} /></View>
          ) : (
            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {DEFINITIONS.map((def, i) => {
                const count = counts[def.key] ?? 0;
                return (
                  <TouchableOpacity
                    key={def.key}
                    onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                    activeOpacity={0.7}
                    style={[s.row, i !== DEFINITIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  >
                    <Feather name={def.icon} size={17} color={colors.foreground} style={s.rowIcon} />
                    <Text style={[s.rowLabel, { color: colors.foreground, flex: 1 }]}>{def.label}</Text>
                    {count > 0 ? (
                      <View style={[s.countBadge, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
                        <Text style={[s.countBadgeText, { color: colors.primary }]}>{count}</Text>
                      </View>
                    ) : (
                      <Text style={[s.countText, { color: colors.mutedForeground }]}>0</Text>
                    )}
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Metaobjects section */}
        <View style={[s.divider, { backgroundColor: colors.secondary }]} />
        <View style={s.section}>
          <View style={s.rowStart}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Metaobject definitions</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Metaobjects let you group fields and connect them to different parts of your store.
          </Text>
          <TouchableOpacity
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            activeOpacity={0.7}
            style={[s.addMetaBtn, { borderColor: colors.primary, backgroundColor: colors.accent }]}
          >
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={[s.addMetaBtnText, { color: colors.primary }]}>Add definition</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17, marginBottom: 14 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  loadingRow: { alignItems: 'center', paddingVertical: 20 },
  divider: { height: 8 },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
  rowIcon: { marginRight: 12 },
  rowLabel: { fontSize: 14, fontFamily: FONT.semibold },
  countBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  countBadgeText: { fontSize: 11, fontFamily: FONT.semibold },
  countText: { fontSize: 13, fontFamily: FONT.regular },
  addMetaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  addMetaBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
});

import { haptic } from '@/lib/haptics';
/**
 * Brandthread — Metafields
 * Shows real counts of custom field definitions per resource type; each row
 * opens metafield-definitions.tsx to add / edit / delete that resource's
 * fields. Reached from the Products tab "…" menu.
 *
 * Metaobjects have no backend yet, so that section stays hidden
 * (METAOBJECTS_AVAILABLE) instead of showing a button that does nothing.
 */
import React, { useState, useCallback } from 'react';
import { Redirect } from 'expo-router';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useApi } from '@/lib/api';
import { SectionError } from '@/components/InlineFeedback';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

const DEFINITIONS: { key: string; icon: IconName; label: string }[] = [
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

// No metaobject API exists yet (needs-Dev) — keep the section out of the UI.
const METAOBJECTS_AVAILABLE = false;

export default function MetafieldsScreen() {
  if (!__DEV__) return <Redirect href={'/' as never} />;
  return <MetafieldsScreenContent />;
}

function MetafieldsScreenContent() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.seller.metafieldCounts() as any;
      setCounts(data.counts ?? {});
    } catch {
      setCounts({});
      setError('Could not load your custom fields.');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Metafields" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Metafield definitions */}
        <View style={s.section}>
          <View style={s.rowStart}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Metafield definitions</Text>
            <Icon name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Add a custom piece of data to a specific part of your store.
          </Text>

          {loading ? (
            <View style={s.loadingRow}><ActivityIndicator size="small" color={colors.primary} /></View>
          ) : error ? (
            <SectionError message={error} onRetry={() => { void load(); }} />
          ) : (
            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {DEFINITIONS.map((def, i) => {
                const count = counts[def.key] ?? 0;
                return (
                  <TouchableOpacity
                    key={def.key}
                    onPress={() => {
                      haptic('select');
                      router.push(`/metafield-definitions?resource=${encodeURIComponent(def.key)}&label=${encodeURIComponent(def.label)}` as never);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${def.label} custom fields`}
                    style={[s.row, i !== DEFINITIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  >
                    <Icon name={def.icon} size={17} color={colors.foreground} style={s.rowIcon} />
                    <Text style={[s.rowLabel, { color: colors.foreground, flex: 1 }]}>{def.label}</Text>
                    {count > 0 ? (
                      <View style={[s.countBadge, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
                        <Text style={[s.countBadgeText, { color: colors.primary }]}>{count}</Text>
                      </View>
                    ) : (
                      <Text style={[s.countText, { color: colors.mutedForeground }]}>0</Text>
                    )}
                    <Icon name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Metaobjects section — hidden until a metaobject API exists */}
        {METAOBJECTS_AVAILABLE && (<>
        <View style={[s.divider, { backgroundColor: colors.secondary }]} />
        <View style={s.section}>
          <View style={s.rowStart}>
            <Text style={[s.sectionTitle, { color: colors.foreground }]}>Metaobject definitions</Text>
            <Icon name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Metaobjects let you group fields and connect them to different parts of your store.
          </Text>
          <TouchableOpacity
            onPress={() => {}}
            activeOpacity={0.7}
            style={[s.addMetaBtn, { borderColor: colors.primary, backgroundColor: colors.accent }]}
          >
            <Icon name="plus" size={16} color={colors.primary} />
            <Text style={[s.addMetaBtnText, { color: colors.primary }]}>Add definition</Text>
          </TouchableOpacity>
        </View>
        </>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, marginBottom: 6 },
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 16, marginBottom: 14 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  loadingRow: { alignItems: 'center', paddingVertical: 20 },
  divider: { height: 8 },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
  rowIcon: { marginRight: 12 },
  rowLabel: { fontSize: 15, fontFamily: FONT.semibold },
  countBadge: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  countBadgeText: { fontSize: 11, fontFamily: FONT.semibold },
  countText: { fontSize: 13, fontFamily: FONT.regular, fontVariant: ['tabular-nums'] },
  addMetaBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  addMetaBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
});

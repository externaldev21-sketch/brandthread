/**
 * Apply a size chart template to several products at once.
 * Route: /size-chart-template-apply?id=<templateId>
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Header } from '@/components/layout';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, GUTTER, ICON, RADIUS, SP } from '@/lib/theme';
import { crispPx } from '@/lib/crispPixel';

type Row = { id: string; name: string; status: string; images?: string[] };

export default function SizeChartTemplateApplyScreen() {
  const colors = useColors();
  const router = useRouter();
  const tabBar = useTabBarMetrics();
  const api = useApi();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.products.list() as Promise<Row[]>, api.sizeChartTemplates.get(id)])
      .then(([list, tpl]) => {
        if (!live) return;
        const activeRows = (Array.isArray(list) ? list : []).filter((p) => p.status !== 'archived');
        setRows(activeRows);
        const visibleIds = new Set(activeRows.map((p) => p.id));
        setSelected(new Set(tpl.products.map((p) => p.id).filter((pid) => visibleIds.has(pid))));
      })
      .catch(() => { if (live) Alert.alert('Could not load products'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, id]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  function toggle(pid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

  async function apply() {
    setApplying(true);
    try {
      await api.sizeChartTemplates.apply(id, [...selected]);
      goBackOr(router);
    } catch {
      Alert.alert('Could not apply', 'Try again in a moment.');
    } finally {
      setApplying(false);
    }
  }

  const s = makeStyles(colors);

  return (
    <View style={s.screen}>
      <Header title="Apply to products" onBack={() => goBackOr(router)} dividerVariant="none" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <>
          <TextInput
            style={s.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search products"
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
          />
          <FlatList
            data={visible}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: tabBar.occupiedHeight + 96 }}
            ListEmptyComponent={<Text style={s.empty}>{rows.length === 0 ? 'No products yet' : 'No products match'}</Text>}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <TouchableOpacity style={s.row} onPress={() => toggle(item.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  {item.images?.[0]
                    ? <CachedImage source={{ uri: item.images[0] }} style={s.thumb} />
                    : <View style={[s.thumb, s.thumbEmpty]}><Feather name="image" size={ICON.sm} color={colors.mutedForeground} /></View>}
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  <View style={[s.check, on && s.checkOn]}>
                    {on ? <Feather name="check" size={14} color={colors.background} /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
          <View style={[s.footer, { paddingBottom: tabBar.occupiedHeight + SP.sm }]}>
            <PrimaryButton
              label={selected.size === 0 ? 'Choose products' : `Apply to ${selected.size} product${selected.size === 1 ? '' : 's'}`}
              onPress={apply}
              loading={applying}
              disabled={applying || selected.size === 0}
            />
          </View>
        </>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    search: { marginHorizontal: GUTTER, marginVertical: SP.sm, minHeight: 44, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 64, paddingVertical: SP.sm },
    thumb: { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: c.card },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    name: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
    check: { width: 24, height: 24, borderRadius: 12, borderWidth: crispPx(1.5), borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: c.foreground, borderColor: c.foreground },
    empty: { textAlign: 'center', marginTop: SP.xl, fontFamily: FONT.regular, fontSize: FS.base, color: c.mutedForeground },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: SP.sm, backgroundColor: c.background },
  });
}

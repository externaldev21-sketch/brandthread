/**
 * Size chart templates — seller list of reusable charts plus starter presets.
 *
 * Route: /size-chart-templates
 *   ?productId=<uuid>  pick mode: tapping a template copies it onto that
 *                      product and returns to its size chart editor.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, GUTTER, ICON, RADIUS, SP } from '@/lib/theme';
import { chartSummary } from '@/lib/sizeChartUnits';
import type { SizeChartPreset, SizeChartTemplateSummary } from '@/lib/sizeChartTypes';

export default function SizeChartTemplatesScreen() {
  const colors = useColors();
  const router = useRouter();
  const tabBar = useTabBarMetrics();
  const api = useApi();
  const { productId } = useLocalSearchParams<{ productId?: string }>();

  const [templates, setTemplates] = useState<SizeChartTemplateSummary[]>([]);
  const [presets, setPresets] = useState<SizeChartPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api.sizeChartTemplates.list()
      .then((r) => { setTemplates(r.templates); setPresets(r.presets); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pick(t: SizeChartTemplateSummary) {
    if (!productId) { router.push(`/size-chart-template-edit?id=${t.id}` as never); return; }
    setApplying(t.id);
    try {
      await api.sizeChartTemplates.apply(t.id, [productId]);
      goBackOr(router);
    } catch {
      Alert.alert('Could not apply', 'Try again in a moment.');
    } finally {
      setApplying(null);
    }
  }

  function openPreset(p: SizeChartPreset) {
    router.push(`/size-chart-template-edit?preset=${p.key}${productId ? `&productId=${productId}` : ''}` as never);
  }

  const s = makeStyles(colors);

  return (
    <View style={s.screen}>
      <Header
        title="Size charts"
        dividerVariant="none"
        onBack={() => goBackOr(router)}
        actions={productId ? [] : [{
          icon: 'plus',
          accessibilityLabel: 'New size chart',
          onPress: () => router.push('/size-chart-template-edit' as never),
        }]}
      />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : failed ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>Couldn't load your size charts</Text>
          <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={s.retry} accessibilityRole="button">
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: tabBar.occupiedHeight + SP.xl }]} showsVerticalScrollIndicator={false}>
          {templates.length > 0 && (
            <>
              <Text style={s.section}>Your charts</Text>
              <View style={s.group}>
                {templates.map((t, i) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[s.row, i > 0 && s.rowDivider]}
                    onPress={() => pick(t)}
                    disabled={applying !== null}
                    accessibilityRole="button"
                    accessibilityLabel={t.name}
                  >
                    <View style={s.rowBody}>
                      <Text style={s.rowTitle} numberOfLines={1}>{t.name}</Text>
                      <Text style={s.rowMeta}>
                        {chartSummary(t.chart)}
                        {t.productCount ? ` · ${t.productCount} product${t.productCount === 1 ? '' : 's'}` : ''}
                      </Text>
                    </View>
                    {applying === t.id
                      ? <ActivityIndicator color={colors.foreground} />
                      : <Icon name={productId ? 'check' : 'chevron-right'} size={ICON.sm} color={colors.mutedForeground} />}
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={s.section}>{templates.length > 0 ? 'Start from a preset' : 'Presets'}</Text>
          <View style={s.group}>
            {presets.map((p, i) => (
              <TouchableOpacity
                key={p.key}
                style={[s.row, i > 0 && s.rowDivider]}
                onPress={() => openPreset(p)}
                accessibilityRole="button"
                accessibilityLabel={p.name}
              >
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{p.name}</Text>
                  <Text style={s.rowMeta}>{chartSummary(p.chart)}</Text>
                </View>
                <Icon name="chevron-right" size={ICON.sm} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md },
    content: { paddingHorizontal: GUTTER, paddingTop: SP.sm },
    section: { fontFamily: FONT.semibold, fontSize: FS.meta, color: c.mutedForeground, marginTop: SP.md, marginBottom: SP.sm, letterSpacing: 0.4, textTransform: 'uppercase' },
    group: { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, minHeight: 64, paddingVertical: SP.sm },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
    rowMeta: { fontFamily: FONT.regular, fontSize: FS.sm, color: c.mutedForeground },
    emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
    retry: { paddingHorizontal: SP.lg, height: 44, justifyContent: 'center', borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border },
    retryText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: c.foreground },
  });
}

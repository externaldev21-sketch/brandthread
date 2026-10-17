/**
 * Drafts — Depop's Drafts screen: "Ready to post" / "Incomplete" underline
 * tabs over plain rows (square thumbnail, title, "Men / Tops / T-shirts",
 * then the price or what it still needs in red). Tap a row to finish it in
 * Sell an item; press and hold to delete.
 * Ref: mobbin.com/screens/8cd4d9bf-694f-4822-a02d-b594269f79bf
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { hapticLight } from '@/lib/haptics';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { deleteDraft, listDrafts } from '@/services/productService';
import type { ProductDraft } from '@/services/productTypes';
import { draftToListing } from '@/lib/listing/listingPersistence';
import { missingForPublish } from '@/lib/listing/listingStore';
import { categoryPath } from '@/lib/listing/taxonomy';

type Tab = 'ready' | 'incomplete';

interface DraftRowData {
  id: string;
  title: string;
  path: string;
  cover?: string;
  priceCents: number | null;
  missing: string[];
}

function toRow(draft: ProductDraft): DraftRowData {
  const form = draftToListing(draft);
  const priceCents = parseDecimalToCents(form.priceStr);
  return {
    id: draft.id,
    title: form.title.trim() || 'Untitled item',
    path: categoryPath(form.department, form.category, form.subcategory),
    cover: form.photos[0]?.uri,
    priceCents,
    missing: missingForPublish(form, priceCents),
  };
}

export default function DraftsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<DraftRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('ready');

  useFocusEffect(useCallback(() => {
    let alive = true;
    listDrafts().then(drafts => {
      if (!alive) return;
      setRows(drafts.map(toRow));
      setLoading(false);
    });
    return () => { alive = false; };
  }, []));

  const ready = rows.filter(r => r.missing.length === 0);
  const incomplete = rows.filter(r => r.missing.length > 0);
  const visible = tab === 'ready' ? ready : incomplete;

  function remove(row: DraftRowData) {
    showActionSheet(row.title, undefined, [
      {
        text: 'Delete draft', style: 'destructive', onPress: () => {
          void deleteDraft(row.id);
          setRows(current => current.filter(r => r.id !== row.id));
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <View style={s.screen} testID="drafts-screen">
      <ScreenHeader title="Drafts" />
      <View style={s.tabs} accessibilityRole="tablist">
        {([['ready', 'Ready to post'], ['incomplete', 'Incomplete']] as const).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => { hapticLight(); setTab(key); }}
            style={s.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            testID={`drafts-tab-${key}`}
          >
            <Text style={[s.tabLabel, tab === key && s.tabLabelActive]}>{label}</Text>
            <View style={[s.tabLine, tab === key && { backgroundColor: theme.text }]} />
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={s.loading} color={theme.text} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
          ListEmptyComponent={(
            <View style={s.empty}>
              <Text style={s.emptyTitle}>{tab === 'ready' ? 'No drafts ready to post' : 'No incomplete drafts'}</Text>
              <Text style={s.emptyBody}>Items you save to drafts while listing show up here.</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { hapticLight(); router.push(`/add-product?editId=${encodeURIComponent(item.id)}` as never); }}
              onLongPress={() => remove(item)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.surface }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.missing.length ? `Needs ${item.missing.join(', ')}` : 'Ready to post'}`}
              accessibilityHint="Opens the draft. Press and hold to delete."
              testID={`draft-row-${item.id}`}
            >
              {item.cover ? <Image source={{ uri: item.cover }} style={s.thumb} /> : <View style={[s.thumb, { backgroundColor: theme.surface }]} />}
              <View style={s.rowText}>
                <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                {item.path ? <Text style={s.rowMeta} numberOfLines={1}>{item.path}</Text> : null}
                {item.missing.length ? (
                  <Text style={[s.rowMeta, { color: theme.error }]} numberOfLines={1}>
                    {`Needs ${item.missing.join(', ')}`}
                  </Text>
                ) : (
                  <Text style={s.rowMeta}>{formatCents(item.priceCents ?? 0)}</Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.background },
    tabs: { flexDirection: 'row', paddingHorizontal: SP.md, gap: SP.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    tab: { paddingTop: SP.sm },
    tabLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: t.muted, paddingBottom: SP.sm },
    tabLabelActive: { color: t.text },
    tabLine: { height: 2, backgroundColor: 'transparent' },
    loading: { marginTop: SP.xl },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border,
    },
    thumb: { width: 56, height: 56, borderRadius: 4 },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { fontSize: FS.base, fontFamily: FONT.regular, color: t.text },
    rowMeta: { fontSize: FS.meta, fontFamily: FONT.regular, color: t.muted },
    empty: { alignItems: 'center', paddingTop: SP.xxl, paddingHorizontal: SP.xl, gap: SP.sm },
    emptyTitle: { fontSize: FS.md, fontFamily: FONT.semibold, color: t.text },
    emptyBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted, textAlign: 'center' },
  });
}

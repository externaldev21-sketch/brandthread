/**
 * My Store — the seller's store at brandthread.app/@handle, what "Customize
 * your store" opens.
 *
 * Reference: Stan Store's "My Store" (stan.store, help.stan.store "How to
 * build & launch your Stan Store"): the store's live phone preview next to the
 * profile, the list of products (drag to reorder, show/hide each, tap to
 * edit), and one big "+ Add Product" that opens the product types — here just
 * Pre-made and Pre-order. Edit Design is a few preset themes. Reskinned black
 * / white / silver, system font, solid #1C1C1E sheets.
 *
 * The advanced store tools (Store Builder and the store-* screens) are
 * unchanged and still in Settings.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/ErrorState';
import { StoreSiteThumbnail } from '@/components/store/StoreSitePreview';
import { ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { StoreSheet } from '@/components/store/StoreSheet';
import { DragHandle, SortableList } from '@/components/store/SortableList';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useStoreLink } from '@/hooks/useStoreLink';
import { storeSiteViewFromBio, useStoreSite } from '@/hooks/useStoreSite';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';
import { FILL_ELEVATED } from '@/lib/theme';
import { displayStoreLink } from '@/lib/storeShare';
import { openShareStoreSheet } from '@/lib/shareStoreSheet';
import { leaveSetupFlow } from '@/lib/setupNavigation';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { STORE_SITE_THEMES, storeSiteTheme } from '@/lib/storeSiteDesign';
import {
  KIND_LABEL, blockCard, liveBlocks, moveItem, priceLabel, type BlockKind, type CatalogProduct, type StoreBlock,
} from '@/lib/storeBlocks';
import { addBlock, listBlocks, listCatalog, patchBlock, reorderBlocks } from '@/services/storeBlocksService';
import { saveBio } from '@/services/growthService';

const ROW_HEIGHT = 72;
const PREVIEW_W = 136;
const PREVIEW_H = 272;

type Sheet = null | 'types' | 'catalog' | 'design';

export default function MyStoreScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  // Bottom sheets live here: the tab bar steps aside.
  useHideTabBar();
  const insets = useSafeAreaInsets();
  const bottomInset = useScreenBottomInset();
  const link = useStoreLink();
  const { page, failed, reload } = useStoreSite();
  const [blocks, setBlocks] = useState<StoreBlock[] | null>(null);
  const [blocksFailed, setBlocksFailed] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [toast, flash] = useToast();

  const loadBlocks = useCallback(async () => {
    try {
      setBlocks(await listBlocks());
      setBlocksFailed(false);
    } catch {
      setBlocksFailed(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); void loadBlocks(); }, [reload, loadBlocks]));

  const activeTheme = themeKey ?? storeSiteTheme(page?.siteTheme ?? page?.theme).key;
  const site = useMemo(() => (page ? {
    ...storeSiteViewFromBio(page, liveBlocks(blocks ?? []).map((b) => ({ id: b.id, ...blockCard(b) }))),
    themeKey: activeTheme,
  } : null), [page, blocks, activeTheme]);

  const copy = useCallback(async () => {
    if (!link.url) return;
    await link.copy();
    flash('Link copied');
  }, [flash, link]);

  const reorder = useCallback(async (from: number, to: number) => {
    if (!blocks) return;
    const before = blocks;
    const next = moveItem(blocks, from, to);
    setBlocks(next);
    try {
      setBlocks(await reorderBlocks(next.map((b) => b.id)));
    } catch {
      setBlocks(before);
      flash("Couldn't save the new order. Try again.");
    }
  }, [blocks, flash]);

  const setVisible = useCallback(async (b: StoreBlock, visible: boolean) => {
    setBlocks((cur) => cur?.map((x) => (x.id === b.id ? { ...x, visible } : x)) ?? cur);
    try {
      const saved = await patchBlock(b.id, { visible });
      setBlocks((cur) => cur?.map((x) => (x.id === b.id ? saved : x)) ?? cur);
    } catch {
      setBlocks((cur) => cur?.map((x) => (x.id === b.id ? { ...x, visible: !visible } : x)) ?? cur);
      flash("Couldn't save. Try again.");
    }
  }, [flash]);

  const pickType = useCallback(async (kind: BlockKind) => {
    if (kind === 'preorder') {
      setSheet(null);
      router.push('/store-product?new=preorder' as never);
      return;
    }
    setCatalog(null);
    setSheet('catalog');
    try { setCatalog(await listCatalog()); } catch { setCatalog([]); flash("Couldn't load your products."); }
  }, [flash, router]);

  const pickProduct = useCallback(async (p: CatalogProduct | null) => {
    setSheet(null);
    if (!p) { router.push('/store-product?new=premade' as never); return; }
    try {
      const b = await addBlock(p.id);
      router.push(`/store-product?id=${encodeURIComponent(b.id)}` as never);
    } catch (e) {
      flash(e instanceof Error && e.message ? e.message.slice(0, 120) : "Couldn't add it. Try again.");
    }
  }, [flash, router]);

  const applyTheme = useCallback(async (key: string) => {
    const prev = activeTheme;
    setThemeKey(key);
    try {
      await saveBio({ siteTheme: key });
      void completeSetupTaskWhen('customize_store', true);
    } catch {
      setThemeKey(prev);
      flash("Couldn't save. Try again.");
    }
  }, [activeTheme, flash]);

  const name = (page?.displayName || link.brandName || (link.username ? `@${link.username}` : '')).trim();
  const header = (
    <ScreenHeader
      title="My Store"
      backAccessibilityLabel="Back"
      // Opened from the setup checklist too: pop back to wherever it came from.
      onBack={() => leaveSetupFlow(router, params.from)}
      actions={[
        { icon: 'droplet', onPress: () => setSheet('design'), accessibilityLabel: 'Edit design' },
        ...(link.url ? [{ icon: 'share' as const, onPress: () => openShareStoreSheet(), accessibilityLabel: 'Share store' }] : []),
      ]}
    />
  );

  if ((failed && !page) || (blocksFailed && !blocks)) {
    return <View style={[s.root, { backgroundColor: theme.background }]}>{header}<ErrorState onRetry={() => { void reload(); void loadBlocks(); }} /></View>;
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]} testID="my-store-screen">
      {header}
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: 24 + bottomInset }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          {/* Share is the header's share icon and Edit profile its button below:
              the preview and the avatar/name are not second copies of them. */}
          <View
            style={[s.phone, { borderColor: theme.borderSubtle }]}
            accessibilityLabel="Your store"
            testID="my-store-preview"
          >
            {site ? <StoreSiteThumbnail site={site} width={PREVIEW_W} height={PREVIEW_H} radius={18} /> : <View style={{ width: PREVIEW_W, height: PREVIEW_H }} />}
          </View>
          <View style={s.profile}>
            <View testID="my-store-profile">
              {site?.logoUrl
                ? <Image source={{ uri: site.logoUrl }} style={[s.avatar, { backgroundColor: FILL_ELEVATED }]} />
                : (
                  <View style={[s.avatar, s.center, { backgroundColor: FILL_ELEVATED }]}>
                    <Text style={[s.initial, { color: theme.text }]}>{(name.replace(/^@/, '')[0] ?? 'B').toUpperCase()}</Text>
                  </View>
                )}
              <Text style={[s.name, { color: theme.text }]} numberOfLines={2}>{name}</Text>
            </View>
            <Button label="Edit profile" variant="secondary" size="small" onPress={() => router.push('/store-profile' as never)} style={s.editProfile} testID="my-store-edit-profile" />
          </View>
        </View>
        {link.url ? (
          <Pressable onPress={copy} style={s.linkRow} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Copy ${displayStoreLink(link.url)}`} testID="my-store-link">
            <Text style={[s.link, { color: theme.muted }]} numberOfLines={1} ellipsizeMode="middle">{displayStoreLink(link.url)}</Text>
            <Icon name="copy" size={14} color={theme.muted} />
          </Pressable>
        ) : null}

        {blocks && blocks.length > 0 ? (
          <SortableList
            items={blocks}
            keyOf={(b) => b.id}
            rowHeight={ROW_HEIGHT}
            gap={8}
            onReorder={(from, to) => { void reorder(from, to); }}
            testID="my-store-blocks"
            renderRow={({ item: b, index, drag, move }) => (
              <BlockRow
                block={b}
                index={index}
                count={blocks.length}
                drag={drag}
                move={move}
                onPress={() => router.push(`/store-product?id=${encodeURIComponent(b.id)}` as never)}
                onToggle={(v) => { void setVisible(b, v); }}
              />
            )}
          />
        ) : null}

        <Button label="Add Product" icon="plus" onPress={() => setSheet('types')} fullWidth style={s.add} testID="my-store-add-product" />
      </ScrollView>

      <StoreSheet
        visible={sheet === 'types' || sheet === 'catalog'}
        title={sheet === 'catalog' ? 'Pre-made' : 'Add Product'}
        onBack={sheet === 'catalog' ? () => setSheet('types') : undefined}
        onClose={() => setSheet(null)}
        testID="my-store-add-sheet"
      >
        {sheet === 'catalog' ? (
          <ScrollView style={s.catalog} contentContainerStyle={s.sheetBody}>
            <Pressable onPress={() => { void pickProduct(null); }} style={s.catRow} accessibilityRole="button" testID="my-store-new-product">
              <View style={[s.catThumb, s.center, { backgroundColor: theme.background }]}><Icon name="plus" size={20} color={theme.text} /></View>
              <Text style={[s.catName, { color: theme.text }]}>New product</Text>
            </Pressable>
            {catalog && catalog.length > 0 ? <Text style={[s.catHead, { color: theme.muted }]}>From your products</Text> : null}
            {(catalog ?? []).map((p) => (
              <Pressable key={p.id} onPress={() => { void pickProduct(p); }} style={s.catRow} accessibilityRole="button" testID={`my-store-catalog-${p.id}`}>
                {p.image
                  ? <Image source={{ uri: p.image }} style={[s.catThumb, { backgroundColor: theme.background }]} />
                  : <View style={[s.catThumb, { backgroundColor: theme.background }]} />}
                <View style={s.typeText}>
                  <Text style={[s.catName, { color: theme.text }]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[s.typeLine, { color: theme.muted }]} numberOfLines={1}>
                    {[priceLabel(p.priceCents), `${p.stock} in stock`, p.status === 'draft' ? 'Draft' : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <View style={s.sheetBody}>
            {([
              { kind: 'premade' as const, icon: 'package' as const, line: 'In stock and ships now' },
              { kind: 'preorder' as const, icon: 'clock' as const, line: 'Buyers pay now, you ship by a date' },
            ]).map((t) => (
              <Pressable
                key={t.kind}
                onPress={() => { void pickType(t.kind); }}
                style={({ pressed }) => [s.type, { backgroundColor: theme.background, opacity: pressed ? 0.8 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={KIND_LABEL[t.kind]}
                testID={`my-store-type-${t.kind}`}
              >
                <View style={[s.typeIcon, { backgroundColor: FILL_ELEVATED }]}><Icon name={t.icon} size={22} color={theme.text} /></View>
                <View style={s.typeText}>
                  <Text style={[s.typeTitle, { color: theme.text }]}>{KIND_LABEL[t.kind]}</Text>
                  <Text style={[s.typeLine, { color: theme.muted }]}>{t.line}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={theme.muted} />
              </Pressable>
            ))}
          </View>
        )}
      </StoreSheet>

      <StoreSheet visible={sheet === 'design'} title="Design" onClose={() => setSheet(null)} testID="my-store-design-sheet">
        <View style={[s.sheetBody, s.themes]}>
          {STORE_SITE_THEMES.map((t) => {
            const on = t.key === activeTheme;
            return (
              <Pressable
                key={t.key}
                onPress={() => { void applyTheme(t.key); }}
                style={s.themeCell}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${t.label} theme`}
                testID={`my-store-theme-${t.key}`}
              >
                <View style={[s.swatch, { backgroundColor: t.bg, borderColor: on ? theme.text : theme.borderSubtle, borderWidth: on ? 2 : 1 }]}>
                  <View style={[s.swatchCard, { backgroundColor: t.card }]} />
                  <View style={[s.swatchBtn, { backgroundColor: t.buttonBg }]} />
                </View>
                <Text style={[s.themeLabel, { color: on ? theme.text : theme.muted }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </StoreSheet>

      <ShareStoreToast message={toast} top={insets.top + 8} />
    </View>
  );
}

function BlockRow({ block: b, index, count, drag, move, onPress, onToggle }: {
  block: StoreBlock;
  index: number;
  count: number;
  drag: React.ComponentProps<typeof DragHandle>['gesture'];
  move: (to: number) => void;
  onPress: () => void;
  onToggle: (visible: boolean) => void;
}) {
  const { theme } = useAppTheme();
  const card = blockCard(b);
  const meta = [
    b.status === 'draft' ? 'Draft' : null,
    card.priceLabel || null,
    b.kind === 'preorder' ? card.shipByLabel || KIND_LABEL.preorder : null,
    card.unavailableLabel,
  ].filter(Boolean).join(' · ');
  return (
    <View style={[s.row, { backgroundColor: FILL_ELEVATED, opacity: b.visible ? 1 : 0.55 }]} testID={`my-store-block-${index}`}>
      <DragHandle gesture={drag}>
        <View
          style={s.handle}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder ${card.title}`}
          accessibilityActions={[{ name: 'increment', label: 'Move down' }, { name: 'decrement', label: 'Move up' }]}
          onAccessibilityAction={(e) => move(e.nativeEvent.actionName === 'increment' ? Math.min(count - 1, index + 1) : Math.max(0, index - 1))}
          testID={`my-store-block-${index}-handle`}
        >
          <Icon name="menu" size={18} color={theme.muted} />
        </View>
      </DragHandle>
      <Pressable onPress={onPress} style={s.rowMain} accessibilityRole="button" accessibilityLabel={`Edit ${card.title}`}>
        {card.image
          ? <Image source={{ uri: card.image }} style={[s.rowThumb, { backgroundColor: theme.background }]} />
          : <View style={[s.rowThumb, { backgroundColor: theme.background }]} />}
        <View style={s.rowText}>
          <Text style={[s.rowTitle, { color: theme.text }]} numberOfLines={1}>{card.title}</Text>
          {!!meta && <Text style={[s.rowMeta, { color: theme.muted }]} numberOfLines={1}>{meta}</Text>}
        </View>
      </Pressable>
      <Pressable
        onPress={() => onToggle(!b.visible)}
        disabled={b.status !== 'published'}
        style={s.eye}
        hitSlop={4}
        accessibilityRole="switch"
        accessibilityState={{ checked: b.visible, disabled: b.status !== 'published' }}
        accessibilityLabel={`Show ${card.title} on your store`}
        testID={`my-store-block-${index}-visible`}
      >
        <Icon name={b.visible ? 'eye' : 'eye-off'} size={20} color={b.status === 'published' ? theme.text : theme.muted} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  phone: { borderWidth: 1, borderRadius: 20, padding: 1, alignSelf: 'flex-start' },
  profile: { flex: 1, minWidth: 0, paddingTop: 4 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  initial: { fontSize: 26, fontWeight: '700' },
  name: { fontSize: 22, lineHeight: 27, fontWeight: '700', marginTop: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: -8, marginBottom: 4, alignSelf: 'flex-start', maxWidth: '100%' },
  link: { fontSize: 15, flexShrink: 1 },
  editProfile: { alignSelf: 'flex-start', marginTop: 12 },
  row: { height: ROW_HEIGHT, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  handle: { width: 40, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, height: ROW_HEIGHT },
  rowThumb: { width: 48, height: 48, borderRadius: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowMeta: { fontSize: 13 },
  eye: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  add: { marginTop: 8 },
  sheetBody: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8, gap: 8 },
  type: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, minHeight: 76 },
  typeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  typeText: { flex: 1, minWidth: 0, gap: 2 },
  typeTitle: { fontSize: 17, fontWeight: '600' },
  typeLine: { fontSize: 14 },
  catalog: { maxHeight: 460 },
  catHead: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
  catThumb: { width: 48, height: 48, borderRadius: 10 },
  catName: { fontSize: 16, fontWeight: '600' },
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 16 },
  themeCell: { width: '30%', alignItems: 'center', gap: 6 },
  swatch: { width: '100%', aspectRatio: 0.8, borderRadius: 14, padding: 10, justifyContent: 'flex-end', gap: 6 },
  swatchCard: { height: 22, borderRadius: 6 },
  swatchBtn: { height: 14, borderRadius: 5 },
  themeLabel: { fontSize: 13, fontWeight: '600' },
});

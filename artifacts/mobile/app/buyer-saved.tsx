import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Alert, StyleSheet, Dimensions,
  Modal, TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  CARD, BORDER, FG, MUTED, SUBTLE, OVERLAY,
  SUCCESS, ORANGE, RED,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getSavedItems, removeSavedItem, subscribeSocial,
  getCollections, createCollection,
} from '@/services/socialService';
import { SavedItem, SavedCollection } from '@/services/socialTypes';
import { getBuyerProduct, addToCart, createBuyNowSession, getCart } from '@/services/cartService';
import { reportNetworkError } from '@/lib/networkNotice';
import { Header } from '@/components/layout';
import { CachedImage } from '@/components/CachedImage';
import { GridSkeleton } from '@/components/layout/Skeleton';
import { EmptyState } from '@/components/BrandthreadUI';
import { SaveToCollectionSheet, SaveToCollectionItem } from '@/components/SaveToCollectionSheet';
import { formatCents } from '@/lib/money';

const { width: W } = Dimensions.get('window');
const GAP = SP.sm;
const TILE_SIZE = (W - SP.md * 2 - GAP) / 2;

type MainTab = 'all' | 'collections' | 'drops';
const MAIN_TABS: { key: MainTab; label: string; icon: string }[] = [
  { key: 'all',         label: 'All',           icon: 'grid' },
  { key: 'collections', label: 'Collections',    icon: 'folder' },
  { key: 'drops',       label: 'Price drops',    icon: 'trending-down' },
];

export default function BuyerSaved() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [items, setItems] = useState<SavedItem[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [actionsFor, setActionsFor] = useState<SavedItem | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [saveToSheetItem, setSaveToSheetItem] = useState<SaveToCollectionItem | null>(null);
  const [newCollectionModal, setNewCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const [savedRows, collectionRows] = await Promise.all([getSavedItems(), getCollections()]);
      setItems(savedRows);
      setCollections(collectionRows);
    } catch (error) {
      reportNetworkError(error, () => load());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load({ silent: true }); }, [load]));

  useEffect(() => {
    const unsub = subscribeSocial(() => load({ silent: true }));
    return unsub;
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const priceDrops = useMemo(() => items.filter(i => i.priceDropped), [items]);

  function openItem(item: SavedItem) {
    switch (item.type) {
      case 'post':
        router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.targetId)}&postAuthorColor=${encodeURIComponent(item.accentColor ?? '')}` as never);
        return;
      case 'product':
        router.push(`/thread-product-detail?productId=${encodeURIComponent(item.targetId)}&productName=${encodeURIComponent(item.title)}` as never);
        return;
      case 'store':
        router.push(`/seller-profile?sellerId=${encodeURIComponent(item.targetId)}` as never);
        return;
      case 'collection':
        return;
    }
  }

  function removeSaved(item: SavedItem) {
    Alert.alert('Remove from saved?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try { await removeSavedItem(item.targetId); await load(); }
          catch { Alert.alert('Couldn’t remove item', 'Try again.'); }
        },
      },
    ]);
  }

  async function handleBuyNow(item: SavedItem) {
    setActionsBusy(true);
    try {
      const product = await getBuyerProduct(item.targetId);
      const variant = product?.variants.find(v => v.isAvailable);
      if (!product || !variant) {
        Alert.alert('Unavailable', 'This item is no longer available to buy.');
        return;
      }
      const cart = await getCart();
      await createBuyNowSession(product, variant, 1, cart);
      setActionsFor(null);
      router.push('/buyer-checkout?source=buynow' as never);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setActionsBusy(false);
    }
  }

  async function handleAddToCart(item: SavedItem) {
    setActionsBusy(true);
    try {
      const product = await getBuyerProduct(item.targetId);
      const variant = product?.variants.find(v => v.isAvailable);
      if (!product || !variant) {
        Alert.alert('Unavailable', 'This item is no longer available to add to cart.');
        return;
      }
      const result = await addToCart({ product, variant, quantity: 1 });
      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setActionsFor(null);
      } else {
        Alert.alert('Cannot Add to Cart', result.message ?? 'Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setActionsBusy(false);
    }
  }

  async function handleCreateCollection() {
    const name = newCollectionName.trim();
    if (!name) return;
    setCreatingCollection(true);
    try {
      await createCollection(name);
      setNewCollectionModal(false);
      setNewCollectionName('');
      await load({ silent: true });
    } catch {
      Alert.alert('Couldn’t create collection', 'Try again.');
    } finally {
      setCreatingCollection(false);
    }
  }

  function renderBadges(item: SavedItem) {
    if (item.type !== 'product') return null;
    return (
      <View style={styles.badgeRow}>
        {item.soldOut ? <Badge label="Sold out" color={RED} /> : null}
        {!item.soldOut && item.lowStock ? <Badge label="Low stock" color={ORANGE} /> : null}
        {!item.soldOut && item.backInStock ? <Badge label="Back in stock" color={theme.accent} /> : null}
        {item.priceDropped ? <Badge label="Price drop" color={SUCCESS} /> : null}
      </View>
    );
  }

  function renderProductTile({ item }: { item: SavedItem }) {
    const isProduct = item.type === 'product';
    return (
      <TouchableOpacity
        style={styles.tile}
        onPress={() => openItem(item)}
        onLongPress={() => (isProduct ? setActionsFor(item) : removeSaved(item))}
        activeOpacity={0.85}
      >
        <View style={styles.tileImageWrap}>
          {item.image ? (
            <CachedImage source={{ uri: item.image }} style={styles.tileImage} />
          ) : (
            <View style={[styles.tileImage, styles.tilePlaceholder, { backgroundColor: item.accentColor || theme.accentDim }]}>
              <Feather name={item.type === 'post' ? 'image' : item.type === 'store' ? 'home' : 'shopping-bag'} size={22} color={theme.accent} style={{ opacity: 0.8 }} />
            </View>
          )}
          {isProduct && (
            <TouchableOpacity
              style={styles.tileMore}
              onPress={() => setActionsFor(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="More actions"
            >
              <Feather name="more-horizontal" size={16} color="#fff" />
            </TouchableOpacity>
          )}
          {renderBadges(item)}
        </View>
        <View style={styles.tileInfo}>
          {item.brand ? <Text style={styles.tileBrand} numberOfLines={1}>{item.brand}</Text> : null}
          <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
          {isProduct && item.priceCents != null ? (
            <View style={styles.priceRow}>
              <Text style={[styles.tilePrice, item.priceDropped && { color: SUCCESS }]}>
                {formatCents(item.priceCents)}
              </Text>
              {item.priceDropped && item.oldPriceCents != null ? (
                <Text style={styles.tileOldPrice}>{formatCents(item.oldPriceCents)}</Text>
              ) : null}
            </View>
          ) : item.subtitle ? (
            <Text style={styles.tileSubtitle} numberOfLines={1}>{item.subtitle}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  function renderCollectionTile({ item }: { item: SavedCollection }) {
    return (
      <TouchableOpacity
        style={styles.tile}
        onPress={() => router.push(`/buyer-collection?collectionId=${encodeURIComponent(item.id)}` as never)}
        activeOpacity={0.85}
      >
        <View style={styles.tileImageWrap}>
          {item.coverImageUrl ? (
            <CachedImage source={{ uri: item.coverImageUrl }} style={styles.tileImage} />
          ) : (
            <View style={[styles.tileImage, styles.tilePlaceholder, { backgroundColor: theme.accentDim }]}>
              <Feather name="folder" size={26} color={theme.accent} />
            </View>
          )}
          {item.isPublic ? (
            <View style={styles.publicBadge}><Feather name="globe" size={10} color="#fff" /></View>
          ) : null}
        </View>
        <View style={styles.tileInfo}>
          <Text style={styles.tileTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.tileSubtitle}>{item.itemCount} saved</Text>
        </View>
      </TouchableOpacity>
    );
  }

  function newCollectionTile() {
    return (
      <TouchableOpacity style={styles.tile} onPress={() => setNewCollectionModal(true)} activeOpacity={0.85}>
        <View style={[styles.tileImageWrap, styles.newCollectionTile]}>
          <Feather name="plus" size={26} color={theme.accent} />
        </View>
        <View style={styles.tileInfo}>
          <Text style={[styles.tileTitle, { color: theme.accent }]}>New collection</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const list = mainTab === 'drops' ? priceDrops : items;

  return (
    <View style={styles.root}>
      <Header title="Saved" />

      <FlatList
        data={MAIN_TABS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={t => t.key}
        contentContainerStyle={styles.tabBar}
        renderItem={({ item: tab }) => (
          <TouchableOpacity
            style={[styles.tab, mainTab === tab.key && styles.tabActive]}
            onPress={() => setMainTab(tab.key)}
            activeOpacity={0.7}
          >
            <Feather name={tab.icon as any} size={ICON.sm} color={mainTab === tab.key ? theme.accent : MUTED} />
            <Text style={[styles.tabText, mainTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        )}
      />

      {loading ? (
        <View style={styles.gridContent}>
          <GridSkeleton columns={2} cardWidth={TILE_SIZE} rows={3} gap={GAP} />
        </View>
      ) : mainTab === 'collections' ? (
        collections.length === 0 ? (
          <EmptyState
            icon="folder"
            title="No collections yet"
            description="Save something, then organize it into a board — like a Pinterest for your wishlist."
            action={{ label: 'New collection', onPress: () => setNewCollectionModal(true) }}
            style={{ marginTop: SP.xxl }}
          />
        ) : (
          <FlatList
            data={collections}
            keyExtractor={c => c.id}
            numColumns={2}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
            renderItem={renderCollectionTile}
            ListFooterComponent={newCollectionTile}
          />
        )
      ) : list.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title={mainTab === 'drops' ? 'No price drops yet' : 'Nothing saved yet'}
          description={mainTab === 'drops'
            ? 'We’ll flag it here the moment something you saved gets cheaper.'
            : 'Tap the bookmark on anything to save it here.'}
          action={{ label: 'Discover', onPress: () => router.push('/(buyer)/discover') }}
          style={{ marginTop: SP.xxl }}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.gridContent}
          renderItem={renderProductTile}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        />
      )}

      {/* ─ Quick actions ─ */}
      <Modal transparent animationType="fade" visible={!!actionsFor} onRequestClose={() => setActionsFor(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setActionsFor(null)} />
        <View style={[styles.actionsSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.handle} />
          <Text style={styles.actionsTitle} numberOfLines={1}>{actionsFor?.title}</Text>
          <ActionRow icon="zap" label="Buy Now" onPress={() => actionsFor && handleBuyNow(actionsFor)} disabled={actionsBusy} />
          <ActionRow icon="shopping-cart" label="Add to Cart" onPress={() => actionsFor && handleAddToCart(actionsFor)} disabled={actionsBusy} />
          <ActionRow
            icon="folder"
            label="Move to collection"
            onPress={() => {
              if (!actionsFor) return;
              setSaveToSheetItem({
                type: actionsFor.type, targetId: actionsFor.targetId, title: actionsFor.title,
                subtitle: actionsFor.subtitle, accentColor: actionsFor.accentColor, priceCents: actionsFor.priceCents,
              });
              setActionsFor(null);
            }}
          />
          <ActionRow icon="trash-2" label="Remove" destructive onPress={() => { const it = actionsFor; setActionsFor(null); if (it) removeSaved(it); }} />
        </View>
      </Modal>

      <SaveToCollectionSheet
        visible={!!saveToSheetItem}
        item={saveToSheetItem}
        onClose={() => setSaveToSheetItem(null)}
        onSaved={() => load({ silent: true })}
      />

      {/* ─ New collection ─ */}
      <Modal transparent animationType="fade" visible={newCollectionModal} onRequestClose={() => setNewCollectionModal(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setNewCollectionModal(false)} />
        <View style={styles.centerModal}>
          <View style={styles.newCollectionCard}>
            <Text style={styles.actionsTitle}>New collection</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Fall Fits"
              placeholderTextColor={SUBTLE}
              value={newCollectionName}
              onChangeText={setNewCollectionName}
              autoFocus
              onSubmitEditing={handleCreateCollection}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setNewCollectionModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreate, { backgroundColor: theme.accent, opacity: newCollectionName.trim() ? 1 : 0.5 }]}
                onPress={handleCreateCollection}
                disabled={!newCollectionName.trim() || creatingCollection}
              >
                {creatingCollection
                  ? <ActivityIndicator color={theme.onAccent} size="small" />
                  : <Text style={[styles.modalCreateText, { color: theme.onAccent }]}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[bs.badge, { backgroundColor: color }]}>
      <Text style={bs.badgeText}>{label}</Text>
    </View>
  );
}
const bs = StyleSheet.create({
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADIUS.xs, marginRight: 4, marginBottom: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: FONT.bold },
});

function ActionRow({ icon, label, onPress, disabled, destructive }: {
  icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <TouchableOpacity style={ar.row} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      <Feather name={icon} size={ICON.md} color={destructive ? RED : FG} />
      <Text style={[ar.label, destructive && { color: RED }]}>{label}</Text>
    </TouchableOpacity>
  );
}
const ar = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.md },
  label: { color: FG, fontFamily: FONT.medium, fontSize: FS.base },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  tabBar: { paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingHorizontal: SP.md, paddingVertical: SP.xs + 2, borderRadius: RADIUS.pill,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
  },
  tabActive: { backgroundColor: theme.accentDim, borderColor: theme.accent },
  tabText: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  tabTextActive: { color: theme.accent, fontFamily: FONT.semibold },
  gridContent: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: GAP, paddingBottom: SP.xxl },
  tile: { width: TILE_SIZE, marginBottom: GAP },
  tileImageWrap: { width: TILE_SIZE, aspectRatio: 1, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  newCollectionTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.accent, borderStyle: 'dashed', backgroundColor: 'transparent' },
  tileMore: {
    position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  publicBadge: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  badgeRow: { position: 'absolute', left: 6, bottom: 6, right: 30, flexDirection: 'row', flexWrap: 'wrap' },
  tileInfo: { paddingTop: SP.xs, gap: 1 },
  tileBrand: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.3 },
  tileTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  tileSubtitle: { color: MUTED, fontSize: FS.xs },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  tilePrice: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  tileOldPrice: { color: SUBTLE, fontSize: FS.xs, textDecorationLine: 'line-through' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY },
  actionsSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: theme.border, paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.sm },
  actionsTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md, marginBottom: SP.xs, textAlign: 'center' },
  centerModal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  newCollectionCard: {
    width: '100%', backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    padding: SP.lg, gap: SP.md,
  },
  input: {
    height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, paddingHorizontal: SP.md, color: FG, fontSize: FS.base,
  },
  modalActions: { flexDirection: 'row', gap: SP.sm, justifyContent: 'flex-end' },
  modalCancel: { paddingHorizontal: SP.md, paddingVertical: SP.sm + 2 },
  modalCancelText: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.base },
  modalCreate: { paddingHorizontal: SP.lg, paddingVertical: SP.sm + 2, borderRadius: RADIUS.md, minWidth: 84, alignItems: 'center' },
  modalCreateText: { fontFamily: FONT.semibold, fontSize: FS.base },
});

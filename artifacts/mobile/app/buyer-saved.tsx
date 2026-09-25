import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, Alert, StyleSheet, Dimensions,
  Modal, TextInput, Animated, Platform, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  FG, SUBTLE, OVERLAY,
  SUCCESS, ORANGE, RED,
  FONT, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import {
  getSavedItems, removeSavedItem, subscribeSocial,
  getCollections, createCollection,
} from '@/services/socialService';
import { SavedItem, SavedCollection } from '@/services/socialTypes';
import { getBuyerProduct, addToCart, createBuyNowSession, getCart } from '@/services/cartService';
import { reportNetworkError } from '@/lib/networkNotice';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { GridSkeleton } from '@/components/layout/Skeleton';
import { EmptyState } from '@/components/BrandthreadUI';
import { SaveToCollectionSheet, SaveToCollectionItem } from '@/components/SaveToCollectionSheet';
import { formatCents } from '@/lib/money';
import { Card, IconButton, Button, ListRow, SegmentedControl, BottomSheet, ThemedRefreshControl } from '@/components/ui';
import { TYPE_SCALE, TABULAR_NUMS } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';
import { hapticLight, hapticSuccessAction } from '@/lib/haptics';

const { width: W } = Dimensions.get('window');
const GAP = SPACING.xs;
const TILE_SIZE = (W - SPACING.md * 2 - GAP) / 2;

type MainTab = 'all' | 'collections' | 'drops';
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'all',         label: 'All' },
  { id: 'collections', label: 'Collections' },
  { id: 'drops',       label: 'Price drops' },
];

/** Local press-feel wrapper matching Card's motion, extended with onLongPress
 * (used by the "post"/"store" save tiles, whose long-press is the only way to
 * remove them — Card itself doesn't expose onLongPress). */
function TilePressable({ onPress, onLongPress, accessibilityLabel, children, style }: {
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  children: React.ReactNode;
  style?: any;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => { hapticLight(); onPress(); }}
      onLongPress={onLongPress}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

export default function BuyerSaved() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const styles = makeStyles(theme, palette);
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
        hapticSuccessAction();
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
      <TilePressable
        style={styles.tile}
        accessibilityLabel={item.title}
        onPress={() => openItem(item)}
        onLongPress={() => (isProduct ? setActionsFor(item) : removeSaved(item))}
      >
        <View style={styles.tileImageWrap}>
          {item.image ? (
            <CachedImage source={{ uri: item.image }} style={styles.tileImage} />
          ) : (
            <View style={[styles.tileImage, styles.tilePlaceholder, { backgroundColor: item.accentColor || theme.accentDim }]}>
              <Feather name={item.type === 'post' ? 'image' : item.type === 'store' ? 'home' : 'shopping-bag'} size={ICON.md} color={theme.accent} style={{ opacity: 0.8 }} />
            </View>
          )}
          {isProduct && (
            <IconButton
              name="more-horizontal"
              variant="glass"
              size={16}
              onPress={() => setActionsFor(item)}
              accessibilityLabel="More actions"
              style={styles.tileMore}
            />
          )}
          {renderBadges(item)}
        </View>
        <View style={styles.tileInfo}>
          {item.brand ? <Text style={styles.tileBrand} numberOfLines={1}>{item.brand}</Text> : null}
          <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
          {isProduct && item.priceCents != null ? (
            <View style={styles.priceRow}>
              <Text style={[styles.tilePrice, TABULAR_NUMS, item.priceDropped && { color: SUCCESS }]}>
                {formatCents(item.priceCents)}
              </Text>
              {item.priceDropped && item.oldPriceCents != null ? (
                <Text style={[styles.tileOldPrice, TABULAR_NUMS]}>{formatCents(item.oldPriceCents)}</Text>
              ) : null}
            </View>
          ) : item.subtitle ? (
            <Text style={styles.tileSubtitle} numberOfLines={1}>{item.subtitle}</Text>
          ) : null}
        </View>
      </TilePressable>
    );
  }

  function renderCollectionTile({ item }: { item: SavedCollection }) {
    return (
      <Card
        style={styles.collectionCard}
        onPress={() => router.push(`/buyer-collection?collectionId=${encodeURIComponent(item.id)}` as never)}
        accessibilityLabel={item.name}
        accessibilityHint={`Opens the ${item.name} collection`}
      >
        <View style={styles.tileImageWrap}>
          {item.coverImageUrl ? (
            <CachedImage source={{ uri: item.coverImageUrl }} style={styles.tileImage} />
          ) : (
            <View style={[styles.tileImage, styles.tilePlaceholder, { backgroundColor: theme.accentDim }]}>
              <Feather name="folder" size={ICON.lg} color={theme.accent} />
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
      </Card>
    );
  }

  function newCollectionTile() {
    return (
      <Card style={styles.collectionCard} onPress={() => setNewCollectionModal(true)} accessibilityLabel="New collection" accessibilityHint="Creates a new collection">
        <View style={[styles.tileImageWrap, styles.newCollectionSquare]}>
          <Feather name="plus" size={ICON.lg} color={theme.accent} />
        </View>
        <View style={styles.tileInfo}>
          <Text style={[styles.tileTitle, { color: theme.accent }]}>New collection</Text>
        </View>
      </Card>
    );
  }

  const list = mainTab === 'drops' ? priceDrops : items;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Saved" variant="push" />

      <View style={styles.tabBar}>
        <SegmentedControl
          options={MAIN_TABS}
          selectedId={mainTab}
          onChange={(id) => setMainTab(id as MainTab)}
        />
      </View>

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
            style={{ marginTop: SPACING.xxl }}
          />
        ) : (
          <FlatList
            data={collections}
            keyExtractor={c => c.id}
            numColumns={2}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={styles.gridContent}
            refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
          style={{ marginTop: SPACING.xxl }}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.gridContent}
          renderItem={renderProductTile}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      {/* ─ Quick actions ─ */}
      <BottomSheet visible={!!actionsFor} onClose={() => setActionsFor(null)}>
        <View style={styles.actionsContent}>
          <Text style={styles.actionsTitle} numberOfLines={1}>{actionsFor?.title}</Text>
          <ListRow icon="zap" title="Buy Now" onPress={() => actionsFor && handleBuyNow(actionsFor)} disabled={actionsBusy} />
          <ListRow icon="shopping-cart" title="Add to Cart" onPress={() => actionsFor && handleAddToCart(actionsFor)} disabled={actionsBusy} />
          <ListRow
            icon="folder"
            title="Move to collection"
            onPress={() => {
              if (!actionsFor) return;
              setSaveToSheetItem({
                type: actionsFor.type, targetId: actionsFor.targetId, title: actionsFor.title,
                subtitle: actionsFor.subtitle, accentColor: actionsFor.accentColor, priceCents: actionsFor.priceCents,
              });
              setActionsFor(null);
            }}
          />
          <ListRow icon="trash-2" title="Remove" destructive onPress={() => { const it = actionsFor; setActionsFor(null); if (it) removeSaved(it); }} />
        </View>
      </BottomSheet>

      <SaveToCollectionSheet
        visible={!!saveToSheetItem}
        item={saveToSheetItem}
        onClose={() => setSaveToSheetItem(null)}
        onSaved={() => load({ silent: true })}
      />

      {/* ─ New collection ─ */}
      <Modal transparent animationType="fade" visible={newCollectionModal} onRequestClose={() => setNewCollectionModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setNewCollectionModal(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={styles.centerModal} pointerEvents="box-none">
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
              <Button label="Cancel" variant="secondary" size="small" onPress={() => setNewCollectionModal(false)} />
              <Button
                label="Create"
                variant="primary"
                size="small"
                onPress={handleCreateCollection}
                loading={creatingCollection}
                disabled={!newCollectionName.trim() || creatingCollection}
              />
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
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADII.chip, marginRight: SPACING.xxs, marginBottom: SPACING.xxs },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: FONT.bold },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  tabBar: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  gridContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.xs, gap: GAP, paddingBottom: SPACING.xxl },
  tile: {
    width: TILE_SIZE, marginBottom: GAP, borderRadius: RADII.card,
    backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, overflow: 'hidden',
  },
  collectionCard: { width: TILE_SIZE, marginBottom: GAP, padding: 0, overflow: 'hidden' },
  tileImageWrap: { width: '100%', aspectRatio: 1 },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  newCollectionSquare: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.accent, borderStyle: 'dashed', backgroundColor: 'transparent' },
  tileMore: { position: 'absolute', top: SPACING.xxs, right: SPACING.xxs },
  publicBadge: {
    position: 'absolute', top: SPACING.xxs, right: SPACING.xxs, width: 22, height: 22, borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  badgeRow: { position: 'absolute', left: SPACING.xxs, bottom: SPACING.xxs, right: SPACING.xxs, flexDirection: 'row', flexWrap: 'wrap' },
  tileInfo: { paddingHorizontal: SPACING.xs, paddingTop: SPACING.xs, paddingBottom: SPACING.sm, gap: 1 },
  tileBrand: { ...TYPE_SCALE.caption, color: palette.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.3 },
  tileTitle: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: FG },
  tileSubtitle: { ...TYPE_SCALE.caption, color: palette.mutedForeground },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xxs },
  tilePrice: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: FG },
  tileOldPrice: { ...TYPE_SCALE.caption, color: SUBTLE, textDecorationLine: 'line-through' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: OVERLAY },
  actionsContent: { paddingHorizontal: SPACING.md, paddingTop: SPACING.xs },
  actionsTitle: { ...TYPE_SCALE.headline, fontFamily: FONT.bold, color: FG, marginBottom: SPACING.xs, textAlign: 'center' },
  centerModal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  newCollectionCard: {
    width: '100%', backgroundColor: palette.card, borderRadius: RADII.sheet, borderWidth: 1, borderColor: palette.border,
    padding: SPACING.lg, gap: SPACING.md,
  },
  input: {
    height: 48, borderRadius: RADII.chip, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.elevated, paddingHorizontal: SPACING.md, color: FG, fontSize: TYPE_SCALE.body.fontSize,
  },
  modalActions: { flexDirection: 'row', gap: SPACING.sm, justifyContent: 'flex-end' },
});

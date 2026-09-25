/**
 * A seller's shop — every active listing, opened from the profile's floating
 * "Shop N products" pill.
 *
 * Data comes from GET /api/public/products?ownerId= — the same live source
 * buyer product detail and checkout read (active listings only, variant
 * prices and stock), never a separate mocked list. Tapping a product opens
 * the real product detail screen.
 *
 * Params: sellerId, sellerName?, isOwner?
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, PressableScale, ProductGridSkeleton } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { productDetailHref } from '@/lib/profileNavigation';
import { getSellerShopPage, type ShopProduct } from '@/services/profileService';
import { InteractionLayer, ProfileButton, ProfileGlassButton } from '@/components/profile/ProfileControls';
import { useProfileLayout } from '@/components/profile/profileLayout';

const GAP = SP.sm;

export function stockLabel(product: ShopProduct): { label: string; tone: 'muted' | 'warning' | 'text' } {
  if (product.isPreOrder) return { label: 'Pre-order', tone: 'text' };
  if (product.totalStock <= 0) return { label: 'Sold out', tone: 'muted' };
  if (product.totalStock <= 5) return { label: `Only ${product.totalStock} left`, tone: 'warning' };
  return { label: 'In stock', tone: 'muted' };
}

export default function ProfileProductsScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useProfileLayout();
  const params = useLocalSearchParams<{ sellerId?: string; sellerName?: string; isOwner?: string }>();
  const sellerId = typeof params.sellerId === 'string' ? params.sellerId : '';
  const sellerName = typeof params.sellerName === 'string' && params.sellerName ? params.sellerName : 'this seller';
  const isOwner = params.isOwner === 'true';

  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const generationRef = useRef(0);

  const columns = layout.isDesktopWeb ? 3 : layout.gridColumns >= 4 ? layout.gridColumns - 1 : 2;
  const cardWidth = Math.floor((layout.columnWidth - SP.md * 2 - GAP * (columns - 1)) / columns);

  const load = useCallback(async () => {
    if (!sellerId) { setLoading(false); setError(true); return; }
    const generation = ++generationRef.current;
    setError(false);
    try {
      const page = await getSellerShopPage(sellerId, 0);
      if (generation !== generationRef.current) return;
      setProducts(page.products);
      setHasMore(page.hasMore);
      offsetRef.current = page.nextOffset;
    } catch {
      if (generation === generationRef.current) setError(true);
    } finally {
      if (generation === generationRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [sellerId]);

  // Refetch on every focus: coming back from Manage products / add / delete
  // must not show the listing set from before the change.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || !sellerId) return;
    setLoadingMore(true);
    const generation = generationRef.current;
    getSellerShopPage(sellerId, offsetRef.current)
      .then((page) => {
        if (generation !== generationRef.current) return;
        setProducts((prev) => {
          const seen = new Set(prev.map((product) => product.id));
          return [...prev, ...page.products.filter((product) => !seen.has(product.id))];
        });
        setHasMore(page.hasMore);
        offsetRef.current = page.nextOffset;
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, sellerId]);

  const openProduct = useCallback((product: ShopProduct) => {
    router.push(productDetailHref(product.id, { isOwner }) as never);
  }, [isOwner, router]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  }, [router]);

  const renderItem = useCallback(({ item }: { item: ShopProduct }) => {
    const stock = stockLabel(item);
    const stockColor = stock.tone === 'warning' ? theme.warning : stock.tone === 'text' ? theme.text : theme.muted;
    return (
      <View style={{ width: cardWidth }}>
        <PressableScale
          onPress={() => openProduct(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${formatCents(item.priceCents)}, ${stock.label}`}
          testID={`profile-product-${item.id}`}
          style={styles.card}
        >
          {(state) => (
            <>
              <View style={[styles.image, { height: Math.round(cardWidth * 1.25) }]}>
                {item.imageUri ? (
                  <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                ) : (
                  <Feather name="image" size={26} color={theme.muted} />
                )}
                {!item.inStock ? <View style={styles.soldOutVeil} pointerEvents="none" /> : null}
              </View>
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.price}>{formatCents(item.priceCents)}</Text>
                <Text style={[styles.stock, { color: stockColor }]}>{stock.label}</Text>
              </View>
              <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.md} theme={theme} />
            </>
          )}
        </PressableScale>
      </View>
    );
  }, [cardWidth, openProduct, styles, theme]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + SP.sm }]}>
      <View style={styles.headerRow}>
        <ProfileGlassButton icon="arrow-left" onPress={goBack} accessibilityLabel="Go back" />
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{isOwner ? 'Your shop' : 'Shop'}</Text>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{isOwner ? 'Live listings' : sellerName}</Text>
        </View>
      </View>
      {!loading && !error ? (
        <Text style={styles.count}>
          {products.length}{hasMore ? '+' : ''} product{products.length === 1 && !hasMore ? '' : 's'}
        </Text>
      ) : null}
      {isOwner ? (
        <View style={styles.ownerRow}>
          <ProfileButton label="Manage products" icon="sliders" onPress={() => router.push('/(tabs)/products' as never)} />
          <ProfileButton label="Add a product" icon="plus" variant="primary" onPress={() => router.push('/add-product' as never)} />
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactElement | null = null;
  if (loading) {
    body = <View style={styles.pad}><ProductGridSkeleton columns={columns} count={columns * 2} /></View>;
  } else if (error) {
    body = <ErrorState message="Couldn't load this shop." onRetry={() => { setLoading(true); void load(); }} />;
  } else {
    body = (
      <EmptyState
        icon="shopping-bag"
        title={isOwner ? 'No products yet' : 'No products available'}
        description={isOwner ? 'Add your first product to start selling.' : `${sellerName} has no live listings right now.`}
        action={isOwner ? { label: 'Add a product', icon: 'plus', onPress: () => router.push('/add-product' as never) } : undefined}
        compact
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.column, { width: layout.columnWidth }, layout.isDesktopWeb && styles.desktopColumn]}>
        <FlatList
          key={`shop-${columns}`}
          data={loading || error ? [] : products}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          ListHeaderComponent={header}
          ListEmptyComponent={body}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.muted} />}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background, alignItems: 'center' },
    column: { flex: 1 },
    desktopColumn: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
    header: { paddingHorizontal: SP.md, paddingBottom: SP.md, gap: SP.sm },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
    headerCopy: { flex: 1, minWidth: 0 },
    eyebrow: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.6, textTransform: 'uppercase', color: theme.muted },
    title: { fontFamily: FONT.bold, fontSize: FS.xxl, lineHeight: 32, letterSpacing: -0.5, color: theme.text },
    count: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
    ownerRow: { flexDirection: 'row', gap: SP.sm },
    pad: { paddingHorizontal: SP.md },
    row: { gap: GAP, paddingHorizontal: SP.md, marginBottom: SP.md },
    card: { borderRadius: RADIUS.md, overflow: 'hidden' },
    image: {
      width: '100%', borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: theme.cardElevated,
      alignItems: 'center', justifyContent: 'center',
    },
    soldOutVeil: { ...StyleSheet.absoluteFill, backgroundColor: `${theme.background}8C` },
    info: { paddingTop: SP.sm, paddingHorizontal: 2, gap: 3 },
    name: { fontFamily: FONT.semibold, fontSize: FS.sm, lineHeight: 18, color: theme.text },
    price: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text },
    stock: { fontFamily: FONT.medium, fontSize: FS.xs },
  });
}

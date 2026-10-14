/**
 * Store page "Lookbook" layout — the seller's products as full-screen
 * editorial looks, one per page, swiped vertically.
 *
 * Copied from GOAT "Styles"
 * (https://mobbin.com/screens/353d1e4c-cc62-4908-9272-f5eea8aa72c6):
 * full-bleed image, minimal text. Reskinned for Brandthread: the brand name
 * small at the top, the product name + price small at the bottom, nothing
 * else on the image. Tapping a look opens the product.
 *
 * Back, Follow and a way to the full store page stay on screen. Images only
 * (product photos), so nothing plays and there is no audio. With Reduce
 * Motion on, paging stops dead on the next look instead of gliding.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage } from '@/components/CachedImage';
import { ProfileGlassButton } from '@/components/profile/ProfileControls';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import type { ShopProduct } from '@/services/profileService';

// Text sits straight on photos; white with a soft shadow keeps it legible on
// any image without a gradient scrim.
const ON_IMAGE = '#FFFFFF'; // theme-exempt: text over a full-bleed photo
const TEXT_SHADOW = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }; // theme-exempt

export function LookbookView({
  brandName,
  products,
  loading,
  following,
  followDisabled,
  onFollow,
  onBack,
  onOpenProduct,
  onShowStore,
  onMore,
  bottomInset = 0,
}: {
  brandName: string;
  products: ShopProduct[];
  loading: boolean;
  following: boolean;
  followDisabled?: boolean;
  onFollow: () => void;
  onBack: () => void;
  onOpenProduct: (product: ShopProduct) => void;
  /** Switches to the full store page (bio, stats, posts). */
  onShowStore: () => void;
  onMore: () => void;
  /** Height of a floating tab bar over the bottom of the screen, kept clear of the caption. */
  bottomInset?: number;
}) {
  const { theme } = useAppTheme();
  const screen = useWindowDimensions();
  // One look = exactly the visible area. The screen can sit inside a shell
  // that reserves room for a tab bar, so measure it rather than assume the
  // window height.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const width = box?.width ?? screen.width;
  const height = box?.height ?? screen.height;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const looks = products.filter((p) => !!p.imageUri);
  const captionBottom = Math.max(insets.bottom + SP.lg, bottomInset + SP.sm);

  const renderLook = useCallback(({ item }: { item: ShopProduct }) => (
    <Pressable
      onPress={() => onOpenProduct(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatCents(item.priceCents)}`}
      style={{ width, height, backgroundColor: theme.background }}
      testID="lookbook-look"
    >
      <CachedImage source={{ uri: item.imageUri! }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[styles.caption, { bottom: captionBottom }]} pointerEvents="none">
        <Text style={[styles.productName, TEXT_SHADOW]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.price, TEXT_SHADOW]}>{formatCents(item.priceCents)}</Text>
      </View>
    </Pressable>
  ), [captionBottom, height, onOpenProduct, theme.background, width]);

  return (
    <View
      style={[styles.root, { backgroundColor: theme.background }]}
      testID="seller-profile-lookbook"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0 && (w !== box?.width || h !== box?.height)) setBox({ width: w, height: h });
      }}
    >
      {loading && looks.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={theme.text} /></View>
      ) : looks.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.empty, { color: theme.muted }]}>No looks yet</Text>
        </View>
      ) : (
        <FlatList
          data={looks}
          keyExtractor={(p) => p.id}
          renderItem={renderLook}
          pagingEnabled
          // Reduce Motion: no momentum glide between looks — the page lands
          // immediately on the next one.
          decelerationRate={reduceMotion ? 0 : 'fast'}
          disableIntervalMomentum={reduceMotion}
          snapToInterval={height}
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
        />
      )}

      {/* Top bar: back, brand name (small), Follow, the full store page, more. */}
      <View style={[styles.topBar, { paddingTop: insets.top + SP.sm }]} pointerEvents="box-none">
        <ProfileGlassButton icon="arrow-left" onPress={onBack} accessibilityLabel="Go back" />
        <Text style={[styles.brand, TEXT_SHADOW]} numberOfLines={1} accessibilityRole="header">{brandName}</Text>
        <View style={styles.topRight}>
          <Pressable
            onPress={onFollow}
            disabled={followDisabled}
            accessibilityRole="button"
            accessibilityLabel={following ? 'Following' : 'Follow'}
            accessibilityState={{ disabled: !!followDisabled, selected: following }}
            style={[
              styles.follow,
              following
                ? { backgroundColor: theme.cardGlass, borderColor: theme.border }
                : { backgroundColor: ON_IMAGE, borderColor: ON_IMAGE },
              followDisabled && { opacity: 0.6 },
            ]}
            testID="lookbook-follow"
          >
            <Text style={[styles.followText, { color: following ? theme.text : '#000000' /* theme-exempt: on white pill */ }]}>
              {following ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
          <ProfileGlassButton icon="grid" onPress={onShowStore} accessibilityLabel="Show full store" />
          <ProfileGlassButton icon="more-horizontal" onPress={onMore} accessibilityLabel="More options" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: FONT.medium, fontSize: FS.base },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md,
  },
  brand: { flex: 1, minWidth: 0, color: ON_IMAGE, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  follow: { height: 32, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  followText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  caption: { position: 'absolute', left: SP.md, right: SP.md, gap: 2 },
  productName: { color: ON_IMAGE, fontFamily: FONT.medium, fontSize: FS.sm },
  price: { color: ON_IMAGE, fontFamily: FONT.regular, fontSize: FS.xs },
});

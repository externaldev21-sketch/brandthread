/**
 * "Shop the Look" — a horizontal rail of posts that carry a real seller
 * product tag, each card showing the post's own photo with the tagged
 * item's name + price beneath it. Tapping a card opens the same Shop sheet
 * (ShopProductSheet) the post viewer's own "Shop the look" pill already
 * opens — no second shopping surface. Mobbin reference: Weverse's "Merch"
 * rail — square post thumbnail, name, price, horizontal scroll
 * (https://mobbin.com/screens/83324318-8b8f-4193-a5e6-78a03b7a5640).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { hapticLight } from '@/lib/haptics';
import type { DiscoverPost } from '@/lib/discoverFeed';

const CARD_WIDTH = 130;
// 3:4 portrait (item 46) — consistent with every other Discover card/tile so
// the full garment shows instead of a square crop.
const CARD_IMAGE_HEIGHT = Math.round((CARD_WIDTH * 4) / 3);

export function DiscoverShopTheLookRail({ posts, onPress }: { posts: DiscoverPost[]; onPress: (post: DiscoverPost) => void }) {
  const { theme } = useAppTheme();
  if (posts.length === 0) return null;
  return (
    <View style={{ marginVertical: SP.md, paddingHorizontal: SP.md }}>
      <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: 10 }]}>Shop the Look</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {posts.map((post) => {
          const tag = post.productTags![0];
          const extra = post.productTags!.length - 1;
          return (
            <Pressable
              key={post.id}
              onPress={() => { hapticLight(); onPress(post); }}
              accessibilityRole="button"
              accessibilityLabel={`Shop ${tag.productName} from ${post.authorName}'s post`}
              style={{ width: CARD_WIDTH }}
            >
              {post.imageUri ? (
                <CachedImage source={{ uri: post.imageUri }} style={styles.image} contentFit="cover" contentPosition="top center" />
              ) : (
                <View style={[styles.image, styles.fallback, { backgroundColor: post.authorColor }]}>
                  <Text style={styles.fallbackText}>{post.authorInitials}</Text>
                </View>
              )}
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>
                {tag.productName}{extra > 0 ? ` +${extra}` : ''}
              </Text>
              <Text style={[styles.price, { color: theme.muted }]}>{formatCents(tag.priceCents)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 12 },
  image: { width: CARD_WIDTH, height: CARD_IMAGE_HEIGHT, borderRadius: RADII.card },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontSize: 28, fontFamily: FONT.bold, color: '#FFFFFF' },
  name: { fontSize: 13, fontFamily: FONT.semibold, marginTop: 6 },
  price: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
});

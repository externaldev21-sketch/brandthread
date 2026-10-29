/**
 * Quick-peek cards (micro-interactions pack 2, items 28 + 29), built on the
 * app's one long-press preview menu (lib/contextMenu + ContextMenuHost) —
 * the card rises over the blurred screen with its actions underneath, and
 * the peek's live row (Follow / Add to bag) sits in the preview's footer.
 *
 * Mobbin reference: Instagram — long-press an avatar or a product tag to peek
 * the profile / product without leaving the screen; tapping the card opens it.
 *
 *  - openProfilePeek: avatar, name, handle, follower count + Follow.
 *  - openProductPeek: photo, name, brand, price + Add to bag. A product with
 *    one buyable option is added straight away; one that needs a size choice
 *    opens its product page instead of guessing.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { openContextMenu } from '@/lib/contextMenu';
import { formatCompactCount } from '@/lib/compactFormat';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { FONT, FS } from '@/lib/theme';
import { addToCart, getBuyerProduct } from '@/services/cartService';
import { getSellerFollowState, setSellerFollowing } from '@/services/socialService';

// ─── Profile peek ─────────────────────────────────────────────────────────────

function ProfilePeekFooter({ userId }: { userId: string }) {
  const { theme } = useAppTheme();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let alive = true;
    getSellerFollowState(userId)
      .then((st) => {
        if (!alive) return;
        setFollowing(!!st.isFollowing);
        if (typeof st.followersCount === 'number') setFollowers(st.followersCount);
      })
      .catch(() => { if (alive) setFollowing(false); });
    return () => { alive = false; };
  }, [userId]);

  const toggle = async (next: boolean) => {
    setPending(true);
    setFollowing(next);
    setFollowers((n) => (n == null ? n : Math.max(0, n + (next ? 1 : -1))));
    try {
      const st = await setSellerFollowing(userId, next);
      setFollowing(!!st.isFollowing);
      if (typeof st.followersCount === 'number') setFollowers(st.followersCount);
    } catch {
      setFollowing(!next);
      setFollowers((n) => (n == null ? n : Math.max(0, n + (next ? -1 : 1))));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.row} testID="profile-peek-footer">
      <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
        {followers == null ? ' ' : `${formatCompactCount(followers)} ${followers === 1 ? 'follower' : 'followers'}`}
      </Text>
      <FollowMorphButton
        small
        following={!!following}
        disabled={following === null || pending}
        onChange={(next) => { void toggle(next); }}
      />
    </View>
  );
}

export function openProfilePeek(person: {
  userId: string;
  name: string;
  handle?: string | null;
  avatarUri?: string | null;
  onOpen: () => void;
}): boolean {
  haptic('longPress');
  return openContextMenu({
    preview: {
      title: person.name,
      subtitle: person.handle ? (person.handle.startsWith('@') ? person.handle : `@${person.handle}`) : null,
      avatarUri: person.avatarUri ?? null,
      footer: <ProfilePeekFooter userId={person.userId} />,
    },
    onPreviewPress: person.onOpen,
    items: [{ key: 'open', label: 'View profile', icon: 'user', onPress: person.onOpen }],
  });
}

// ─── Product peek ─────────────────────────────────────────────────────────────

function ProductPeekFooter({ productId, priceCents, onOpen }: { productId: string; priceCents?: number | null; onOpen: () => void }) {
  const { theme } = useAppTheme();
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'failed'>('idle');

  const add = async () => {
    if (state === 'adding') return;
    setState('adding');
    try {
      const product = await getBuyerProduct(productId);
      const options = product?.variants?.filter((v) => v.isAvailable) ?? [];
      // Needs a size/colour choice: hand off to the product page rather than
      // guessing an option for the buyer.
      if (!product || options.length !== 1) { setState('idle'); onOpen(); return; }
      const res = await addToCart({ product, variant: options[0], quantity: 1 });
      if (!res.success) { setState('failed'); return; }
      haptic('addToBag');
      setState('added');
    } catch {
      setState('failed');
    }
  };

  const label = state === 'added' ? 'Added to bag' : state === 'failed' ? 'Try again' : 'Add to bag';
  return (
    <View style={styles.row} testID="product-peek-footer">
      <Text style={[styles.price, { color: theme.text }]} numberOfLines={1}>
        {typeof priceCents === 'number' ? formatMoney(priceCents) : ' '}
      </Text>
      <Button
        label={label}
        size="compact"
        loading={state === 'adding'}
        disabled={state === 'added'}
        onPress={() => { void add(); }}
        testID="product-peek-add"
      />
    </View>
  );
}

export function openProductPeek(product: {
  productId: string;
  name: string;
  brand?: string | null;
  imageUri?: string | null;
  aspectRatio?: number;
  priceCents?: number | null;
  onOpen: () => void;
  /** Extra rows under the card (Save / Share …). */
  items?: Parameters<typeof openContextMenu>[0]['items'];
}): boolean {
  haptic('longPress');
  return openContextMenu({
    preview: {
      imageUri: product.imageUri ?? null,
      aspectRatio: product.aspectRatio,
      title: product.name,
      subtitle: product.brand ?? null,
      footer: <ProductPeekFooter productId={product.productId} priceCents={product.priceCents} onOpen={product.onOpen} />,
    },
    onPreviewPress: product.onOpen,
    items: product.items?.length ? product.items : [{ key: 'open', label: 'View product', icon: 'shopping-bag', onPress: product.onOpen }],
  });
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  meta: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  price: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.base, fontVariant: ['tabular-nums'] },
});

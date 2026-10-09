/**
 * The seller row on the buyer product page (SSENSE / Depop): avatar, name,
 * star rating + review count, @handle, and Follow. Tapping the row opens the
 * seller's store. Rating comes from the public seller reviews endpoint;
 * follow state is only fetched for a signed-in buyer looking at someone
 * else's product, and never for preview sellers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { Avatar } from '@/components/ui/Avatar';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { useSignInGate } from '@/hooks/useSignInGate';
import { isPreviewSellerId } from '@/lib/previewCheckout';
import { getSellerFollowState, setSellerFollowing } from '@/services/socialService';
import { FONT, FS, SP } from '@/lib/theme';
import { formatSellerRating, type SellerRating } from '@/lib/sellerRating';

export function ProductSellerRow({
  sellerId,
  sellerName,
  sellerHandle,
  sellerAvatarUri,
  onOpenStore,
}: {
  sellerId: string;
  sellerName: string;
  sellerHandle?: string;
  sellerAvatarUri?: string;
  onOpenStore: () => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const { userId } = useAuth();
  const { requireSignIn } = useSignInGate();
  const preview = isPreviewSellerId(sellerId);
  const isOwn = !!userId && userId === sellerId;
  const [rating, setRating] = useState<SellerRating | null>(null);
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!sellerId || preview) return undefined;
    let active = true;
    api.reviews.forSeller(sellerId)
      .then((data) => { if (active) setRating({ avgRating: Number(data.avgRating) || 0, totalCount: Number(data.totalCount) || 0 }); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, sellerId, preview]);

  useEffect(() => {
    if (!sellerId || preview || !userId || isOwn) return undefined;
    let active = true;
    getSellerFollowState(sellerId)
      .then((state) => { if (active) setFollowing(!!state.isFollowing); })
      .catch(() => {});
    return () => { active = false; };
  }, [sellerId, preview, userId, isOwn]);

  const toggleFollow = useCallback(async (next: boolean) => {
    if (pending || preview) return;
    if (!requireSignIn()) return;
    const previous = following;
    setPending(true);
    setFollowing(next);
    try {
      const confirmed = await setSellerFollowing(sellerId, next);
      setFollowing(!!confirmed.isFollowing);
    } catch {
      setFollowing(previous);
      Alert.alert('Couldn’t update follow', 'Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }, [following, pending, preview, requireSignIn, sellerId]);

  const ratingLabel = formatSellerRating(rating);
  const handle = sellerHandle ? `@${sellerHandle.replace(/^@/, '')}` : '';

  return (
    <View style={styles.row} testID="product-seller-row">
      <TouchableOpacity
        style={styles.identity}
        onPress={onOpenStore}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`View seller ${sellerName}${ratingLabel ? `, rated ${ratingLabel}` : ''}`}
        testID="product-seller-link"
      >
        <Avatar uri={sellerAvatarUri} name={sellerName} size={48} />
        <View style={styles.copy}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{sellerName}</Text>
          <View style={styles.metaRow}>
            {ratingLabel ? (
              <>
                <Feather name="star" size={12} color={theme.text} />
                <Text style={[styles.meta, { color: theme.text }]} testID="product-seller-rating">{ratingLabel}</Text>
              </>
            ) : null}
            {ratingLabel && handle ? <Text style={[styles.meta, { color: theme.muted }]}>·</Text> : null}
            {handle ? <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>{handle}</Text> : null}
          </View>
        </View>
      </TouchableOpacity>
      {!isOwn && (
        <View testID="product-seller-follow">
          <FollowMorphButton
            small
            following={following}
            onChange={(next) => { void toggleFollow(next); }}
            disabled={pending || preview}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm, minHeight: 56 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 44 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: FONT.semibold, fontSize: FS.base },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  meta: { fontFamily: FONT.medium, fontSize: FS.xs, flexShrink: 1 },
});

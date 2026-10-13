/**
 * Fits additions for the post viewer (F6 items 80-82), kept out of the
 * viewer itself so it only gains one header action and one render slot:
 *
 *  - info: "Stitch with @user" attribution (TikTok) when the post is a stitch,
 *    and the linked product when the post is a buyer fit check.
 *  - openMenu: the ••• menu — Stitch (anyone else's post); Tag product /
 *    Remove product (owner buyer); Request to repost (brands, buyer posts).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { CachedImage } from '@/components/CachedImage';
import { showActionSheet, type ActionSheetButton } from '@/components/ui/ActionSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { isUUID } from '@/lib/engagementUtils';
import { authorLabel, fitsErrorMessage, stitchHref } from '@/lib/fits';
import { fitsService, type FitProduct, type RepostRequestStatus, type StitchInfo } from '@/services/fitsService';
import { RADII } from '@/constants/radii';
import { FONT, FS, SP } from '@/lib/theme';

export function usePostFits({ postId, isOwner, authorAccountType }: {
  postId: string | undefined;
  isOwner: boolean;
  authorAccountType?: string | null;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { role } = useRole();
  const [stitch, setStitch] = useState<StitchInfo | null>(null);
  const [product, setProduct] = useState<FitProduct | null>(null);
  const [request, setRequest] = useState<{ id: string; status: RepostRequestStatus } | null>(null);
  const valid = !!postId && isUUID(postId);
  const brandViewingBuyer = role === 'seller' && !isOwner && authorAccountType === 'buyer';

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!valid || !postId) return;
    fitsService.stitch(postId).then((r) => { if (!cancelled) setStitch(r.stitch); }).catch(() => { if (!cancelled) setStitch(null); });
    fitsService.fitCheck(postId).then((r) => { if (!cancelled) setProduct(r.fitCheck.product); }).catch(() => { if (!cancelled) setProduct(null); });
    if (brandViewingBuyer) {
      fitsService.repostRequestStatus(postId).then((r) => { if (!cancelled) setRequest(r.request); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [valid, postId, brandViewingBuyer]));

  const openMenu = useCallback(() => {
    if (!valid || !postId) return;
    const buttons: ActionSheetButton[] = [];
    if (!isOwner) buttons.push({ text: 'Stitch', onPress: () => router.push(stitchHref(postId) as never) });
    if (isOwner && role !== 'seller') {
      const tag = () => router.push(`/fit-check-product?postId=${encodeURIComponent(postId)}${product ? `&current=${encodeURIComponent(product.id)}` : ''}` as never);
      if (product) {
        buttons.push({ text: 'Change product', onPress: tag });
        buttons.push({
          text: 'Remove product',
          style: 'destructive',
          onPress: () => { void fitsService.unlinkFitCheck(postId).then(() => setProduct(null)).catch(() => {}); },
        });
      } else {
        buttons.push({ text: 'Tag product', onPress: tag });
      }
    }
    if (brandViewingBuyer && request?.status !== 'approved' && request?.status !== 'declined') {
      if (request?.status === 'pending') {
        buttons.push({
          text: 'Withdraw repost request',
          style: 'destructive',
          onPress: () => { void fitsService.cancelRepostRequest(request.id).then((r) => setRequest(r.request)).catch(() => {}); },
        });
      } else {
        buttons.push({
          text: 'Request to repost',
          onPress: () => {
            void fitsService.requestRepost(postId)
              .then((r) => { setRequest(r.request); showActionSheet('Repost request sent', undefined, [{ text: 'OK', style: 'cancel' }]); })
              .catch((err) => showActionSheet(fitsErrorMessage(err, 'Couldn’t send the request. Try again.'), undefined, [{ text: 'OK', style: 'cancel' }]));
          },
        });
      }
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    showActionSheet(undefined, undefined, buttons);
  }, [brandViewingBuyer, isOwner, postId, product, request, role, router, valid]);

  const source = stitch && !('unavailable' in stitch.source) ? stitch.source : null;
  const info = stitch || product ? (
    <View style={styles.wrap}>
      {stitch ? (
        <Pressable
          style={styles.stitchRow}
          disabled={!source}
          onPress={() => source && router.push(`/buyer-post-viewer?postId=${encodeURIComponent(source.id)}` as never)}
          accessibilityRole="button"
          testID="post-stitch-attribution"
        >
          <Feather name="scissors" size={14} color={theme.text} />
          <Text style={styles.stitchText} numberOfLines={1}>
            {source || stitch.sourceAuthor ? `Stitch with ${authorLabel(stitch.sourceAuthor)}` : 'Stitch'}
          </Text>
          {!source ? <Text style={styles.unavailable}>Original unavailable</Text> : null}
        </Pressable>
      ) : null}
      {product ? (
        <Pressable
          style={styles.product}
          onPress={() => router.push(`/buyer-product-detail?productId=${encodeURIComponent(product.id)}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Fit check: ${product.name}`}
          testID="post-fit-check-product"
        >
          <View style={styles.productImage}>
            {product.imageUrl ? <CachedImage source={{ uri: product.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.productLabel}>Fit check</Text>
            <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.muted} />
        </Pressable>
      ) : null}
    </View>
  ) : null;

  return { info, openMenu: valid ? openMenu : undefined };
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  wrap: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm },
  stitchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stitchText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, flexShrink: 1 },
  unavailable: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs },
  product: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm, borderRadius: RADII.input, borderWidth: 1, borderColor: theme.border },
  productImage: { width: 40, height: 40, borderRadius: RADII.input, overflow: 'hidden', backgroundColor: theme.surface },
  productLabel: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs },
  productName: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
});

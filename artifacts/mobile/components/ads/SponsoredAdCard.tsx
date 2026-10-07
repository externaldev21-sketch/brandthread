/**
 * SponsoredAdCard — the one Sponsored ad card used by every buyer feed.
 *
 *  - variant "page": a full-screen page in the vertical Following / Threads
 *    (For You) pager — media fills the page, seller + "Sponsored" + headline
 *    sit bottom-left like a post caption, and a full-width CTA bar sits above
 *    the tab bar (Instagram Reels / TikTok in-feed ad pattern).
 *  - variant "card": a full-width row in the Discover grid — seller header with
 *    "Sponsored", 4:5 media, CTA bar, headline (Instagram feed ad pattern).
 *
 * Viewability: while the screen is focused the card measures itself every
 * 250ms and calls `onViewable(ad)` once after it has been >=50% on screen for
 * 1s continuously. Tapping anywhere calls `onPress(ad)`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, ON_DARK, ON_DARK_MUTED, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import type { FeedAd } from '@/lib/api';
import { AD_VIEWABLE_FRACTION, AD_VIEWABLE_MS, visibleFraction } from '@/lib/feedAds';

const POLL_MS = 250;
const SILVER = '#C0C0C0';

function useViewability(ad: FeedAd, onViewable?: (ad: FeedAd) => void) {
  const ref = useRef<View>(null);
  const focused = useIsFocused();
  const { height, width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const firedRef = useRef(false);
  const visibleSince = useRef<number | null>(null);

  useEffect(() => {
    if (!focused) { setVisible(false); visibleSince.current = null; return; }
    let cancelled = false;
    const check = () => {
      const node = ref.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
      node?.measureInWindow?.((x, y, w, h) => {
        if (cancelled) return;
        const isVisible = visibleFraction({ x, y, width: w, height: h }, { height, width }) >= AD_VIEWABLE_FRACTION;
        setVisible(isVisible);
        if (!isVisible) { visibleSince.current = null; return; }
        const now = Date.now();
        visibleSince.current ??= now;
        if (!firedRef.current && now - visibleSince.current >= AD_VIEWABLE_MS) {
          firedRef.current = true;
          onViewable?.(ad);
        }
      });
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [focused, height, width, ad, onViewable]);

  return { ref, visible };
}

function AdMedia({ ad, visible, style }: { ad: FeedAd; visible: boolean; style: object }) {
  const { theme } = useAppTheme();
  const uri = ad.mediaUrls[0] ?? ad.product?.imageUrl ?? null;
  const isVideo = ad.mediaKind === 'video' && !!ad.mediaUrls[0];
  const player = useVideoPlayer(isVideo ? uri : null, (p) => { p.loop = true; p.muted = true; });
  useEffect(() => {
    if (!isVideo) return;
    if (visible) player.play(); else player.pause();
  }, [isVideo, visible, player]);
  return (
    <View style={[style, { backgroundColor: theme.cardElevated, overflow: 'hidden' }]}>
      {isVideo ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      ) : uri ? (
        <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Feather name="image" size={28} color={theme.muted} />
        </View>
      )}
    </View>
  );
}

function SellerAvatar({ ad, size }: { ad: FeedAd; size: number }) {
  const initial = (ad.seller.displayName ?? ad.seller.username ?? 'B').trim().charAt(0).toUpperCase();
  return ad.seller.avatarUrl ? (
    <CachedImage source={{ uri: ad.seller.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#2A2A2E', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: ON_DARK, fontFamily: FONT.bold, fontSize: Math.round(size * 0.42) }}>{initial}</Text>
    </View>
  );
}

function sellerName(ad: FeedAd): string {
  return ad.seller.displayName ?? (ad.seller.username ? `@${ad.seller.username}` : 'Brandthread seller');
}

export type SponsoredAdCardProps = {
  ad: FeedAd;
  onPress: (ad: FeedAd) => void;
  onViewable?: (ad: FeedAd) => void;
} & (
  | { variant: 'page'; pageWidth: number; pageHeight: number; bottomClearance: number }
  | { variant: 'card' }
);

export function SponsoredAdCard(props: SponsoredAdCardProps) {
  const { ad, onPress, onViewable } = props;
  const { ref, visible } = useViewability(ad, onViewable);
  const { theme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const a11y = `Sponsored. ${sellerName(ad)}. ${ad.headline ?? ''}. ${ad.ctaLabel}`;

  if (props.variant === 'page') {
    const { pageWidth, pageHeight, bottomClearance } = props;
    return (
      <View ref={ref} collapsable={false} style={{ width: pageWidth, height: pageHeight, backgroundColor: '#000' }} testID="sponsored-ad-page">
        <Pressable onPress={() => onPress(ad)} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={a11y}>
          <AdMedia ad={ad} visible={visible} style={StyleSheet.absoluteFill} />
        </Pressable>
        <View pointerEvents="box-none" style={[pageStyles.bottom, { bottom: bottomClearance + 12 }]}>
          <View pointerEvents="none" style={pageStyles.info}>
            <View style={pageStyles.creatorRow}>
              <SellerAvatar ad={ad} size={22} />
              <Text style={pageStyles.creatorName} numberOfLines={1}>{sellerName(ad)}</Text>
            </View>
            <Text style={pageStyles.sponsored}>Sponsored</Text>
            {!!ad.headline && <Text style={pageStyles.headline} numberOfLines={2}>{ad.headline}</Text>}
            {!!ad.description && <Text style={pageStyles.caption} numberOfLines={2}>{ad.description}</Text>}
          </View>
          <Pressable
            onPress={() => onPress(ad)}
            style={({ pressed }) => [pageStyles.cta, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={ad.ctaLabel}
            testID="sponsored-ad-cta"
          >
            <Text style={pageStyles.ctaText}>{ad.ctaLabel}</Text>
            <Feather name="chevron-right" size={18} color="#000" />
          </Pressable>
        </View>
      </View>
    );
  }

  const mediaWidth = Math.min(windowWidth, 640);
  return (
    <View ref={ref} collapsable={false} style={[cardStyles.wrap, { borderColor: theme.border }]} testID="sponsored-ad-card">
      <Pressable onPress={() => onPress(ad)} accessibilityRole="button" accessibilityLabel={a11y}>
        <View style={cardStyles.header}>
          <SellerAvatar ad={ad} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={[cardStyles.seller, { color: theme.text }]} numberOfLines={1}>{sellerName(ad)}</Text>
            <Text style={cardStyles.sponsored}>Sponsored</Text>
          </View>
        </View>
        <AdMedia ad={ad} visible={visible} style={{ width: mediaWidth, height: Math.round((mediaWidth * 5) / 4) }} />
        <View style={[cardStyles.cta, { borderBottomColor: theme.border }]}>
          <Text style={[cardStyles.ctaText, { color: theme.text }]}>{ad.ctaLabel}</Text>
          {ad.product?.priceCents != null && (
            <Text style={[cardStyles.price, { color: theme.muted }]}>{formatCents(ad.product.priceCents)}</Text>
          )}
          <Feather name="chevron-right" size={18} color={theme.text} />
        </View>
        {(!!ad.headline || !!ad.description) && (
          <View style={cardStyles.body}>
            {!!ad.headline && (
              <Text style={[cardStyles.headline, { color: theme.text }]} numberOfLines={2}>{ad.headline}</Text>
            )}
            {!!ad.description && (
              <Text style={[cardStyles.description, { color: theme.muted }]} numberOfLines={2}>{ad.description}</Text>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}

const textShadow = Platform.select({
  default: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});

const pageStyles = StyleSheet.create({
  bottom: { position: 'absolute', left: 12, right: 12 },
  info: { maxWidth: '78%', marginBottom: 12 },
  creatorRow: { minHeight: 22, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  creatorName: { fontSize: 14, fontFamily: FONT.semibold, color: ON_DARK, flexShrink: 1, letterSpacing: 0.1, ...textShadow },
  sponsored: { fontSize: FS.meta, fontFamily: FONT.medium, color: ON_DARK_MUTED, marginBottom: 6, ...textShadow },
  headline: { fontSize: 15, fontFamily: FONT.semibold, color: ON_DARK, marginBottom: 4, lineHeight: 20, ...textShadow },
  caption: { fontSize: 13, fontFamily: FONT.medium, color: ON_DARK, lineHeight: 17, letterSpacing: 0.1, ...textShadow },
  cta: {
    height: 44, borderRadius: RADIUS.sm, backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md,
  },
  ctaText: { fontSize: FS.base, fontFamily: FONT.semibold, color: '#000000' },
});

const cardStyles = StyleSheet.create({
  wrap: { marginVertical: SP.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SP.md, paddingVertical: 10 },
  seller: { fontSize: FS.sm, fontFamily: FONT.semibold },
  sponsored: { fontSize: FS.meta, fontFamily: FONT.regular, color: SILVER, marginTop: 1 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 44,
    paddingHorizontal: SP.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ctaText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold },
  price: { fontSize: FS.sm, fontFamily: FONT.medium },
  body: { paddingHorizontal: SP.md, paddingVertical: 10, gap: 2 },
  headline: { fontSize: FS.sm, fontFamily: FONT.semibold },
  description: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
});

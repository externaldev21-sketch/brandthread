/**
 * Following tab empty state — TikTok "Trending creators" cards (Mobbin
 * following-2/3): real poster preview, avatar, name, handle, Follow.
 *
 * Sources (no fake users): authorized public For You posts from
 * getThreadPostsPage (grouped by sellerId; includes the official account
 * when the server serves its posts to this viewer) merged with
 * api.buyer.recommendedBrands. Only the centered card gets a muted player.
 * Follow uses the existing authenticated setSellerFollowing.
 * State is reset whenever the viewer changes (stale-identity guard).
 */
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';

import { CachedImage } from '@/components/CachedImage';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { useApi, type RecommendedBrand } from '@/lib/api';
import { FONT, FS, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { OFFICIAL_AVATAR_SOURCE } from '@/lib/officialAccount';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { pickPlaybackUri, remoteVideoUri } from '@/lib/videoPreload';
import { TrendingCreatorPreview } from './TrendingCreatorPreview';
import { createThreadFeedCursor, getThreadPostsPage, getSellerFollowStates, setSellerFollowing, type SellerThreadPost } from '@/services/socialService';

export interface TrendingCreator {
  sellerId: string; name: string; handle?: string; avatarUri?: string; posterUri?: string;
  verified: boolean; official: boolean; startPostId?: string;
  accountType: 'seller' | 'buyer';
  /** Authorized remote playback URL of a public video post (HLS on native, 720/480 MP4 otherwise). */
  videoUri?: string;
}

/** Remote, non-local playback URL for a public video post, else null (poster only). */
export function previewVideoUri(p: Pick<SellerThreadPost, 'contentType' | 'mediaUris' | 'hlsUrl'>, native: boolean): string | null {
  if (p.contentType !== 'video' || !p.mediaUris?.[0]) return null;
  const uri = remoteVideoUri(pickPlaybackUri(p.hlsUrl, p.mediaUris[0], native));
  if (!uri || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/i.test(uri)) return null;
  return uri;
}

/** The ONE card allowed a live player: the centered one, only while visible and it has a real video. */
export function previewSellerId(creators: TrendingCreator[], centerIndex: number, playing: boolean): string | null {
  if (!playing || centerIndex < 0) return null;
  const c = creators[Math.max(0, Math.min(creators.length - 1, centerIndex))];
  return c?.videoUri ? c.sellerId : null;
}

export function centeredIndex(offsetX: number, interval: number, count: number): number {
  if (interval <= 0 || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(offsetX / interval)));
}

/** Groups authorized public posts by seller, then appends recommended brands not already present. */
export function buildTrendingCreators(posts: unknown, brands: unknown, viewerId?: string | null, native = Platform.OS !== 'web'): TrendingCreator[] {
  const out = new Map<string, TrendingCreator>();
  for (const p of Array.isArray(posts) ? (posts as SellerThreadPost[]) : []) {
    if (!p || !p.sellerId || !p.authorName?.trim() || p.sponsored || p.postStatus !== 'published' || p.isDeleted || p.isArchived) continue;
    if (p.visibility?.isPublic === false || p.sellerId === viewerId) continue;
    const videoUri = previewVideoUri(p, native);
    const existing = out.get(p.sellerId);
    // Keep the first post per creator, but upgrade to their first real video.
    if (existing && (existing.videoUri || !videoUri)) continue;
    const official = !!p.isOfficial;
    out.set(p.sellerId, {
      sellerId: p.sellerId, name: p.authorName, handle: p.authorHandle, avatarUri: p.authorAvatarUri,
      posterUri: p.thumbnailUri ?? (p.contentType === 'video' ? undefined : p.mediaUris?.[0]),
      verified: official, official, startPostId: p.id, accountType: p.authorAccountType === 'buyer' ? 'buyer' : 'seller',
      videoUri: videoUri ?? undefined,
    });
  }
  for (const b of Array.isArray(brands) ? (brands as RecommendedBrand[]) : []) {
    if (!b || !b.sellerId || !b.name?.trim() || b.sellerId === viewerId || out.has(b.sellerId)) continue;
    out.set(b.sellerId, { sellerId: b.sellerId, name: b.name, avatarUri: b.logoUrl ?? undefined, verified: b.verified, official: false, accountType: 'seller' });
  }
  return [...out.values()].sort((a, b) => Number(b.official) - Number(a.official)).slice(0, 12);
}

/** Keep the existing width; a 5:8 card retains 90% of a 9:16 portrait clip. */
export function trendingCardSize(pageWidth: number) {
  const width = Math.round(Math.min(360, pageWidth * 0.71));
  return { width, height: Math.round(width * 1.6) };
}

export function FollowingTrendingCreators({ enabled, viewerId, pageWidth, onOpenCreator, fallback = null, focused = true, onRequireSignIn, onFollowError }: {
  /** Guest gate (existing requireSignIn): return false to stop the follow. */
  onRequireSignIn?: () => boolean;
  /** Signed-in follow/unfollow failed (quiet feed toast). */
  onFollowError?: (message: string) => void;
  enabled: boolean; viewerId?: string | null; pageWidth: number; fallback?: React.ReactNode;
  /** Screen focused and no sheet over it — the single preview may play. */
  focused?: boolean; onOpenCreator: (c: TrendingCreator) => void;
}) {
  const api = useApi();
  const { theme } = useAppTheme();
  const [creators, setCreators] = React.useState<TrendingCreator[]>([]);
  const [loading, setLoading] = React.useState(enabled);
  const [followed, setFollowed] = React.useState<Record<string, boolean>>({});
  const [pending, setPending] = React.useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = React.useState<Record<string, boolean>>({});
  const { width: cardW, height: cardH } = trendingCardSize(pageWidth);
  const side = Math.max(0, (pageWidth - cardW) / 2);
  const visible = creators.filter(c => !dismissed[c.sellerId]);
  const [center, setCenter] = React.useState(0);
  const [leaving, setLeaving] = React.useState(false);
  React.useEffect(() => { if (focused) setLeaving(false); }, [focused]);
  const interval = cardW + 10;

  // Identity guard: every async result is tagged with the generation and
  // viewer it started under; stale completions are dropped, and a render
  // for a new viewer never shows the previous viewer's cards/follow state.
  const generationRef = React.useRef(0);
  const ownerKey = `${enabled ? 1 : 0}:${viewerId ?? 'guest'}`;
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const playingId = previewSellerId(visible, center, enabled && focused && !leaving && loadedFor === ownerKey);
  React.useEffect(() => {
    const gen = ++generationRef.current;
    setCreators([]); setFollowed({}); setPending({}); setDismissed({}); setCenter(0);
    if (!enabled) { setLoading(false); setLoadedFor(ownerKey); return; }
    const active = () => generationRef.current === gen;
    setLoading(true);
    Promise.allSettled([
      getThreadPostsPage(createThreadFeedCursor(), 30, 'for-you'),
      viewerId ? api.buyer.recommendedBrands(12) : Promise.resolve({ brands: [] }),
    ]).then(async ([posts, brands]) => {
      if (!active()) return;
      setLoadedFor(ownerKey);
      const nextCreators = buildTrendingCreators(
        posts.status === 'fulfilled' ? posts.value.posts : [],
        brands.status === 'fulfilled' ? brands.value?.brands : [],
        viewerId,
      );
      setCreators(nextCreators);
      if (viewerId && nextCreators.length) {
        try {
          const states = await getSellerFollowStates(nextCreators.map(c => c.sellerId));
          if (active()) setFollowed(Object.fromEntries([...states].map(([id, state]) => [id, state.isFollowing])));
        } catch {
          if (active()) onFollowError?.("Couldn't load follow status. Tap Retry to check.");
        }
      }
    }).finally(() => { if (active()) setLoading(false); });
    return () => { if (generationRef.current === gen) generationRef.current += 1; };
  }, [api, enabled, viewerId, ownerKey]);

  const toggleFollow = async (c: TrendingCreator) => {
    if (pending[c.sellerId]) return;
    // Guests are sent to sign in — no optimistic flip, no silent rollback.
    if (!viewerId) { onRequireSignIn?.(); return; }
    if (onRequireSignIn && !onRequireSignIn()) return;
    if (typeof followed[c.sellerId] !== 'boolean') {
      const gen = generationRef.current;
      setPending(s => ({ ...s, [c.sellerId]: true }));
      try {
        const states = await getSellerFollowStates([c.sellerId]);
        if (generationRef.current === gen && states.has(c.sellerId)) setFollowed(s => ({ ...s, [c.sellerId]: states.get(c.sellerId)!.isFollowing }));
      } catch {
        if (generationRef.current === gen) onFollowError?.("Couldn't load follow status. Try again.");
      } finally {
        if (generationRef.current === gen) setPending(s => ({ ...s, [c.sellerId]: false }));
      }
      return;
    }
    const next = !followed[c.sellerId];
    const gen = generationRef.current;
    const live = () => generationRef.current === gen;
    setPending(s => ({ ...s, [c.sellerId]: true }));
    setFollowed(s => ({ ...s, [c.sellerId]: next }));
    try {
      const state = await setSellerFollowing(c.sellerId, next);
      if (live()) setFollowed(s => ({ ...s, [c.sellerId]: state.isFollowing }));
    } catch {
      if (live()) {
        setFollowed(s => ({ ...s, [c.sellerId]: !next }));
        onFollowError?.(next ? `Couldn't follow ${c.name}. Try again.` : `Couldn't unfollow ${c.name}. Try again.`);
      }
    } finally {
      if (live()) setPending(s => ({ ...s, [c.sellerId]: false }));
    }
  };

  if (!enabled) return null;
  const stale = loadedFor !== ownerKey;
  const showLoading = loading || stale;
  if (!showLoading && visible.length === 0 && viewerId) return <>{fallback}</>;
  return (
    <View style={styles.root} testID="following-trending-creators">
      <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">Trending creators</Text>
      <Text style={[styles.sub, { color: theme.muted }]}>Follow an account to see their latest videos here.</Text>
      {showLoading ? (
        <View style={[styles.track, { paddingHorizontal: side }]}><LoadingSkeleton height={cardH} style={{ width: cardW, borderRadius: RADII.card }} /></View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast"
          snapToInterval={interval} snapToAlignment="start" disableIntervalMomentum
          onMomentumScrollEnd={(e) => setCenter(centeredIndex(e.nativeEvent.contentOffset.x, interval, visible.length))}
          onScrollBeginDrag={() => setCenter(-1)}
          contentContainerStyle={[styles.track, { paddingHorizontal: side }]}>
          {visible.map((c) => {
            const isF = !!followed[c.sellerId];
            const followKnown = !viewerId || typeof followed[c.sellerId] === 'boolean';
            return (
              <View key={c.sellerId}
                style={[styles.card, { width: cardW, height: cardH, backgroundColor: theme.surface }]} testID={`trending-creator-${c.sellerId}`}>
                {c.posterUri ? <CachedImage source={{ uri: c.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                {playingId === c.sellerId && c.videoUri ? <TrendingCreatorPreview key={c.sellerId + c.videoUri} uri={c.videoUri} /> : null}
                <View style={styles.scrim} />
                <Pressable style={StyleSheet.absoluteFill} onPress={() => { setLeaving(true); onOpenCreator(c); }}
                  accessibilityRole="button" accessibilityLabel={`Open ${c.name}'s profile`} />
                <Pressable onPress={() => setDismissed(s => ({ ...s, [c.sellerId]: true }))} hitSlop={10} style={styles.close}
                  accessibilityRole="button" accessibilityLabel={`Hide ${c.name}`} testID={`trending-dismiss-${c.sellerId}`}>
                  <Icon name="x" size={16} color={ON_DARK} />
                </Pressable>
                <View style={styles.meta}>
                  <Pressable onPress={() => { setLeaving(true); onOpenCreator(c); }}
                    accessibilityRole="button" accessibilityLabel={`Open ${c.name}'s profile`} style={{ alignItems: 'center', gap: 4 }}>
                  <View style={styles.avatar}>
                    {c.official ? <CachedImage source={OFFICIAL_AVATAR_SOURCE} style={styles.fill} contentFit="cover" />
                      : c.avatarUri ? <CachedImage source={{ uri: c.avatarUri }} style={styles.fill} contentFit="cover" />
                      : <Text style={styles.initial}>{c.name.trim()[0]?.toUpperCase()}</Text>}
                  </View>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                    {c.verified ? <VerifiedBadge onMedia style={{ marginLeft: 4 }} /> : null}
                  </View>
                  {c.handle ? <Text style={styles.handle} numberOfLines={1}>{c.handle.startsWith('@') ? c.handle : `@${c.handle}`}</Text> : null}
                  </Pressable>
                  <TouchableOpacity onPress={() => { void toggleFollow(c); }} disabled={!!pending[c.sellerId]}
                    style={[styles.follow, { backgroundColor: isF ? 'rgba(255,255,255,0.2)' : theme.accent }]}
                    accessibilityRole="button" accessibilityState={{ checked: isF, busy: !!pending[c.sellerId] }}
                    accessibilityLabel={!followKnown ? `Retry follow status for ${c.name}` : isF ? `Unfollow ${c.name}` : `Follow ${c.name}`} testID={`trending-follow-${c.sellerId}`}>
                    <Text style={[styles.followText, { color: isF ? ON_DARK : theme.onAccent }]}>{!followKnown ? 'Retry' : isF ? 'Following' : 'Follow'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  title: { fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  sub: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', alignSelf: 'center', maxWidth: 260, marginTop: 6, marginBottom: 20, lineHeight: 18 },
  track: { flexDirection: 'row', gap: 10 },
  card: { borderRadius: RADII.card, overflow: 'hidden', justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.18)' },
  close: { position: 'absolute', top: 12, right: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  meta: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 24, gap: 4 },
  avatar: { width: 80, height: 80, borderRadius: RADII.pill, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ON_DARK, marginBottom: 6 },
  fill: { width: '100%', height: '100%' },
  initial: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xxl },
  nameRow: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%' },
  name: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.lg, flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  handle: { color: 'rgba(255,255,255,0.8)', fontFamily: FONT.regular, fontSize: FS.sm },
  follow: { marginTop: 12, alignSelf: 'stretch', height: 44, borderRadius: RADII.chip, alignItems: 'center', justifyContent: 'center' },
  followText: { fontFamily: FONT.semibold, fontSize: FS.base },
});

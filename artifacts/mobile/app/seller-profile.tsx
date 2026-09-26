/**
 * Seller profile — a brand's public profile, and the seller's own view of it
 * (`isOwner=true`, or automatically when a seller opens their own brand).
 *
 * Renders into the shared ProfileShell. The main content is the brand's feed
 * videos; tapping a tile opens the same full-screen feed player at that
 * video. Products live one tap away behind the floating "Shop N products"
 * pill (the seller's live listings, same source as product detail).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { getSellerFollowState, setSellerFollowing } from '@/services/socialService';
import type { SellerThreadPost } from '@/services/socialService';
import { formatProfileCount } from '@/services/profileService';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { buildCanonicalProfileUrl, shareLinkWithFallback } from '@/lib/shareProfile';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import {
  connectionsHref, messageSellerHref, profileProductsHref, profileVideosHref,
} from '@/lib/profileNavigation';
import { BrandDropsCard } from '@/components/BrandDropsCard';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { confirmBlock, reportHref } from '@/lib/safety';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticLight, hapticMedium, hapticSuccessAction } from '@/lib/haptics';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import {
  ProfileButton, ProfileChip, ProfileGlassButton, ShopPill, type ProfileStat,
} from '@/components/profile/ProfileControls';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridFooter, ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { useProfileLayout } from '@/components/profile/profileLayout';
import { useCreatorVideos } from '@/components/profile/useCreatorVideos';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import {
  CoverCoachmarkSheet, CoverHeroAffordance, CoverManageSheet, CoverTrimSheet, useProfileCover,
} from '@/components/profile/ProfileCover';

interface SellerView {
  sellerId: string;
  brandName: string;
  username: string;
  bio: string;
  website?: string;
  location?: string;
  category?: string;
  initials: string;
  verified: boolean;
  avatarUrl: string | null;
  bannerUrl: string | null;
  vacationMode: boolean;
  vacationMessage?: string;
  productsCount: number;
  videosCount: number;
  coverVideoUrl: string | null;
  coverPosterUrl: string | null;
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
}

function httpOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('http') ? value : null;
}

/** Adapts GET /api/public/sellers/:id (profile block) or GET /api/seller/profile. */
function toSellerView(profile: any, fallbackId: string): SellerView {
  const brandName = profile?.brandName ?? profile?.displayName ?? 'Seller';
  return {
    sellerId: profile?.clerkId ?? profile?.id ?? fallbackId,
    brandName,
    username: profile?.username ?? brandName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    bio: profile?.bio ?? '',
    website: profile?.website ?? undefined,
    location: profile?.location ?? undefined,
    category: profile?.category ?? undefined,
    initials: initialsOf(brandName),
    verified: profile?.verified === true,
    avatarUrl: httpOrNull(profile?.profileImageUrl) ?? httpOrNull(profile?.avatarUrl),
    bannerUrl: httpOrNull(profile?.bannerUrl),
    vacationMode: Boolean(profile?.vacationMode),
    vacationMessage: profile?.vacationMessage ?? undefined,
    productsCount: Number(profile?.productsCount ?? 0),
    videosCount: Number(profile?.videosCount ?? 0),
    coverVideoUrl: httpOrNull(profile?.coverVideoUrl),
    coverPosterUrl: httpOrNull(profile?.coverPosterUrl),
  };
}

export default function SellerProfileScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; sellerId?: string; isOwner?: string }>();
  const routeSellerId = params.id ?? params.sellerId;
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const layout = useProfileLayout();

  const [seller, setSeller] = useState<SellerView | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [rating, setRating] = useState<{ avgRating: number; totalCount: number } | null>(null);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SellerThreadPost | null>(null);
  const [snackbar, setSnackbar] = useState('');

  const explicitOwner = params.isOwner === 'true';
  // Canonical Clerk id from the API — follow/message/report/videos all use it,
  // never the route alias (which may be the users.id UUID from /u/:username).
  const canonicalSellerId = seller?.sellerId ?? null;
  const isOwner = explicitOwner || (!!userId && canonicalSellerId === userId);

  // ── Profile load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    if (explicitOwner && (!authLoaded || !userId)) {
      if (authLoaded) { setProfileLoading(false); setProfileError(true); }
      return () => { active = false; };
    }
    (async () => {
      if (reloadTick === 0) setProfileLoading(true);
      setProfileError(false);
      try {
        let view: SellerView;
        if (explicitOwner && !routeSellerId) {
          const own = await api.seller.getProfile();
          const publicData = await api.publicSellers.get(own.clerkId).catch(() => null);
          // The public read carries the signed avatar URL, live counts and the
          // derived verified badge; the owner read adds private fields.
          view = toSellerView({ ...own, ...(publicData?.profile ?? {}) }, own.clerkId);
        } else {
          if (!routeSellerId) throw new Error('Seller not found.');
          api.publicSellers.recordVisit(routeSellerId).catch(() => {});
          const data = await api.publicSellers.get(routeSellerId);
          view = toSellerView(data.profile ?? {}, routeSellerId);
        }
        if (!active) return;
        setSeller(view);
      } catch {
        if (active && reloadTick === 0) setProfileError(true);
      } finally {
        if (active) { setProfileLoading(false); setRefreshing(false); }
      }
    })();
    return () => { active = false; };
  }, [api, authLoaded, explicitOwner, routeSellerId, userId, reloadTick]);

  // ── Social counts + follow state (auth only; guests see public counts) ────
  useEffect(() => {
    if (!canonicalSellerId || !userId) return;
    let active = true;
    Promise.allSettled([
      isOwner ? Promise.resolve(null) : getSellerFollowState(canonicalSellerId),
      api.social.profile(canonicalSellerId),
    ]).then(([followState, social]) => {
      if (!active) return;
      if (followState.status === 'fulfilled' && followState.value) {
        setIsFollowing(followState.value.isFollowing);
        if (typeof followState.value.followersCount === 'number') setFollowers(followState.value.followersCount);
      }
      if (social.status === 'fulfilled' && social.value) {
        setFollowers(Number(social.value.followersCount ?? 0));
        setFollowing(Number(social.value.followingCount ?? 0));
      }
    });
    return () => { active = false; };
  }, [api, canonicalSellerId, isOwner, userId, reloadTick]);

  // ── Rating ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canonicalSellerId) return;
    let active = true;
    api.reviews.forSeller(canonicalSellerId)
      .then((data: any) => { if (active) setRating({ avgRating: data.avgRating ?? 0, totalCount: data.totalCount ?? 0 }); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, canonicalSellerId, reloadTick]);

  // ── Follow changes made anywhere else (feed rail, lists) update counts here ─
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !canonicalSellerId) return;
    if (event.targetId === canonicalSellerId) {
      setIsFollowing(event.isFollowing);
      if (typeof event.followersCount === 'number') setFollowers(event.followersCount);
    } else if (isOwner && event.viewerId === canonicalSellerId) {
      setFollowing((count) => (count == null ? count : Math.max(0, count + (event.isFollowing ? 1 : -1))));
    }
  }), [canonicalSellerId, isOwner]);

  const videos = useCreatorVideos(canonicalSellerId, { fresh: isOwner });
  const coverFlow = useProfileCover({
    own: isOwner,
    cover: { videoUrl: seller?.coverVideoUrl ?? null, posterUrl: seller?.coverPosterUrl ?? null },
    userId: canonicalSellerId,
  });

  // Returning to this profile (after posting, editing listings, deleting a
  // video, or following from another screen) silently refetches counts,
  // products and videos instead of showing the pre-change snapshot.
  const focusCountRef = useRef(0);
  const reloadVideos = videos.reload;
  useFocusEffect(useCallback(() => {
    focusCountRef.current += 1;
    if (focusCountRef.current === 1) return;
    setReloadTick((tick) => tick + 1);
    void reloadVideos({ fresh: true });
  }, [reloadVideos]));

  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(''), 2200);
    return () => clearTimeout(timer);
  }, [snackbar]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadTick((tick) => tick + 1);
    void videos.reload({ fresh: true });
  }, [videos]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleFollow = useCallback(async () => {
    if (followPending || !canonicalSellerId) return;
    const previous = { isFollowing, followers };
    const next = !isFollowing;
    setFollowPending(true);
    setIsFollowing(next);
    setFollowers((count) => (count == null ? count : Math.max(0, count + (next ? 1 : -1))));
    try {
      const confirmed = await setSellerFollowing(canonicalSellerId, next);
      setIsFollowing(confirmed.isFollowing);
      if (confirmed.followersCount != null) setFollowers(confirmed.followersCount);
    } catch {
      setIsFollowing(previous.isFollowing);
      setFollowers(previous.followers);
      Alert.alert('Couldn’t update follow', 'Check your connection and try again.');
    } finally {
      setFollowPending(false);
    }
  }, [canonicalSellerId, followPending, followers, isFollowing]);

  const handleShare = useCallback(() => {
    if (!seller) return;
    if (isOwner) {
      hapticLight();
      setShareSheetVisible(true);
      return;
    }
    const url = buildCanonicalProfileUrl(seller.username);
    if (!url) {
      if (Platform.OS !== 'web') void Share.share({ message: `Check out @${seller.username} on Brandthread` }).catch(() => {});
      return;
    }
    void shareLinkWithFallback({
      url,
      message: `Check out ${seller.brandName} on Brandthread:`,
      platformOS: Platform.OS,
      nativeShare: (content) => Share.share(content),
      webNavigator: typeof navigator !== 'undefined' ? (navigator as any) : null,
    })
      .then((result) => { if (result === 'copied') setSnackbar('Profile link copied'); })
      .catch(() => {});
  }, [isOwner, seller]);

  const handleMessageSeller = useCallback(() => {
    if (!seller) return;
    if (seller.vacationMode) {
      Alert.alert('Seller is away', seller.vacationMessage ?? 'This seller is currently away and is not accepting new messages.');
      return;
    }
    hapticMedium();
    router.push(messageSellerHref({
      sellerId: seller.sellerId,
      sellerName: seller.brandName,
      handle: seller.username,
      initials: seller.initials,
    }) as never);
  }, [router, seller]);

  const handleOpenInbox = useCallback(() => {
    hapticLight();
    router.push((isOwner ? '/seller-inbox' : '/(buyer)/inbox') as never);
  }, [isOwner, router]);

  const handleMoreOptions = useCallback(() => {
    if (!seller) return;
    const sellerId = seller.sellerId;
    Alert.alert(seller.brandName, 'What would you like to do?', [
      { text: 'Share profile', onPress: handleShare },
      ...(isOwner ? [] : [
        {
          text: 'Report seller',
          onPress: () => router.push(reportHref({
            targetType: 'profile',
            targetId: sellerId,
            label: seller.brandName,
            ownerId: sellerId,
            ownerName: seller.brandName,
          }) as never),
        },
        {
          text: `Block ${seller.brandName}`,
          style: 'destructive' as const,
          onPress: async () => {
            if (await confirmBlock({ userId: sellerId, name: seller.brandName }, api.social.block)) {
              if (router.canGoBack()) router.back();
              else router.replace('/(buyer)/' as never);
            }
          },
        },
      ]),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [api, handleShare, isOwner, router, seller]);

  const openVideo = useCallback((item: ProfileGridItem) => {
    if (!seller) return;
    router.push(profileVideosHref({ source: 'creator', id: seller.sellerId, startPostId: item.id, title: seller.brandName }) as never);
  }, [router, seller]);

  const handleTileLongPress = useCallback((item: ProfileGridItem) => {
    if (!isOwner) return;
    const post = videos.posts.find((candidate) => candidate.id === item.id) ?? null;
    if (post) { hapticMedium(); setSelectedPost(post); }
  }, [isOwner, videos.posts]);

  const handleCopyPostLink = useCallback(async (post: SellerThreadPost) => {
    const profileUrl = seller ? buildCanonicalProfileUrl(seller.username) : null;
    const url = profileUrl ? `${profileUrl}?post=${encodeURIComponent(post.id)}` : null;
    if (!url) { Alert.alert('Couldn’t copy link', 'Try again.'); return; }
    await Clipboard.setStringAsync(url);
    hapticSuccessAction();
    setSnackbar('Link copied');
  }, [seller]);

  const openShop = useCallback(() => {
    if (!seller) return;
    router.push(profileProductsHref({ sellerId: seller.sellerId, sellerName: seller.brandName, isOwner }) as never);
  }, [isOwner, router, seller]);

  const gridItems = useMemo(() => videos.posts.map(gridItemFromThreadPost), [videos.posts]);
  const renderTile = useCallback(({ item, index }: { item: ProfileGridItem; index: number }) => (
    <ProfileVideoTile
      item={item}
      index={index}
      width={layout.tileWidth}
      height={layout.tileHeight}
      onPress={openVideo}
      onLongPress={isOwner ? handleTileLongPress : undefined}
    />
  ), [handleTileLongPress, isOwner, layout.tileHeight, layout.tileWidth, openVideo]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  }, [router]);

  // ── Error: the profile itself couldn't load ────────────────────────────────
  if (profileError && !seller) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + SP.sm }]}>
        <View style={styles.errorBar}>
          <ProfileGlassButton icon="arrow-left" onPress={goBack} accessibilityLabel="Go back" />
        </View>
        <EmptyState
          icon="alert-triangle"
          title="Couldn't load this profile"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => { setProfileLoading(true); setProfileError(false); setReloadTick((tick) => tick + 1); } }}
        />
      </View>
    );
  }

  const brandName = seller?.brandName ?? '';
  const firstVideo = videos.posts.find((post) => post.contentType === 'video' && post.mediaUris[0]);
  const heroPoster = firstVideo?.thumbnailUri
    ?? seller?.bannerUrl
    ?? (gridItems[0]?.posterUri ?? null);
  const videosCount = Math.max(videos.total, seller?.videosCount ?? 0);
  const productsCount = seller?.productsCount ?? 0;

  const stats: ProfileStat[] = [
    { key: 'videos', label: 'Videos', value: formatProfileCount(videosCount) },
    {
      key: 'followers', label: 'Followers', value: followers == null ? '–' : formatProfileCount(followers),
      onPress: canonicalSellerId ? () => router.push(connectionsHref('followers', isOwner ? null : canonicalSellerId) as never) : undefined,
    },
    {
      key: 'following', label: 'Following', value: following == null ? '–' : formatProfileCount(following),
      onPress: canonicalSellerId ? () => router.push(connectionsHref('following', isOwner ? null : canonicalSellerId) as never) : undefined,
    },
    { key: 'rating', label: 'Rating', value: rating && rating.totalCount > 0 ? rating.avgRating.toFixed(1) : '–' },
  ];

  const actions = isOwner ? (
    <>
      <View style={styles.actionRow}>
        <ProfileButton label="Edit profile" icon="edit-3" variant="primary" onPress={() => router.push('/edit-profile' as never)} testID="seller-profile-edit" />
        <ProfileButton
          label="Share profile"
          icon="share-2"
          onPress={handleShare}
          accessibilityHint="Opens your shareable profile link and QR code"
          testID="seller-profile-share-btn"
        />
      </View>
      <View style={styles.actionRow}>
        <ProfileButton label="Messages" icon="message-circle" onPress={handleOpenInbox} />
        <ProfileButton label="Create post" icon="video" onPress={() => router.push('/create-post' as never)} />
      </View>
    </>
  ) : (
    <>
      <View style={styles.actionRow}>
        <View style={styles.flex} testID="seller-profile-follow-btn">
          <FollowMorphButton
            following={isFollowing}
            onChange={handleFollow}
            disabled={followPending || !canonicalSellerId || !userId}
            style={styles.followBtn}
            labelStyle={{ fontFamily: FONT.bold, fontSize: FS.base }}
          />
        </View>
        <ProfileButton label="Message" icon="message-circle" onPress={handleMessageSeller} />
      </View>
      <View style={styles.actionRow}>
        <ProfileButton label="Share" icon="share-2" onPress={handleShare} accessibilityHint="Share this seller profile" />
        <ProfileButton label="More" icon="more-horizontal" onPress={handleMoreOptions} accessibilityLabel="More options" />
      </View>
    </>
  );

  const meta = seller ? (
    <ProfileMeta
      bio={seller.bio}
      website={seller.website}
      location={seller.location}
      onOpenWebsite={(url) => { void Linking.openURL(url); }}
    >
      {seller.category ? <ProfileChip label={seller.category} icon="tag" /> : null}
      {!isOwner && seller.vacationMode ? (
        <View style={styles.vacation} accessibilityRole="alert">
          <Feather name="sun" size={16} color={theme.warning} />
          <View style={styles.flex}>
            <Text style={styles.vacationTitle}>This seller is away</Text>
            <Text style={styles.vacationText}>{seller.vacationMessage ?? 'Purchases and new messages are paused for now.'}</Text>
          </View>
        </View>
      ) : null}
    </ProfileMeta>
  ) : null;

  const showShopPill = !!seller && (isOwner || productsCount > 0);
  const videosEmpty = profileEmptyState('seller:videos', isOwner);

  return (
    <>
      <ProfileShell
        testID="seller-profile-hero"
        isOwnProfile={isOwner}
        identity={{
          name: brandName || ' ',
          handle: seller?.username ? `@${seller.username}` : null,
          initials: seller?.initials ?? '',
          avatarUrl: seller?.avatarUrl,
          verified: seller?.verified,
          roleLabel: 'Seller',
        }}
        avatar={{ ring: !!seller?.verified, liveHostId: canonicalSellerId ?? routeSellerId ?? null }}
        // A cover video, when set, leads the hero for every viewer (muted,
        // looping, poster first); otherwise the latest video.
        hero={coverFlow.hasCover
          ? { videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }
          : { videoUri: firstVideo?.mediaUris[0] ?? null, posterUri: heroPoster }}
        coverAffordance={isOwner ? (
          <CoverHeroAffordance hasCover={coverFlow.hasCover} busy={coverFlow.busy} onAdd={coverFlow.startAdd} onManage={coverFlow.openManage} />
        ) : undefined}
        topLeft={<ProfileGlassButton icon="arrow-left" onPress={goBack} accessibilityLabel="Go back" />}
        topRight={(
          <>
            <ProfileGlassButton
              icon="message-circle"
              onPress={isOwner ? handleOpenInbox : handleMessageSeller}
              accessibilityLabel={isOwner ? 'Inbox' : 'Message seller'}
            />
            <ProfileGlassButton
              icon="share-2"
              onPress={handleShare}
              accessibilityLabel={isOwner ? 'Share profile' : 'Share seller profile'}
            />
          </>
        )}
        meta={meta}
        stats={stats}
        statsLoading={profileLoading}
        actions={actions}
        extras={canonicalSellerId ? <BrandDropsCard sellerId={canonicalSellerId} sellerName={brandName} /> : null}
        section={{ label: 'Videos', count: videosCount }}
        data={gridItems}
        renderItem={renderTile}
        keyExtractor={(item) => item.id}
        numColumns={layout.gridColumns}
        listKey={`seller-grid-${layout.gridColumns}`}
        ListEmptyComponent={(
          <ProfileGridPlaceholder
            loading={profileLoading || videos.loading}
            error={videos.error}
            onRetry={() => { void videos.reload({ fresh: true }); }}
            layout={layout}
            icon={videosEmpty.icon as never}
            title={videosEmpty.title}
            description={isOwner ? videosEmpty.message : `${brandName || 'This brand'} hasn't posted any videos yet.`}
            action={videosEmpty.cta ? { label: videosEmpty.cta.label, onPress: () => router.push(videosEmpty.cta!.route as never) } : undefined}
            testID="seller-profile-videos-empty"
          />
        )}
        ListFooterComponent={<ProfileGridFooter loadingMore={videos.loadingMore} />}
        onEndReached={videos.loadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        renderFloating={showShopPill ? (bottom) => (
          <ShopPill
            bottom={bottom}
            label={productsCount > 0 ? `Shop ${productsCount} product${productsCount === 1 ? '' : 's'}` : 'Set up your shop'}
            sublabel={isOwner ? (productsCount > 0 ? 'Your live listings' : 'Add a product') : brandName}
            onPress={openShop}
          />
        ) : undefined}
      />

      {/* ── Owner post actions (long-press a tile) ── */}
      <Modal visible={!!selectedPost} transparent animationType="slide" onRequestClose={() => setSelectedPost(null)}>
        <PressableScale style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setSelectedPost(null)} accessibilityLabel="Close post actions" />
        {selectedPost ? (
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>{selectedPost.caption || 'Post'}</Text>
            <SheetRow icon="play" label="Play" onPress={() => { const post = selectedPost; setSelectedPost(null); openVideo(gridItemFromThreadPost(post)); }} />
            <SheetRow icon="edit-2" label="Edit post" onPress={() => { const post = selectedPost; setSelectedPost(null); router.push(('/create-post?editId=' + post.id) as never); }} />
            <SheetRow icon="bar-chart-2" label="View analytics" onPress={() => { const post = selectedPost; setSelectedPost(null); router.push(('/post-analytics?id=' + post.id) as never); }} />
            <SheetRow icon="copy" label="Copy link" onPress={() => { const post = selectedPost; setSelectedPost(null); void handleCopyPostLink(post); }} />
          </View>
        ) : null}
      </Modal>

      {isOwner ? (
        <>
          <CoverCoachmarkSheet
            visible={coverFlow.coachmarkVisible}
            onAdd={() => { coverFlow.dismissCoachmark(); coverFlow.startAdd(); }}
            onLater={coverFlow.dismissCoachmark}
          />
          <CoverManageSheet visible={coverFlow.manageOpen} onChange={coverFlow.changeFromManage} onRemove={() => { void coverFlow.remove(); }} onClose={coverFlow.closeManage} />
          <CoverTrimSheet source={coverFlow.trimSource} onCancel={coverFlow.cancelTrim} onConfirm={coverFlow.confirmTrim} />
        </>
      ) : null}
      {isOwner ? (
        <ShareProfileSheet
          visible={shareSheetVisible}
          onClose={() => setShareSheetVisible(false)}
          avatarUrl={seller?.avatarUrl ?? null}
          sellerExtra={{
            rating,
            products: videos.posts.slice(0, 3).map((post) => ({ id: post.id, uri: post.thumbnailUri ?? post.mediaUris[0] })),
          }}
        />
      ) : null}

      <Snackbar visible={!!snackbar} message={snackbar} onDismiss={() => setSnackbar('')} />
    </>
  );
}

function SheetRow({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale style={sheetRowStyles.row} onPress={() => { hapticMedium(); onPress(); }} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={18} color={theme.text} />
      <Text style={[sheetRowStyles.label, { color: theme.text }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={theme.muted} />
    </PressableScale>
  );
}

const sheetRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: SP.md, minHeight: 52 },
  label: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
});

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    flex: { flex: 1 },
    actionRow: { flexDirection: 'row', gap: SP.sm },
    followBtn: { width: '100%', minHeight: 48, borderRadius: RADIUS.md },
    vacation: {
      flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.xs,
      borderWidth: 1, borderColor: `${theme.warning}55`, borderRadius: RADIUS.md, padding: SP.sm,
    },
    vacationTitle: { color: theme.warning, fontFamily: FONT.bold, fontSize: FS.sm, marginBottom: 3 },
    vacationText: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
    errorRoot: { flex: 1, backgroundColor: theme.background },
    errorBar: { paddingHorizontal: SP.md, alignItems: 'flex-start' },
    sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' }, // theme-exempt: modal scrim
    sheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
      borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border,
    },
    sheetHandle: { width: 36, height: 4, backgroundColor: theme.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: SP.sm },
    sheetTitle: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  });
}

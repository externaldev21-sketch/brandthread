/**
 * Full-screen Discover post viewer — vertical swipe through the same set of
 * results the grid tile was tapped from (Instagram Explore's own post-detail
 * behavior). Video posts show their poster with a play glyph in this v1 —
 * a full player is a follow-up, not required for the grid/viewer/filters
 * scope this PR covers.
 *
 * Like / Save are real for real posts (POST /api/posts/:id/interact and
 * /api/buyer/saved, same calls as the Threads feed), optimistic with a
 * rollback + toast on failure, and remembered for the session
 * (lib/discoverEngagement.ts) so reopening a post shows them. Comments opens
 * the shared /buyer-post-comments sheet; Share opens the shared
 * ThreadShareSheet.
 */
import React, { useEffect, useState } from 'react';
import { Dimensions, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { IconButton } from '@/components/ui/IconButton';
import FollowButton from '@/components/social/FollowButton';
import { formatCents } from '@/lib/money';
import { formatCompactCount } from '@/lib/compactFormat';
import { FONT, FS, SP, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { hapticLight, hapticPrimaryAction } from '@/lib/haptics';
import type { DiscoverPost } from '@/lib/discoverFeed';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { isUUID } from '@/lib/engagementUtils';
import { apiErrorMessage } from '@/lib/safety';
import { discoverEngagementFor, discoverPostApiId, rememberDiscoverEngagement, toggledLike } from '@/lib/discoverEngagement';
import { FeedToastProvider, useFeedToast } from '@/components/EngagementButton';
import { ThreadShareSheet } from '@/components/ThreadShareSheet';
import { TranslatableCaption } from '@/components/translation/CaptionTranslation';

const { height: WINDOW_HEIGHT } = Dimensions.get('window');

function ActionButton({ icon, label, active, onPress }: {
  icon: keyof typeof Feather.glyphMap; label?: string; active?: boolean; onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      <Feather name={icon} size={26} color={active ? '#FF3B57' : '#FFFFFF'} />
      {!!label && <Text style={styles.actionLabel}>{label}</Text>}
    </PressableScale>
  );
}

function ViewerPage({
  post, onOpenProfile, onOpenShopTheLook, onSafetyMenu, onOpenComments, onRequireSignIn,
}: {
  post: DiscoverPost;
  onOpenProfile: (post: DiscoverPost) => void;
  onOpenShopTheLook: (post: DiscoverPost) => void;
  onSafetyMenu: (post: DiscoverPost) => void;
  onOpenComments: (post: DiscoverPost) => void;
  onRequireSignIn: () => void;
}) {
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { showToast } = useFeedToast();
  const [engagement, setEngagementState] = useState(() => discoverEngagementFor(post));
  const { liked, likesCount, saved } = engagement;
  const [shareOpen, setShareOpen] = useState(false);
  // The author's Follow pill starts from the viewer's real follow state.
  const [followInitial, setFollowInitial] = useState({ isFollowing: false, isFollowedBy: false, isMutual: false });
  useEffect(() => {
    if (!isSignedIn || !post.authorId || post.authorId.startsWith('preview-')) return undefined;
    let cancelled = false;
    api.social.status(post.authorId)
      .then((r) => { if (!cancelled) setFollowInitial({ isFollowing: !!r?.isFollowing, isFollowedBy: !!r?.isFollowedBy, isMutual: !!r?.isMutual }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, isSignedIn, post.authorId]);
  const hasTags = (post.productTags?.length ?? 0) > 0;
  // Real posts persist through the API; seeded preview posts (non-UUID ids,
  // `&demo=1` only) have nothing to persist against and stay session-local.
  const apiPostId = discoverPostApiId(post.id);
  const isRealPost = isUUID(apiPostId);

  function setEngagement(next: typeof engagement) {
    setEngagementState(next);
    rememberDiscoverEngagement(post.id, next);
  }

  async function handleLike() {
    hapticLight();
    if (isRealPost && !isSignedIn) { onRequireSignIn(); return; }
    const before = engagement;
    const next = toggledLike(before);
    setEngagement(next);
    if (!isRealPost) return;
    try {
      await api.posts.interact(apiPostId, { type: 'like', value: next.liked ? 'add' : 'remove' });
    } catch (error) {
      setEngagement(before);
      showToast(apiErrorMessage(error, 'Could not update like. Try again.'), 'error');
    }
  }

  async function handleSave() {
    hapticLight();
    if (isRealPost && !isSignedIn) { onRequireSignIn(); return; }
    const before = engagement;
    const next = { ...before, saved: !before.saved };
    setEngagement(next);
    if (!isRealPost) return;
    try {
      if (next.saved) {
        await api.buyer.saved.save({
          type: 'post',
          targetId: apiPostId,
          title: post.caption?.trim() || `${post.authorName}'s post`,
          subtitle: post.authorName,
        });
      } else {
        await api.buyer.saved.remove(apiPostId);
      }
    } catch (error) {
      setEngagement(before);
      showToast(apiErrorMessage(error, 'Could not update save. Try again.'), 'error');
    }
  }

  return (
    <View style={{ width: '100%', height: WINDOW_HEIGHT, backgroundColor: '#000' }}>
      {post.imageUri ? (
        // Video stays full-bleed cover (9:16 rule, unchanged). Photos show
        // the creator's chosen 3:4 crop uncropped — letterboxed on black
        // rather than cover-cropped to fill the taller viewer frame.
        <CachedImage
          source={{ uri: post.imageUri }}
          style={StyleSheet.absoluteFill}
          contentFit={post.media === 'video' ? 'cover' : 'contain'}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}
      {post.media === 'video' && (
        <View style={styles.playGlyph}>
          <Feather name="play" size={40} color="#FFFFFFCC" />
        </View>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.6)']}
        locations={[0, 0.3, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Bottom-left: author, caption, Shop the look */}
      <View style={[styles.bottomWrap, { paddingBottom: insets.bottom + SP.xl }]}>
        <PressableScale onPress={() => onOpenProfile(post)} style={styles.authorRow}>
          {post.authorAvatarUrl ? (
            <Image source={{ uri: post.authorAvatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: post.authorColor }]}>
              <Text style={styles.avatarInitials}>{post.authorInitials}</Text>
            </View>
          )}
          <Text style={styles.authorName} numberOfLines={1}>{post.authorName}</Text>
          {post.authorVerified && <Feather name="check-circle" size={14} color={ON_DARK} style={{ marginLeft: 4 }} />}
        </PressableScale>
        <View style={{ marginTop: SP.sm }}>
          <FollowButton
            userId={post.authorId}
            initial={followInitial}
            size="compact"
            style={styles.followInline}
          />
        </View>
        {!!post.caption && <TranslatableCaption text={post.caption} style={styles.caption} numberOfLines={3} linkStyle={styles.translationLink} />}
        {hasTags && (
          <Pressable
            onPress={() => { hapticPrimaryAction(); onOpenShopTheLook(post); }}
            style={styles.shopPill}
            accessibilityRole="button"
            accessibilityLabel="Shop the look"
          >
            <Feather name="shopping-bag" size={14} color="#000000" />
            <Text style={styles.shopPillText}>
              Shop the look{post.productTags!.length > 1 ? ` · ${post.productTags!.length}` : ` · ${formatCents(post.productTags![0].priceCents)}`}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Right action rail */}
      <View style={[styles.actionRail, { bottom: insets.bottom + SP.xl }]}>
        <ActionButton
          icon={liked ? 'heart' : 'heart'}
          active={liked}
          label={formatCompactCount(likesCount)}
          onPress={() => { void handleLike(); }}
        />
        <ActionButton icon="message-circle" label={formatCompactCount(post.commentsCount)} onPress={() => { hapticLight(); onOpenComments(post); }} />
        <ActionButton icon="send" label="Share" onPress={() => { hapticLight(); setShareOpen(true); }} />
        <ActionButton
          icon="bookmark"
          active={saved}
          onPress={() => { void handleSave(); }}
        />
        <ActionButton icon="more-horizontal" onPress={() => onSafetyMenu(post)} />
      </View>

      <ThreadShareSheet
        visible={shareOpen}
        postId={apiPostId}
        creator={post.authorName}
        caption={post.caption ?? ''}
        mediaUri={post.imageUri}
        isVideo={false}
        onClose={() => setShareOpen(false)}
        onReport={() => { setShareOpen(false); onSafetyMenu(post); }}
        onNotInterested={() => { setShareOpen(false); onSafetyMenu(post); }}
        onFeedback={showToast}
      />
    </View>
  );
}

export function DiscoverPostViewer({
  posts, startIndex, onClose, onOpenShopTheLook, onSafetyMenu,
}: {
  posts: DiscoverPost[];
  startIndex: number;
  onClose: () => void;
  onOpenShopTheLook: (post: DiscoverPost) => void;
  onSafetyMenu: (post: DiscoverPost) => void;
}) {
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();

  function openProfile(post: DiscoverPost) {
    if (post.authorAccountType === 'seller') {
      router.push(`/seller-profile?id=${encodeURIComponent(post.authorId)}&src=feed` as never);
    } else {
      router.push(`/buyer-other-profile?userId=${encodeURIComponent(post.authorId)}&name=${encodeURIComponent(post.authorName)}&handle=${encodeURIComponent(post.authorHandle)}&initials=${encodeURIComponent(post.authorInitials)}` as never);
    }
  }

  // The viewer is a Modal, which sits above the navigation stack — close it
  // before pushing a route so the pushed screen is actually visible.
  function openComments(post: DiscoverPost) {
    const qs = new URLSearchParams({
      postId: discoverPostApiId(post.id),
      postAuthorId: post.authorId,
      postAuthorName: post.authorName,
      postAuthorInitials: post.authorInitials,
      postAuthorColor: post.authorColor,
      postCaption: post.caption ?? '',
      postMediaUri: post.imageUri ?? '',
      postPosterUri: post.imageUri ?? '',
      // Discover rows only carry the poster image, so the sheet's backdrop
      // shows it as a photo either way.
      postType: 'photo',
    });
    onClose();
    router.push(`/buyer-post-comments?${qs.toString()}` as never);
  }

  function requireSignIn() {
    onClose();
    router.push('/sign-in' as never);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <FeedToastProvider>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          initialScrollIndex={startIndex}
          getItemLayout={(_, index) => ({ length: WINDOW_HEIGHT, offset: WINDOW_HEIGHT * index, index })}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ViewerPage
              post={item}
              onOpenProfile={openProfile}
              onOpenShopTheLook={onOpenShopTheLook}
              onSafetyMenu={onSafetyMenu}
              onOpenComments={openComments}
              onRequireSignIn={requireSignIn}
            />
          )}
        />
        <IconButton
          name="chevron-left"
          variant="glass"
          size={26}
          onPress={onClose}
          accessibilityLabel="Close"
          testID="discover-viewer-close"
          style={[styles.backBtn, { top: headerTopInset + 8 }]}
        />
      </View>
      </FeedToastProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: '#111' },
  playGlyph: { position: 'absolute', top: '45%', left: '45%' },
  backBtn: {
    position: 'absolute', left: SP.md, width: 40, height: 40,
  },
  bottomWrap: { position: 'absolute', left: 0, right: 80, bottom: 0, paddingHorizontal: SP.md },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.sm },
  authorName: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.sm, marginLeft: 8 },
  followInline: { alignSelf: 'flex-start' },
  caption: { color: '#FFFFFF', fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm },
  translationLink: { color: ON_DARK },
  shopPill: {
    marginTop: SP.sm, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderRadius: RADII.pill, paddingHorizontal: 14, paddingVertical: 9,
  },
  shopPillText: { color: '#000000', fontFamily: FONT.semibold, fontSize: FS.xs },
  actionRail: { position: 'absolute', right: SP.md, alignItems: 'center', gap: SP.md },
  actionBtn: { alignItems: 'center', gap: 3 },
  actionLabel: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 11 },
});

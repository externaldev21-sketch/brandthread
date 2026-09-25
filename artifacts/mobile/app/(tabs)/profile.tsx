/**
 * Seller's own Profile tab — the same ProfileShell as the public brand
 * profile, with the owner's tools: account switcher, notifications / share /
 * settings, Edit Profile (brand name + bio sheet), Go Live, Create Post,
 * quick actions, Post / Draft / Schedule content filters, and the floating
 * "Shop N products" pill into the seller's live listings.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  KeyboardAvoidingView, Modal, Platform, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { reportNetworkError } from '@/lib/networkNotice';
import {
  CARD, BORDER, FG, MUTED,
  FONT, FS, SP, RADIUS, SURFACE,
} from '@/lib/theme';
import { SheetRise } from '@/components/motion/SheetRise';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, profileProductsHref, profileVideosHref } from '@/lib/profileNavigation';
import { formatProfileCount } from '@/services/profileService';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import {
  ProfileButton, ProfileChip, ProfileGlassButton, ShopPill, type ProfileStat, type ProfileTab,
} from '@/components/profile/ProfileControls';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import { useProfileLayout } from '@/components/profile/profileLayout';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';

// ─── Profile data shape ──────────────────────────────────────────────────────

interface SellerProfileData {
  brandName:          string | null;
  displayName:        string | null;
  bio:                string | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  totalLikes:         number;
  profileImageUrl:    string | null;
  verified:           boolean;
  metrics: {
    revenueCents: number;
    visitors: number;
    orders: number;
    conversionRate: number;
  };
}

interface SocialCounts {
  followers: number;
  following: number;
  likes:     number;
}

const QUICK_ACTIONS: { icon: keyof typeof Feather.glyphMap; label: string; route: string }[] = [
  { icon: 'user',       label: 'My Profile',    route: '/edit-profile' },
  { icon: 'message-circle', label: 'Messages',  route: '/seller-inbox' },
];

const CONTENT_TABS = ['Post', 'Draft', 'Schedule'];
const CONTENT_TAB_ITEMS: ProfileTab[] = [
  { key: 'Post', label: 'Post', icon: 'grid' },
  { key: 'Draft', label: 'Draft', icon: 'file-text' },
  { key: 'Schedule', label: 'Schedule', icon: 'clock' },
];

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router  = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const layout = useProfileLayout();
  // The seller tab bar floats over content (same metrics as the global bar).
  const sellerBarInset = useTabBarMetrics(2).occupiedHeight;
  const { isLoaded: authLoaded, userId } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [sellerPosts, setSellerPosts] = useState<SellerThreadPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState(false);
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<SellerProfileData | null>(null);
  const [socialCounts, setSocialCounts] = useState<SocialCounts>({ followers: 0, following: 0, likes: 0 });
  const [productsCount, setProductsCount] = useState<number | null>(null);
  const [profileEditorVisible, setProfileEditorVisible] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [brandNameInput, setBrandNameInput] = useState('');
  const [bioInput, setBioInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestUserRef = useRef<string | null>(null);

  const loadPosts = useCallback(async () => {
    if (!authLoaded || !userId) return;
    const requestUser = userId;
    setPostsError(false);
    try {
      const posts = await getSellerPosts();
      if (requestUserRef.current === requestUser) setSellerPosts(posts);
    } catch {
      // Keep the profile usable when posts are unavailable; the grid offers Retry.
      if (requestUserRef.current === requestUser) setPostsError(true);
    } finally {
      if (requestUserRef.current === requestUser) setPostsLoading(false);
    }
  }, [authLoaded, userId]);

  const loadMyStories = useCallback(async () => {
    if (!authLoaded || !userId) return;
    const requestUser = userId;
    try {
      const rows = await api.social.myStories();
      const now  = Date.now();
      const active = (Array.isArray(rows) ? rows : [])
        .filter((s: any) => s.expiresAt > now)
        .map((s: any) => s.id as string);
      if (requestUserRef.current === requestUser) setMyStoryIds(active);
    } catch { /* stories are optional profile content */ }
  }, [api, authLoaded, userId]);

  const loadProfile = useCallback(async () => {
    if (!authLoaded || !userId) return;
    const requestUser = userId;
    try {
      const data = await api.seller.getProfile();
      if (requestUserRef.current !== requestUser) return;
      setProfile({
        brandName:          data.brandName   ?? null,
        displayName:        data.displayName ?? null,
        bio:                data.bio         ?? null,
        subscriptionStatus: data.subscriptionStatus ?? null,
        subscriptionPlanId: data.subscriptionPlanId ?? null,
        totalLikes:         data.totalLikes ?? 0,
        profileImageUrl:    data.profileImageUrl ?? null,
        verified:           data.verified === true,
        metrics: data.metrics ?? {
          revenueCents: 0,
          visitors: 0,
          orders: 0,
          conversionRate: 0,
        },
      });
      setSocialCounts((current) => ({ ...current, likes: data.totalLikes ?? 0 }));
    } catch { /* nullable profile fields already render safely */ }
  }, [api, authLoaded, userId]);

  const loadSocialCounts = useCallback(async () => {
    if (!authLoaded || !userId) return;
    const requestUser = userId;
    try {
      // True totals from the profile endpoint — the follower/following lists
      // are paged (100 per page), so their lengths undercounted large brands.
      const counts = typeof api.social.profile === 'function'
        ? await api.social.profile(userId).catch(() => null)
        : null;
      if (requestUserRef.current !== requestUser) return;
      if (counts) {
        setSocialCounts((current) => ({
          ...current,
          followers: Number(counts.followersCount ?? 0),
          following: Number(counts.followingCount ?? 0),
        }));
        return;
      }
      const [followersArr, followingArr] = await Promise.all([
        api.social.followers(),
        api.social.following(),
      ]);
      if (requestUserRef.current !== requestUser) return;
      setSocialCounts((current) => ({
        ...current,
        followers: Array.isArray(followersArr) ? followersArr.length : 0,
        following: Array.isArray(followingArr) ? followingArr.length : 0,
      }));
    } catch { /* zero counts remain visible */ }
  }, [api, authLoaded, userId]);

  const loadShopCount = useCallback(async () => {
    if (!authLoaded || !userId) return;
    const requestUser = userId;
    try {
      const data = await api.publicSellers?.get?.(userId);
      if (requestUserRef.current !== requestUser) return;
      setProductsCount(Number(data?.profile?.productsCount ?? 0));
    } catch { /* the pill falls back to "Shop" without a count */ }
  }, [api, authLoaded, userId]);

  const loadPage = useCallback(() => {
    if (!authLoaded || !userId) return;
    void loadPosts();
    void loadMyStories();
    void loadSocialCounts();
    void loadProfile();
    void loadShopCount();
  }, [authLoaded, userId, loadPosts, loadMyStories, loadProfile, loadSocialCounts, loadShopCount]);

  useEffect(() => {
    requestUserRef.current = userId ?? null;
    setSellerPosts([]);
    setMyStoryIds([]);
    setProfile(null);
    setPostsLoading(true);
    setSocialCounts({ followers: 0, following: 0, likes: 0 });
    if (authLoaded && userId) void loadPage();
    if (authLoaded && !userId) setPostsLoading(false);
    // New / edited / deleted posts publish through socialService — refresh.
    const unsub = subscribeSocial(() => { loadPosts(); loadMyStories(); });
    return unsub;
  }, [authLoaded, userId, loadPage, loadPosts, loadMyStories]);

  // Returning from add-product / create-post / edit-profile refreshes counts.
  useFocusEffect(useCallback(() => {
    void loadShopCount();
    void loadSocialCounts();
  }, [loadShopCount, loadSocialCounts]));

  // Following someone from the feed or a list moves "Following" immediately.
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !userId) return;
    if (event.viewerId && event.viewerId !== userId) return;
    if (event.targetId === userId) return;
    setSocialCounts((counts) => ({ ...counts, following: Math.max(0, counts.following + (event.isFollowing ? 1 : -1)) }));
  }), [userId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.resolve(loadPage());
    setRefreshing(false);
  }, [loadPage]);

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function openProfileEditor() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBrandNameInput(profile?.brandName ?? profile?.displayName ?? '');
    setBioInput(profile?.bio ?? '');
    setProfileEditorVisible(true);
  }

  function closeProfileEditor() {
    if (!savingProfile) setProfileEditorVisible(false);
  }

  async function saveProfileDetails() {
    const brandName = brandNameInput.trim();
    const bio = bioInput.trim();
    if (!brandName) {
      Alert.alert('Add a brand name', 'Your Profile needs a brand name before you can save.');
      return;
    }
    if (savingProfile) return;

    setSavingProfile(true);
    try {
      const updated = await api.auth.updateProfile({ brandName, bio });
      setProfile((current) => ({
        brandName: updated.brandName ?? brandName,
        displayName: updated.displayName ?? current?.displayName ?? null,
        bio: updated.bio ?? bio,
        subscriptionStatus: current?.subscriptionStatus ?? null,
        subscriptionPlanId: current?.subscriptionPlanId ?? null,
        totalLikes: current?.totalLikes ?? 0,
        profileImageUrl: current?.profileImageUrl ?? null,
        verified: current?.verified ?? false,
        metrics: current?.metrics ?? {
          revenueCents: 0,
          visitors: 0,
          orders: 0,
          conversionRate: 0,
        },
      }));
      setProfileEditorVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void loadProfile();
    } catch (error) {
      reportNetworkError(error, saveProfileDetails);
      Alert.alert('Could not save changes', 'Check your connection and try again.');
    } finally {
      setSavingProfile(false);
    }
  }

  const brandTitle = profile?.brandName || profile?.displayName || 'My Brand';
  const avatarInitials = brandTitle
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const filteredPosts = sellerPosts.filter(p => {
    if (activeTab === 0) return !p.isDraft && !p.isArchived;
    if (activeTab === 1) return p.isDraft && !p.isArchived;
    if (activeTab === 2) return !p.isDraft && !p.isArchived && !!p.scheduledAt;
    return false;
  });
  const publishedCount = sellerPosts.filter(p => !p.isDraft && !p.isArchived).length;
  const latestVideo = sellerPosts.find(p => !p.isDraft && !p.isArchived && p.contentType === 'video' && p.mediaUris?.[0]);
  const latestPoster = sellerPosts.find(p => !p.isDraft && !p.isArchived && (p.thumbnailUri || (p.contentType !== 'video' && p.mediaUris?.[0])));

  const handleTilePress = useCallback((item: ProfileGridItem) => {
    const post = sellerPosts.find(candidate => candidate.id === item.id);
    if (!post || !userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isLive = !post.isDraft && !(post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now());
    // Published posts play in the feed player; drafts and scheduled posts open the editor.
    if (isLive) {
      router.push(profileVideosHref({ source: 'creator', id: userId, startPostId: post.id, title: brandTitle }) as never);
    } else {
      router.push(('/create-post?editId=' + encodeURIComponent(post.id)) as never);
    }
  }, [brandTitle, router, sellerPosts, userId]);

  const renderTile = useCallback(({ item, index }: { item: ProfileGridItem; index: number }) => (
    <ProfileVideoTile item={item} index={index} width={layout.tileWidth} height={layout.tileHeight} onPress={handleTilePress} />
  ), [handleTilePress, layout.tileHeight, layout.tileWidth]);

  const stats: ProfileStat[] = [
    { key: 'videos', label: 'Videos', value: formatProfileCount(publishedCount) },
    { key: 'following', label: 'Following', value: formatProfileCount(socialCounts.following), onPress: () => nav(connectionsHref('following')) },
    { key: 'followers', label: 'Followers', value: formatProfileCount(socialCounts.followers), onPress: () => nav(connectionsHref('followers')) },
    { key: 'likes', label: 'Likes', value: formatProfileCount(socialCounts.likes) },
  ];

  const planLabel = profile?.subscriptionPlanId
    ? `${profile.subscriptionPlanId.charAt(0).toUpperCase()}${profile.subscriptionPlanId.slice(1)} Plan`
    : profile?.subscriptionStatus === 'active' ? 'Active Plan' : 'Free Plan';
  const hasPaidPlan = !!(profile?.subscriptionPlanId || profile?.subscriptionStatus === 'active');

  const accountSwitcher = (
    <TouchableOpacity
      style={[s.switcher, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push('/account-switcher' as never);
      }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Switch account"
      testID="profile-account-switcher"
    >
      <Text style={[s.brandNameTitle, { color: theme.text }]} numberOfLines={1}>
        {brandTitle}
      </Text>
      <Feather name="chevron-down" size={16} color={theme.text} />
    </TouchableOpacity>
  );

  // Post / Draft / Schedule empty states: one table, each CTA opens the real flow.
  const empty = profileEmptyState((['seller:post', 'seller:draft', 'seller:schedule'] as const)[activeTab] ?? 'seller:post', true);

  return (
    <>
      <ProfileShell
        testID="profile-hero"
        isOwnProfile
        identity={{
          name: brandTitle,
          handle: profile?.brandName && profile?.displayName && profile.brandName !== profile.displayName
            ? `@${profile.displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`
            : null,
          initials: avatarInitials,
          avatarUrl: profile?.profileImageUrl ?? null,
          verified: !!profile?.verified,
          roleLabel: 'Seller',
        }}
        avatar={{
          ring: myStoryIds.length > 0 || !!profile?.verified,
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (myStoryIds.length > 0) {
              router.push({
                pathname: '/buyer-story-viewer' as any,
                params: { storyId: myStoryIds[0], allStoryIds: myStoryIds.join(',') },
              });
            } else {
              router.push('/create-post' as any);
            }
          },
          accessibilityLabel: myStoryIds.length > 0 ? 'View your active story' : 'Create your first story',
        }}
        hero={{
          videoUri: latestVideo?.mediaUris?.[0] ?? null,
          posterUri: latestVideo?.thumbnailUri ?? latestPoster?.thumbnailUri ?? latestPoster?.mediaUris?.[0] ?? null,
        }}
        topLeft={accountSwitcher}
        topRight={(
          <>
            <ProfileGlassButton icon="bell" onPress={() => nav('/notifications-settings')} accessibilityLabel="Notification settings" />
            <ProfileGlassButton
              icon="share-2"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShareSheetVisible(true);
              }}
              accessibilityLabel="Share profile"
              accessibilityHint="Opens a shareable profile card, QR code, and link"
              testID="seller-share-profile-btn"
            />
            <ProfileGlassButton icon="settings" onPress={() => nav('/settings')} accessibilityLabel="Seller settings" />
          </>
        )}
        meta={(
          <ProfileMeta bio={profile?.bio}>
            <ProfileChip label={planLabel} icon={hasPaidPlan ? 'award' : 'layers'} tone={hasPaidPlan ? 'accent' : 'muted'} />
          </ProfileMeta>
        )}
        stats={stats}
        statsLoading={!profile}
        actions={(
          <>
            <View style={s.actionRow}>
              {/* Opens the full seller Edit Profile screen (avatar, name,
                  username, bio, link…). Long-press keeps the quick brand
                  name + bio sheet one gesture away. */}
              <ProfileButton
                label="Edit Profile"
                icon="edit-2"
                variant="primary"
                onPress={() => nav('/edit-profile')}
                onLongPress={openProfileEditor}
                accessibilityLabel="Edit profile"
                accessibilityHint="Opens your full profile editor. Long press to quickly edit brand name and bio."
                testID="profile-edit-details"
              />
              <ProfileButton label="Settings" icon="settings" onPress={() => nav('/settings')} />
            </View>
            <View style={s.actionRow}>
              <ProfileButton label="Go Live" icon="radio" onPress={() => nav('/seller-go-live')} accessibilityLabel="Go Live" />
              <ProfileButton label="Create Post" icon="video" onPress={() => nav('/create-post')} accessibilityLabel="Create Post" />
            </View>
          </>
        )}
        extras={(
          <View style={s.extrasStack}>
            {/* In-flow here: a floating pill above the seller tab bar would sit
                on top of the action rows at 375pt. */}
            {userId ? (
              <ShopPill
                label={productsCount && productsCount > 0 ? `Shop ${productsCount} product${productsCount === 1 ? '' : 's'}` : 'Set up your shop'}
                sublabel={productsCount && productsCount > 0 ? 'Your live listings' : 'Add a product'}
                onPress={() => nav(profileProductsHref({ sellerId: userId, sellerName: brandTitle, isOwner: true }))}
              />
            ) : null}
            <View style={s.quickRow}>
              {QUICK_ACTIONS.map((qa) => (
                <ProfileButton key={qa.label} label={qa.label} icon={qa.icon} onPress={() => nav(qa.route)} accessibilityLabel={qa.label} />
              ))}
            </View>
          </View>
        )}
        tabs={{
          items: CONTENT_TAB_ITEMS,
          active: CONTENT_TABS[activeTab],
          onChange: (key) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab(Math.max(0, CONTENT_TABS.indexOf(key)));
          },
        }}
        data={postsLoading ? [] : filteredPosts.map(gridItemFromThreadPost)}
        renderItem={renderTile}
        keyExtractor={(item) => item.id}
        numColumns={layout.gridColumns}
        listKey={`seller-own-${layout.gridColumns}`}
        ListEmptyComponent={(
          <ProfileGridPlaceholder
            loading={postsLoading}
            error={postsError}
            onRetry={() => { setPostsLoading(true); void loadPosts(); }}
            layout={layout}
            icon={empty.icon as keyof typeof Feather.glyphMap}
            title={empty.title}
            description={empty.message}
            action={empty.cta ? { label: empty.cta.label, onPress: () => nav(empty.cta!.route) } : undefined}
            testID={`seller-own-empty-${CONTENT_TABS[activeTab]?.toLowerCase() ?? 'post'}`}
          />
        )}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        bottomInset={sellerBarInset}
      />

      {/* ── Profile Editor Modal ── */}
      <Modal
        visible={profileEditorVisible}
        transparent
        animationType="fade"
        onRequestClose={closeProfileEditor}
      >
        <KeyboardAvoidingView
          style={s.sheetModal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={s.sheetBackdrop}
            activeOpacity={1}
            onPress={closeProfileEditor}
            accessibilityLabel="Close profile editor"
          />
          <SheetRise style={s.sheet}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>Edit brand</Text>
                <Text style={s.sheetSubtitle}>Keep your Profile details up to date.</Text>
              </View>
              <TouchableOpacity
                style={s.sheetClose}
                onPress={closeProfileEditor}
                disabled={savingProfile}
                accessibilityLabel="Close profile editor"
              >
                <Feather name="x" size={18} color={FG} />
              </TouchableOpacity>
            </View>

            <Text style={s.inputLabel}>Brand name</Text>
            <TextInput
              value={brandNameInput}
              onChangeText={setBrandNameInput}
              style={s.textInput}
              placeholder="Your brand name"
              placeholderTextColor={MUTED}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={80}
              returnKeyType="next"
              editable={!savingProfile}
              testID="profile-edit-brand-name"
            />

            <View style={s.bioLabelRow}>
              <Text style={s.inputLabel}>Bio</Text>
              <Text style={s.characterCount}>{bioInput.length}/280</Text>
            </View>
            <TextInput
              value={bioInput}
              onChangeText={setBioInput}
              style={[s.textInput, s.bioInput]}
              placeholder="Tell people about your brand"
              placeholderTextColor={MUTED}
              multiline
              maxLength={280}
              textAlignVertical="top"
              editable={!savingProfile}
              testID="profile-edit-bio"
            />

            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.cancelButton}
                onPress={closeProfileEditor}
                disabled={savingProfile}
                activeOpacity={0.8}
              >
                <Text style={s.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveButton, { borderColor: theme.accent }, savingProfile && s.saveButtonDisabled]}
                onPress={saveProfileDetails}
                disabled={savingProfile}
                activeOpacity={0.8}
                testID="profile-edit-save"
              >
                <Text style={[s.saveButtonText, { color: theme.accent }]}>{savingProfile ? 'Saving…' : 'Save changes'}</Text>
              </TouchableOpacity>
            </View>
          </SheetRise>
        </KeyboardAvoidingView>
      </Modal>

      <ShareProfileSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
        avatarUrl={profile?.profileImageUrl ?? null}
        sellerExtra={{
          rating: null,
          products: sellerPosts.slice(0, 3).map(p => ({ id: p.id, uri: p.thumbnailUri ?? p.mediaUris?.[0] })),
        }}
      />
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  switcher: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200,
    minHeight: 44, borderRadius: 22, borderWidth: 1, paddingLeft: SP.md, paddingRight: SP.sm,
  },
  brandNameTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, flexShrink: 1 },
  actionRow: { flexDirection: 'row', gap: SP.sm },
  extrasStack: { gap: SP.md },
  quickRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md },

  // Profile editor sheet
  sheetModal:       { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop:    { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.68)' },
  sheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: 26,
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP.lg },
  sheetTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg, marginBottom: 4 },
  sheetSubtitle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  sheetClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center' },
  inputLabel: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: SP.sm },
  bioLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.md },
  characterCount: { color: MUTED, fontFamily: FONT.regular, fontSize: 11, marginBottom: SP.sm },
  textInput: {
    minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE, color: FG, fontFamily: FONT.regular, fontSize: FS.base,
    paddingHorizontal: SP.md, paddingVertical: 12,
  },
  bioInput: { minHeight: 96, maxHeight: 128 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: SP.lg },
  cancelButton: {
    flex: 1, minHeight: 48, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  cancelButtonText: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  saveButton: {
    flex: 1.45, minHeight: 48, borderRadius: RADIUS.md,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { fontFamily: FONT.bold, fontSize: FS.sm },
});

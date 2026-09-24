import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image,
  KeyboardAvoidingView, Modal, Platform, TextInput, Animated, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { reportNetworkError } from '@/lib/networkNotice';
import {
  CARD, BORDER, FG, MUTED,
  FONT, FS, SP, RADIUS, ICON, SURFACE,
} from '@/lib/theme';
import { SheetRise } from '@/components/motion/SheetRise';
import { BrandHero, useBrandHeroScrollY, type BrandHeroStat } from '@/components/profile/BrandHero';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';

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

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const { isLoaded: authLoaded, userId } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [sellerPosts, setSellerPosts] = useState<SellerThreadPost[]>([]);
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<SellerProfileData | null>(null);
  const [socialCounts, setSocialCounts] = useState<SocialCounts>({ followers: 0, following: 0, likes: 0 });
  const [profileEditorVisible, setProfileEditorVisible] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [brandNameInput, setBrandNameInput] = useState('');
  const [bioInput, setBioInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestUserRef = useRef<string | null>(null);
  const scrollY = useBrandHeroScrollY();

  const loadPosts = useCallback(async () => {
    if (!authLoaded || !userId) return;
    const requestUser = userId;
    try {
      const posts = await getSellerPosts();
      if (requestUserRef.current === requestUser) setSellerPosts(posts);
    } catch { /* keep the profile usable when posts are unavailable */ }
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

  const loadPage = useCallback(() => {
    if (!authLoaded || !userId) return;
    void loadPosts();
    void loadMyStories();
    void loadSocialCounts();
    void loadProfile();
  }, [authLoaded, userId, loadPosts, loadMyStories, loadProfile, loadSocialCounts]);

  useEffect(() => {
    requestUserRef.current = userId ?? null;
    setSellerPosts([]);
    setMyStoryIds([]);
    setProfile(null);
    setSocialCounts({ followers: 0, following: 0, likes: 0 });
    if (authLoaded && userId) void loadPage();
    const unsub = subscribeSocial(() => { loadPosts(); loadMyStories(); });
    return unsub;
  }, [authLoaded, userId, loadPage, loadPosts, loadMyStories]);

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

  const avatarInitials = (profile?.brandName || profile?.displayName || 'My Brand')
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

  const heroStats: BrandHeroStat[] = [
    { key: 'following', label: 'Following', value: socialCounts.following > 0 ? socialCounts.following.toLocaleString() : '—' },
    { key: 'followers', label: 'Followers', value: socialCounts.followers > 0 ? socialCounts.followers.toLocaleString() : '—' },
    { key: 'likes', label: 'Likes', value: socialCounts.likes.toLocaleString() },
  ];

  const planLabel = profile?.subscriptionPlanId
    ? `${profile.subscriptionPlanId.charAt(0).toUpperCase()}${profile.subscriptionPlanId.slice(1)} Plan`
    : profile?.subscriptionStatus === 'active' ? 'Active Plan' : 'Free Plan';
  const hasPaidPlan = !!(profile?.subscriptionPlanId || profile?.subscriptionStatus === 'active');

  return (
    <>
    <Animated.ScrollView
      style={[s.root, { backgroundColor: theme.background }]}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.muted} />}
    >
      {/* ── Brand hero — same visual language as seller-profile.tsx, owner action set ── */}
      <BrandHero
        scrollY={scrollY}
        brandName={profile?.brandName || profile?.displayName || 'My Brand'}
        username={
          profile?.brandName && profile?.displayName && profile.brandName !== profile.displayName
            ? profile.displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
            : null
        }
        initials={avatarInitials}
        avatarImageUrl={profile?.profileImageUrl ?? null}
        verified={!!profile?.verified}
        stats={heroStats}
        testID="profile-hero"
        onAvatarPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (myStoryIds.length > 0) {
            router.push({
              pathname: '/buyer-story-viewer' as any,
              params: { storyId: myStoryIds[0], allStoryIds: myStoryIds.join(',') },
            });
          } else {
            router.push('/create-post' as any);
          }
        }}
        avatarAccessibilityLabel={myStoryIds.length > 0 ? 'View your active story' : 'Create your first story'}
        topBarLeft={
          <TouchableOpacity
            style={s.topBarTitle}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/account-switcher' as never);
            }}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Switch account"
            testID="profile-account-switcher"
          >
            <View style={s.accountSwitcherRow}>
              <Text style={[s.brandNameTitle, { color: theme.text }]} numberOfLines={1}>
                {profile?.brandName || profile?.displayName || 'My Brand'}
              </Text>
              <Feather name="chevron-down" size={16} color={theme.text} style={s.chevron} />
            </View>
          </TouchableOpacity>
        }
        topBarRight={
          <View style={s.topBarIcons}>
            <TouchableOpacity style={s.iconBtn} onPress={() => nav('/notifications-settings')} accessibilityRole="button" accessibilityLabel="Notification settings">
              <Feather name="bell" size={ICON.md} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShareSheetVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Share profile"
              accessibilityHint="Opens a shareable profile card, QR code, and link"
              testID="seller-share-profile-btn"
            >
              <Feather name="share-2" size={ICON.md} color={theme.text} />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => nav('/settings')} accessibilityRole="button" accessibilityLabel="Seller settings">
              <Feather name="settings" size={ICON.md} color={theme.text} />
            </TouchableOpacity>
          </View>
        }
        actions={
          <>
            <TouchableOpacity
              style={s.heroActionBtn}
              activeOpacity={0.8}
              onPress={openProfileEditor}
              accessibilityRole="button"
              accessibilityLabel="Edit brand name and bio"
              testID="profile-edit-details"
            >
              <Feather name="edit-2" size={14} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={s.heroActionText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.heroActionBtn} activeOpacity={0.8} onPress={() => nav('/settings')}>
              <Feather name="settings" size={14} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={s.heroActionText}>Settings</Text>
            </TouchableOpacity>
          </>
        }
      >
        {/* Plan pill */}
        <View style={s.planPill}>
          <Text style={[s.planText, { color: hasPaidPlan ? theme.accentLight : theme.muted }]}>{planLabel}</Text>
        </View>

        {/* Bio */}
        {profile?.bio ? (
          <Text style={s.bio} numberOfLines={2}>{profile.bio}</Text>
        ) : null}
      </BrandHero>

      <View style={s.profileCreationRow}>
        <TouchableOpacity
          style={s.profileCreationButton}
          activeOpacity={0.8}
          onPress={() => nav('/seller-go-live')}
          accessibilityRole="button"
          accessibilityLabel="Go Live"
        >
          <Feather name="radio" size={18} color={FG} />
          <Text style={s.profileCreationLabel}>Go Live</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.profileCreationButton}
          activeOpacity={0.8}
          onPress={() => nav('/create-post')}
          accessibilityRole="button"
          accessibilityLabel="Create Post"
        >
          <Feather name="video" size={18} color={FG} />
          <Text style={s.profileCreationLabel}>Create Post</Text>
        </TouchableOpacity>
      </View>

      {/* ── Quick Actions ── */}
      <View style={s.quickRow}>
        {QUICK_ACTIONS.map((qa) => (
          <TouchableOpacity key={qa.label} style={s.quickItem} activeOpacity={0.75} onPress={() => nav(qa.route)} accessibilityRole="button" accessibilityLabel={qa.label}>
            <View style={s.quickIconBox}>
              <Feather name={qa.icon} size={18} color={FG} />
            </View>
            <Text style={s.quickLabel}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Content Tabs (Posts / Drafts / Scheduled — content-state filters) ── */}
      <View style={s.tabsBar}>
        {CONTENT_TABS.map((tab, i) => {
          const active = activeTab === i;
          const icons: (keyof typeof Feather.glyphMap)[] = ['grid', 'file-text', 'clock'];
          return (
            <TouchableOpacity
              key={tab}
              style={[s.tabItem, active && s.tabItemActive]}
              activeOpacity={0.75}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(i); }}
              accessibilityRole="tab"
              accessibilityLabel={`${tab} tab`}
              accessibilityState={{ selected: active }}
              testID={`profile-tab-${tab.toLowerCase()}`}
            >
              <Feather name={icons[i]} size={13} color={active ? FG : MUTED} />
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{tab}</Text>
              {active && <View style={[s.tabUnderline, { backgroundColor: theme.accent }]} />}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.grid}>
        {/* Real seller posts */}
        {filteredPosts.map(post => (
            <TouchableOpacity
              key={post.id}
              style={s.gridTile}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${post.contentType} post, ${post.caption || 'no caption'}, created ${new Date(post.createdAt).toLocaleDateString()}`}
            >
              <View style={s.gridInner}>
                <View style={s.gridTypeIcon}>
                  <Feather name={post.contentType === 'video' ? 'video' : 'image'} size={11} color={MUTED} />
                </View>
                <Text style={s.gridCaption} numberOfLines={3}>{post.caption || '(No caption)'}</Text>
                <View style={s.gridStatRow}>
                  <Feather name="clock" size={10} color={MUTED} />
                  <Text style={s.gridStat}>{new Date(post.createdAt).toLocaleDateString()}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        }

        {/* Empty state */}
        {filteredPosts.length === 0 && (
          <View style={s.emptyState}>
            <Feather name="inbox" size={24} color={MUTED} />
            <Text style={s.emptyText}>
              {activeTab === 0 ? 'No posts yet. Create your first post!' :
               activeTab === 1 ? 'No drafts saved.' :
               'No scheduled posts.'}
            </Text>
          </View>
        )}
      </View>
    </Animated.ScrollView>

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
          products: sellerPosts.slice(0, 3).map(p => ({ id: p.id, uri: p.mediaUris?.[0] })),
        }}
      />
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // Top bar (rendered inside BrandHero's floating top bar slots)
  topBarTitle: { flex: 1 },
  accountSwitcherRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  brandNameTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  chevron: { marginTop: 2 },
  topBarIcons: { flexDirection: 'row', gap: SP.xs },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Hero action row (Edit Profile / Settings)
  heroActionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md,
    paddingHorizontal: SP.md, paddingVertical: 9, minWidth: 88,
  },
  heroActionText: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },

  planPill: {
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: SP.sm,
  },
  planText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  bio: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 19, marginBottom: SP.md },

  // Quick actions
  quickRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: SP.md, paddingVertical: SP.xs,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER,
    marginBottom: SP.lg,
  },
  profileCreationRow: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    marginBottom: SP.md,
  },
  profileCreationButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
  },
  profileCreationLabel: {
    color: FG,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  quickItem: { alignItems: 'center', paddingVertical: SP.md, gap: 6 },
  quickIconBox: {
    width: 44, height: 44, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: { fontSize: 11, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },

  // Content tabs
  tabsBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 1 },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 12, position: 'relative',
  },
  tabItemActive: {},
  tabUnderline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1 },
  tabLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive: { color: FG, fontFamily: FONT.semibold },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridTile: { width: '33.333%', aspectRatio: 0.78, padding: 1 },
  gridInner: { flex: 1, backgroundColor: CARD, padding: SP.sm, justifyContent: 'space-between' },
  gridTypeIcon: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  gridCaption: { fontSize: 11, fontFamily: FONT.semibold, color: FG, lineHeight: 14, marginTop: SP.md },
  gridStatRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridStat: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  emptyState: { width: '100%', alignItems: 'center', padding: SP.lg, gap: SP.sm },
  emptyText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' },

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
  sheetClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center' },
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

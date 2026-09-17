import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image,
  KeyboardAvoidingView, Modal, Platform, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { reportNetworkError } from '@/lib/networkNotice';
import {
  BG, SCREEN_BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON, SURFACE, ACCENT, ACCENT_LIGHT,
} from '@/lib/theme';

// ─── Profile data shape ──────────────────────────────────────────────────────

interface SellerProfileData {
  brandName:          string | null;
  displayName:        string | null;
  bio:                string | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  totalLikes:         number;
  profileImageUrl:    string | null;
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
  const colors = useColors();
  const { theme } = useAppTheme();
  const { isLoaded: authLoaded, userId } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [sellerPosts, setSellerPosts] = useState<SellerThreadPost[]>([]);
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<SellerProfileData | null>(null);
  const [socialCounts, setSocialCounts] = useState<SocialCounts>({ followers: 0, following: 0, likes: 0 });
  const [profileEditorVisible, setProfileEditorVisible] = useState(false);
  const [brandNameInput, setBrandNameInput] = useState('');
  const [bioInput, setBioInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const requestUserRef = useRef<string | null>(null);

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
  return (
    <>
    <ScrollView
      style={[s.root, { backgroundColor: 'transparent' }]}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Top bar: brand name + icons ── */}
      <View style={s.topBar}>
        {/* Brand/account switcher button — navigates to account-switcher screen */}
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
            <Text style={s.brandNameTitle} numberOfLines={1}>
              {profile?.brandName || profile?.displayName || 'My Brand'}
            </Text>
            <Feather name="chevron-down" size={16} color={FG} style={s.chevron} />
          </View>
        </TouchableOpacity>
        <View style={s.topBarIcons}>
          <TouchableOpacity style={s.iconBtn} onPress={() => nav('/notifications-settings')} accessibilityRole="button" accessibilityLabel="Notification settings">
            <Feather name="bell" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => nav('/share-profile')}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
            accessibilityHint="Opens your shareable profile link and QR code"
            testID="seller-share-profile-btn"
          >
            <Feather name="share-2" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => nav('/settings')} accessibilityRole="button" accessibilityLabel="Seller settings">
            <Feather name="settings" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Centered avatar + name + stats ── */}
      <View style={s.profileCenter}>
        {/* Avatar — tapping opens stories if active, otherwise create-post */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
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
          accessibilityRole="button"
          accessibilityLabel={myStoryIds.length > 0 ? 'View your active story' : 'Create your first story'}
          style={s.avatarWrap}
        >
          <View style={[s.avatar, myStoryIds.length > 0 && s.avatarActive]}>
            {profile?.profileImageUrl ? (
              <Image source={{ uri: profile.profileImageUrl }} style={s.avatarImage} accessibilityLabel="Brand avatar" />
            ) : (
              <Text style={s.avatarText}>{avatarInitials}</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Brand name — tapping opens the profile editor */}
        <TouchableOpacity
          onPress={openProfileEditor}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Edit brand name and bio"
          testID="profile-edit-details"
        >
          <View style={s.nameRow}>
            <Text style={s.brandName} numberOfLines={1}>
              {profile?.brandName || profile?.displayName || 'My Brand'}
            </Text>
            <Feather name="check-circle" size={16} color={colors.primary} />
          </View>
        </TouchableOpacity>

        {/* Handle */}
        {profile?.brandName && profile?.displayName && profile.brandName !== profile.displayName && (
          <Text style={s.brandHandle} numberOfLines={1}>
            @{profile.displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}
          </Text>
        )}

        {/* Plan pill */}
        {(profile?.subscriptionPlanId || profile?.subscriptionStatus === 'active') ? (
          <View style={s.planPill}>
            <Text style={[s.planText, { color: theme.accentLight }]}>
              {profile?.subscriptionPlanId
                ? `${profile.subscriptionPlanId.charAt(0).toUpperCase()}${profile.subscriptionPlanId.slice(1)} Plan`
                : 'Active Plan'}
            </Text>
          </View>
        ) : (
          <View style={s.planPill}>
            <Text style={[s.planText, { color: MUTED }]}>Free Plan</Text>
          </View>
        )}

        {/* Bio */}
        {profile?.bio ? (
          <Text style={s.bio} numberOfLines={2}>{profile.bio}</Text>
        ) : null}

        {/* Stats */}
        <View style={s.statsRow}>
          {([
            { label: 'Following', value: socialCounts.following > 0 ? socialCounts.following.toLocaleString() : '—' },
            { label: 'Followers', value: socialCounts.followers > 0 ? socialCounts.followers.toLocaleString() : '—' },
            { label: 'Likes',     value: socialCounts.likes.toLocaleString() },
          ] as { label: string; value: string }[]).map((st, i) => (
            <React.Fragment key={st.label}>
              {i > 0 && <View style={s.statDivider} />}
              <TouchableOpacity style={s.statItem} activeOpacity={0.7}>
                <Text style={s.statValue}>{st.value}</Text>
                <Text style={s.statLabel}>{st.label}</Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      </View>

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

      {/* ── Content Tabs ── */}
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
        {sellerPosts
          .filter(p => {
            if (activeTab === 0) return !p.isDraft && !p.isArchived;
            if (activeTab === 1) return p.isDraft && !p.isArchived;
            if (activeTab === 2) return !p.isDraft && !p.isArchived && !!p.scheduledAt;
            return false;
          })
          .map(post => (
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
        {sellerPosts.filter(p => {
          if (activeTab === 0) return !p.isDraft && !p.isArchived;
          if (activeTab === 1) return p.isDraft && !p.isArchived;
          if (activeTab === 2) return !p.isDraft && !p.isArchived && !!p.scheduledAt;
          return false;
        }).length === 0 && (
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
    </ScrollView>

      {/* ── Profile Editor Modal ── */}
      <Modal
        visible={profileEditorVisible}
        transparent
        animationType="slide"
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
          <View style={s.sheet}>
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  // Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, marginBottom: SP.md,
  },
  topBarTitle: { flex: 1 },
  accountSwitcherRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  brandNameTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  chevron: { marginTop: 2 },
  topBarIcons: { flexDirection: 'row', gap: SP.xs },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Centered profile
  profileCenter: { alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.lg },
  avatarWrap: { marginBottom: SP.sm },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarActive: { borderWidth: 2, borderColor: ACCENT },
  avatarImage: { width: '100%', height: '100%', borderRadius: 48 },
  avatarText: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  brandName: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  brandHandle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.xs },
  planPill: {
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: SP.sm,
  },
  planText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  bio: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 19, marginBottom: SP.md },

  // Stats
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SP.xs },
  statDivider: { width: 1, height: 26, backgroundColor: BORDER, marginHorizontal: SP.md },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  statLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

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
  gridStat: { fontSize: 10, fontFamily: FONT.medium, color: MUTED },
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

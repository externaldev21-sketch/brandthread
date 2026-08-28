import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image,
  KeyboardAvoidingView, Modal, Platform, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';

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

// ─── Design tokens ─────────────────────────────────────────────────────────

const BG     = '#07070F';
const CARD   = '#12121F';
const BORDER = 'rgba(255,255,255,0.07)';
const FG     = '#F4F4FF';
const MUTED  = 'rgba(244,244,255,0.50)';

const QUICK_ACTIONS: { icon: keyof typeof Feather.glyphMap; label: string; route: string }[] = [
  { icon: 'video',      label: 'Create Post',   route: '/create-post' },
  { icon: 'tag',        label: 'Add Product',   route: '/add-product' },
  { icon: 'send',       label: 'New Campaign',  route: '/(tabs)/marketing' },
  { icon: 'user',       label: 'My Profile',    route: '/seller-profile?isOwner=true' },
  { icon: 'message-circle', label: 'Messages',  route: '/seller-inbox' },
];

const CONTENT_TABS = ['Posts', 'Drafts', 'Scheduled', 'Analytics'];

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const api = useApi();
  const colors = useColors();
  const { theme } = useAppTheme();
  const [activeTab, setActiveTab] = useState(0);
  const [sellerPosts, setSellerPosts] = useState<SellerThreadPost[]>([]);
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<SellerProfileData | null>(null);
  const [socialCounts, setSocialCounts] = useState<SocialCounts>({ followers: 0, following: 0, likes: 0 });
  const [profileEditorVisible, setProfileEditorVisible] = useState(false);
  const [brandNameInput, setBrandNameInput] = useState('');
  const [bioInput, setBioInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const loadPosts = useCallback(async () => {
    try {
      const posts = await getSellerPosts();
      setSellerPosts(posts);
    } catch {}
  }, []);

  const loadMyStories = useCallback(async () => {
    try {
      const rows = await api.social.myStories();
      const now  = Date.now();
      const active = (Array.isArray(rows) ? rows : [])
        .filter((s: any) => s.expiresAt > now)
        .map((s: any) => s.id as string);
      setMyStoryIds(active);
    } catch {}
  }, [api]);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api.seller.getProfile();
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
    } catch {}
  }, [api]);

  const loadSocialCounts = useCallback(async () => {
    try {
      const [followersArr, followingArr] = await Promise.all([
        api.social.followers(),
        api.social.following(),
      ]);
      setSocialCounts((current) => ({
        ...current,
        followers: Array.isArray(followersArr) ? followersArr.length : 0,
        following: Array.isArray(followingArr) ? followingArr.length : 0,
      }));
    } catch {}
  }, [api]);

  useEffect(() => {
    loadPosts();
    loadMyStories();
    loadProfile();
    loadSocialCounts();
    const unsub = subscribeSocial(() => { loadPosts(); loadMyStories(); });
    return unsub;
  }, [loadPosts, loadMyStories, loadProfile, loadSocialCounts]);

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function openSettings() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    nav('/settings');
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
    } catch {
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
  const metrics = profile?.metrics ?? null;
  const hasNoActivity = !!metrics && metrics.orders === 0 && metrics.visitors === 0;
  const performanceStats = [
    { label: 'Total Revenue', value: metrics ? `$${(metrics.revenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' },
    { label: 'Visitors', value: metrics ? metrics.visitors.toLocaleString() : '—' },
    { label: 'Orders', value: metrics ? metrics.orders.toLocaleString() : '—' },
    { label: 'Conversion Rate', value: metrics ? `${metrics.conversionRate.toFixed(2)}%` : '—' },
  ];

  return (
    <>
    <ScrollView
      style={[s.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.headerProfileTrigger}
          onPress={openProfileEditor}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Edit brand name and bio"
          accessibilityHint="Opens the quick profile editor"
          testID="profile-edit-header"
        >
          <Text style={s.headerTitle} numberOfLines={1}>
            {profile?.brandName || profile?.displayName || 'My Brand'}
          </Text>
          <Text style={s.headerSub} numberOfLines={2}>
            {profile?.bio || 'Manage your brand, grow your audience, and scale your empire.'}
          </Text>
        </TouchableOpacity>
        <View style={s.headerIcons}>
          <TouchableOpacity style={s.headerIconBtn} onPress={() => nav('/notifications-settings')} activeOpacity={0.75}>
            <Feather name="bell" size={18} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity style={s.headerIconBtn} onPress={() => nav('/seller-settings')} activeOpacity={0.75}>
            <Feather name="settings" size={18} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Profile card */}
      <View style={s.profileCard}>
        {/* Avatar — story ring when active stories exist */}
        <View style={s.avatarSection}>
          {/* Tapping avatar views own stories (if any) or opens story creator */}
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
          >
            {/* Gradient ring when active story */}
            {myStoryIds.length > 0 ? (
              <LinearGradient
                colors={[theme.accentLight, theme.accent, theme.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.avatarGlow, { shadowColor: theme.accent }]}
              >
                <View style={s.avatarRing}>
                  <View style={s.avatar}>
                    {profile?.profileImageUrl ? (
                      <Image source={{ uri: profile.profileImageUrl }} style={s.avatarImage} accessibilityLabel="Brand avatar" />
                    ) : (
                      <Text style={[s.avatarText, { color: theme.accentLight }]}>{avatarInitials}</Text>
                    )}
                  </View>
                </View>
              </LinearGradient>
            ) : (
              <View style={[s.avatarGlow, { backgroundColor: theme.accentDim, shadowColor: theme.accent }]}>
                <View style={s.avatarRing}>
                  <View style={s.avatar}>
                    {profile?.profileImageUrl ? (
                      <Image source={{ uri: profile.profileImageUrl }} style={s.avatarImage} accessibilityLabel="Brand avatar" />
                    ) : (
                      <Text style={[s.avatarText, { color: theme.accentLight }]}>{avatarInitials}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}
          </TouchableOpacity>

          {/* Camera button — change avatar photo */}
          <TouchableOpacity
            style={s.cameraBtn}
            activeOpacity={0.8}
            disabled={uploadingAvatar}
            onPress={async () => {
              const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to update your brand avatar.'); return; }
              const result = await ImagePicker.launchImageLibraryAsync({
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.85,
                mediaTypes: ['images'],
              });
              if (result.canceled || !result.assets[0]) return;
              setUploadingAvatar(true);
              try {
                const updated = await api.seller.uploadAvatar(result.assets[0]);
                setProfile((current) => current ? { ...current, profileImageUrl: updated.profileImageUrl } : current);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                Alert.alert('Could not update photo', 'Check your connection and try again.');
              } finally {
                setUploadingAvatar(false);
              }
            }}
          >
            <Feather name={uploadingAvatar ? "loader" : "camera"} size={12} color={FG} />
          </TouchableOpacity>

          {/* Add Story "+" badge */}
          <TouchableOpacity
            style={[s.addStoryBtn, { backgroundColor: theme.accent }]}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push('/create-post' as any);
            }}
          >
            <Feather name="plus" size={12} color={theme.onAccent} />
          </TouchableOpacity>
        </View>

        {/* Name + verified + plan */}
        <View style={s.nameBlock}>
          <TouchableOpacity
            style={s.nameRow}
            onPress={openProfileEditor}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Edit brand name and bio"
            accessibilityHint="Opens the quick profile editor"
            testID="profile-edit-details"
          >
            <Text style={s.brandName} numberOfLines={1}>
              {profile?.brandName || profile?.displayName || 'My Brand'}
            </Text>
            <Feather name="check-circle" size={17} color={colors.primary} />
            <View style={[s.editProfileIcon, { backgroundColor: theme.accentDim }]}>
              <Feather name="edit-3" size={13} color={colors.primary} />
            </View>
          </TouchableOpacity>
          {profile?.brandName && profile?.displayName && profile.brandName !== profile.displayName && (
            <Text style={s.brandHandle} numberOfLines={1}>
              @{profile.displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}
            </Text>
          )}
          {profile?.subscriptionPlanId || profile?.subscriptionStatus === 'active' ? (
            <View style={[s.planPill, { backgroundColor: theme.accentDim }]}>
              <Text style={[s.planText, { color: theme.accentLight }]}>
                {profile?.subscriptionPlanId
                  ? `${profile.subscriptionPlanId.charAt(0).toUpperCase()}${profile.subscriptionPlanId.slice(1)} Plan`
                  : 'Active Plan'}
              </Text>
            </View>
          ) : (
            <View style={[s.planPill, { backgroundColor: theme.accentDim }]}>
              <Text style={[s.planText, { color: theme.accentLight }]}>Free Plan</Text>
            </View>
          )}

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
      </View>

      {/* Quick Actions */}
      <View style={s.quickRow}>
        {QUICK_ACTIONS.map((qa) => (
          <TouchableOpacity key={qa.label} style={s.quickItem} activeOpacity={0.75} onPress={() => nav(qa.route)}>
            <View style={[s.quickIconBox, { backgroundColor: theme.accentDim }]}>
              <Feather name={qa.icon} size={18} color={colors.primary} />
            </View>
            <Text style={s.quickLabel}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content Tabs */}
      <View style={s.tabsBar}>
        {CONTENT_TABS.map((tab, i) => {
          const active = activeTab === i;
          const icons: (keyof typeof Feather.glyphMap)[] = ['grid', 'file-text', 'clock', 'bar-chart-2'];
          return (
            <TouchableOpacity
              key={tab}
              style={[s.tabItem, active && [s.tabItemActive, { borderBottomColor: theme.accent }]]}
              activeOpacity={0.75}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab(i); }}
            >
              <Feather name={icons[i]} size={13} color={active ? colors.primary : MUTED} />
              <Text style={[s.tabLabel, active && [s.tabLabelActive, { color: theme.accentLight }]]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 3 ? (
        <View style={s.analyticsSection}>
          <Text style={s.analyticsTitle}>Store performance</Text>
          <Text style={s.analyticsSubtitle}>Paid orders and storefront visits, all time.</Text>
          <View style={s.perfGrid}>
            {performanceStats.map((stat) => (
              <View key={stat.label} style={s.perfCard}>
                <Text style={s.perfLabel}>{stat.label}</Text>
                <Text style={s.perfValue}>{stat.value}</Text>
              </View>
            ))}
          </View>
          {hasNoActivity && (
            <View style={s.neutralAnalyticsState}>
              <Feather name="bar-chart-2" size={22} color={MUTED} />
              <Text style={s.neutralAnalyticsTitle}>No storefront activity yet</Text>
              <Text style={s.neutralAnalyticsText}>Your real revenue, orders, and conversion rate will appear here as shoppers visit and place paid orders.</Text>
            </View>
          )}
        </View>
      ) : (
      <View style={s.grid}>
        {/* Create Post tile — always first */}
        <TouchableOpacity
          style={s.gridTile}
          activeOpacity={0.85}
          onPress={() => nav('/create-post')}
        >
          <View style={s.createTile}>
            <View style={s.createPlus}>
              <Feather name="plus" size={20} color={MUTED} />
            </View>
            <Text style={s.createTitle}>Create Post</Text>
            <Text style={s.createSub}>Share something with{'\n'}your audience</Text>
          </View>
        </TouchableOpacity>

        {/* Real seller posts — filtered by tab */}
        {sellerPosts
          .filter(p => {
            if (activeTab === 0) return !p.isDraft && !p.isArchived;
            if (activeTab === 1) return p.isDraft && !p.isArchived;
            if (activeTab === 2) return !p.isDraft && !p.isArchived && !!p.scheduledAt;
            return false; // Analytics tab has no grid items
          })
          .map(post => (
            <TouchableOpacity
              key={post.id}
              style={s.gridTile}
              activeOpacity={0.85}
            >
              <LinearGradient colors={['#4A3B7A', '#1E1540']} style={s.gridInner}>
                <View style={[s.gridMenuBtn, { opacity: 0.7 }]}>
                  <Feather name={post.contentType === 'video' ? 'video' : 'image'} size={11} color="#FFF" />
                </View>
                <Text style={s.gridCaption} numberOfLines={3}>{post.caption || '(No caption)'}</Text>
                <View style={s.gridStatRow}>
                  <Feather name="clock" size={10} color="#FFFFFF99" />
                  <Text style={s.gridStat}>{new Date(post.createdAt).toLocaleDateString()}</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))
        }

        {/* Empty state for tabs when no posts */}
        {activeTab !== 3 && sellerPosts.filter(p => {
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
      )}
    </ScrollView>

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
                style={[s.saveButton, { backgroundColor: theme.accent }, savingProfile && s.saveButtonDisabled]}
                onPress={saveProfileDetails}
                disabled={savingProfile}
                activeOpacity={0.8}
                testID="profile-edit-save"
              >
                <Text style={[s.saveButtonText, { color: theme.onAccent }]}>{savingProfile ? 'Saving…' : 'Save changes'}</Text>
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

  // Header
  header:         { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20, gap: 12 },
  headerProfileTrigger: { flex: 1 },
  headerTitle:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 4 },
  headerSub:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 17, maxWidth: 220 },
  headerIcons:    { flexDirection: 'row', gap: 8, marginTop: 2 },
  headerIconBtn:  { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },

  // Profile card
  profileCard:    { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 20, gap: 16 },

  // Avatar
  avatarSection:  { position: 'relative' },
  avatarGlow:     { width: 88, height: 88, borderRadius: 44, padding: 3, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 14, elevation: 12 },
  avatarRing:     { flex: 1, borderRadius: 42, overflow: 'hidden', backgroundColor: BG, padding: 3 },
  avatar:         { flex: 1, borderRadius: 39, backgroundColor: '#18182E', alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontSize: 30, fontFamily: 'Inter_700Bold' },
   avatarImage:    { width: '100%', height: '100%', borderRadius: 39 },
  cameraBtn:      { position: 'absolute', bottom: 0, right: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: '#333', borderWidth: 2, borderColor: BG, alignItems: 'center', justifyContent: 'center' },
  addStoryBtn:    { position: 'absolute', bottom: 0, left: -2, width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: BG, alignItems: 'center', justifyContent: 'center' },

  // Name
  nameBlock:      { flex: 1, paddingTop: 4 },
  nameRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  brandName:      { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  editProfileIcon:{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  brandHandle:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 8 },
  planPill:       { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 14 },
  planText:       { fontSize: 11, fontFamily: 'Inter_700Bold' },

  // Stats
  statsRow:       { flexDirection: 'row', alignItems: 'center', gap: 0 },
  statDivider:    { width: 1, height: 28, backgroundColor: BORDER, marginHorizontal: 14 },
  statItem:       { alignItems: 'flex-start' },
  statValue:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  statLabel:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  // Quick actions
  quickRow:       { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16, paddingVertical: 4, backgroundColor: CARD, borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, marginBottom: 24 },
  quickItem:      { alignItems: 'center', paddingVertical: 14, gap: 6 },
  quickIconBox:   { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickLabel:     { fontSize: 11, fontFamily: 'Inter_500Medium', color: FG, textAlign: 'center' },

  // Performance grid
  analyticsSection: { padding: 20, gap: 8 },
  analyticsTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  analyticsSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 8 },
  perfGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  perfCard:       { width: '48.5%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14 },
  perfLabel:      { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED, marginBottom: 6 },
  perfValue:      { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.3 },
  neutralAnalyticsState: { alignItems: 'center', borderWidth: 1, borderColor: BORDER, borderRadius: 14, backgroundColor: CARD, padding: 20, marginTop: 8, gap: 7 },
  neutralAnalyticsTitle: { color: FG, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  neutralAnalyticsText: { color: MUTED, fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 17 },

  // Content tabs
  tabsBar:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 1 },
  tabItem:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive:  {},
  tabLabel:       { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  tabLabelActive: { color: FG, fontFamily: 'Inter_600SemiBold' },

  // Grid
  grid:           { flexDirection: 'row', flexWrap: 'wrap' },
  gridTile:       { width: '33.333%', aspectRatio: 0.78, padding: 1 },
  createTile:     { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 },
  createPlus:     { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  createTitle:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: FG, textAlign: 'center' },
  createSub:      { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 14 },
  gridInner:      { flex: 1, padding: 8, justifyContent: 'space-between' },
  gridMenuBtn:    { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  gridCaption:    { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFF', lineHeight: 14, marginTop: 4 },
  gridStatRow:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridStat:       { fontSize: 10, fontFamily: 'Inter_500Medium', color: '#FFFFFF99' },
  emptyState:     { width: '100%', alignItems: 'center', padding: 24, gap: 8 },
  emptyText:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },

  // Quick profile editor
  sheetModal:       { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.68)' },
  sheet:            { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: BORDER, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 26 },
  sheetHandle:      { width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(244,244,255,0.25)', alignSelf: 'center', marginBottom: 18 },
  sheetHeader:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 },
  sheetTitle:       { color: FG, fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 4 },
  sheetSubtitle:    { color: MUTED, fontFamily: 'Inter_400Regular', fontSize: 13 },
  sheetClose:       { width: 34, height: 34, borderRadius: 17, backgroundColor: '#18182E', alignItems: 'center', justifyContent: 'center' },
  inputLabel:       { color: FG, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 8 },
  bioLabelRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  characterCount:   { color: MUTED, fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 8 },
  textInput:        { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: BG, color: FG, fontFamily: 'Inter_400Regular', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  bioInput:         { minHeight: 96, maxHeight: 128 },
  sheetActions:     { flexDirection: 'row', gap: 10, marginTop: 24 },
  cancelButton:     { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: FG, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  saveButton:       { flex: 1.45, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText:   { fontFamily: 'Inter_700Bold', fontSize: 14 },
});

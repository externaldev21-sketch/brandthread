import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard } from '@/components/BrandthreadUI';
import { getStorefront, saveDraft, generateAISuggestions } from '@/services/storeService';
import { Storefront, StorePublishStatus } from '@/services/storeTypes';

function getStatusVariant(status: StorePublishStatus): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'published': return 'success';
    case 'draft': return 'info';
    case 'ready': return 'purple';
    case 'password_protected': return 'warning';
    case 'maintenance': return 'warning';
    case 'unpublished': return 'error';
    default: return 'neutral';
  }
}

function getStatusLabel(status: StorePublishStatus): string {
  switch (status) {
    case 'published': return 'Published';
    case 'draft': return 'Draft';
    case 'ready': return 'Ready';
    case 'password_protected': return 'Password Protected';
    case 'maintenance': return 'Maintenance';
    case 'unpublished': return 'Unpublished';
    case 'not_started': return 'Not Started';
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function StoreBuilderScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [store, setStore] = useState<Storefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const s = await getStorefront();
      const updated = await generateAISuggestions();
      setStore(updated);
    } catch {
      setStore(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadData();
  }, [loadData]));

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const hasStore = store !== null && store.publishStatus !== 'not_started';
  const suggestionCount = store
    ? store.aiSuggestions.filter(s => !s.dismissed && !s.applied).length
    : 0;

  // ── Store management sections ─────────────────────────────────────────────
  const contentItems = [
    { label: 'Sections',    icon: 'layout'    as const, route: '/store-sections' },
    { label: 'Pages',       icon: 'file-text' as const, route: '/store-pages' },
    { label: 'Navigation',  icon: 'menu'      as const, route: '/store-nav' },
    { label: 'Collections', icon: 'grid'      as const, route: '/store-collections' },
  ];
  const discoveryItems = [
    { label: 'SEO',     icon: 'search' as const, route: '/store-seo' },
    { label: 'Domains', icon: 'globe'  as const, route: '/store-domain' },
  ];
  const managementItems = [
    { label: 'Policies', icon: 'shield'    as const, route: '/store-policies' },
    { label: 'Versions', icon: 'clock'     as const, route: '/store-versions' },
    { label: 'Settings', icon: 'settings'  as const, route: '/store-settings' },
  ];

  if (loading) {
    return (
      <View style={[s.loadingContainer, { paddingTop: insets.top }]}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: BG }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
      >
        {/* HEADER */}
        <LinearGradient
          colors={[...GRAD_PRIMARY]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.header, { paddingTop: insets.top + SP.md }]}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.75}
            style={{ width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: SP.sm }}
          >
            <Feather name="arrow-left" size={ICON.sm} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerSubtitle}>Store Builder</Text>
          <Text style={s.headerHeading}>Build your brand's home.</Text>
          <Text style={s.headerDesc}>
            Create a complete storefront with Brandthread AI or start with a professionally designed theme.
          </Text>
        </LinearGradient>

        <View style={s.content}>
          {/* CURRENT STORE STATUS CARD */}
          {hasStore && store && (
            <GradientCard colors={GRAD_CARD_GLOW} glow style={s.storeStatusCard}>
              <View style={s.storeStatusTop}>
                <View style={s.storeStatusLeft}>
                  <Text style={s.storeName} numberOfLines={1}>
                    {store.settings.storeName || 'My Store'}
                  </Text>
                  <View style={s.storeStatusRow}>
                    <StatusBadge
                      label={getStatusLabel(store.publishStatus)}
                      variant={getStatusVariant(store.publishStatus)}
                      small
                    />
                    <Text style={s.lastEdited}>
                      Last edited: {timeAgo(store.lastEditedAt)}
                    </Text>
                  </View>
                </View>
                <Feather
                  name={store.publishStatus === 'published' ? 'check-circle' : 'edit-2'}
                  size={ICON.lg}
                  color={store.publishStatus === 'published' ? SUCCESS : MUTED}
                />
              </View>
              <View style={s.quickActions}>
                {[
                  { label: 'Preview',    route: '/store-preview' },
                  { label: 'Edit Store', route: '/store-editor' },
                  { label: 'Publish',    route: '/store-publish' },
                  { label: 'Analytics',  route: '/(tabs)/analytics' },
                ].map(({ label, route }) => (
                  <TouchableOpacity
                    key={label}
                    style={s.quickActionBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push(route as never);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.quickActionText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </GradientCard>
          )}

          {/* PRIMARY OPTIONS */}
          <View style={s.section}>
            {/* Option 1: Build with AI — full width hero */}
            <GradientCard
              colors={[...GRAD_PRIMARY]}
              glow
              style={s.heroCard}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push('/store-generate' as never);
              }}
            >
              <View style={s.heroCardBadgeRow}>
                <View style={s.popularBadge}>
                  <Text style={s.popularBadgeText}>Most popular</Text>
                </View>
              </View>
              <View style={s.heroCardRow}>
                <Feather name="zap" size={ICON.xl} color={GOLD} />
                <View style={s.heroCardText}>
                  <Text style={s.heroCardTitle}>Build with AI</Text>
                  <Text style={s.heroCardDesc}>
                    Describe your brand and we'll generate a complete storefront.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={s.heroCardButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push('/store-generate' as never);
                }}
                activeOpacity={0.8}
              >
                <Text style={s.heroCardButtonText}>Start AI Build →</Text>
              </TouchableOpacity>
            </GradientCard>

            {/* 2-column grid options */}
            <View style={s.optionsGrid}>
              {/* Option 2: Choose a Theme */}
              <BrandthreadCard
                style={s.halfCard}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/store-theme-picker' as never);
                }}
              >
                <Feather name="layout" size={ICON.md} color={PURPLE} />
                <Text style={s.halfCardTitle}>Choose a Theme</Text>
                <Text style={s.halfCardDesc}>Browse professionally designed themes.</Text>
              </BrandthreadCard>

              {/* Option 3: From Logo */}
              <BrandthreadCard
                style={s.halfCard}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/store-from-logo' as never);
                }}
              >
                <Feather name="image" size={ICON.md} color={CYAN} />
                <Text style={s.halfCardTitle}>From Logo</Text>
                <Text style={s.halfCardDesc}>Upload your logo to generate a storefront.</Text>
              </BrandthreadCard>

              {/* Option 4: From Mood Board */}
              <BrandthreadCard
                style={s.halfCard}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/store-from-moodboard' as never);
                }}
              >
                <Feather name="grid" size={ICON.md} color={BLUE} />
                <Text style={s.halfCardTitle}>From Mood Board</Text>
                <Text style={s.halfCardDesc}>Upload images that inspire your brand.</Text>
              </BrandthreadCard>

              {/* Option 5: From Social */}
              <BrandthreadCard
                style={s.halfCard}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/store-from-social' as never);
                }}
              >
                <Feather name="share-2" size={ICON.md} color={ORANGE} />
                <Text style={s.halfCardTitle}>From Social</Text>
                <Text style={s.halfCardDesc}>Use your existing social content.</Text>
                <View style={s.demoBadge}>
                  <Text style={s.demoBadgeText}>Upload only — no scraping</Text>
                </View>
              </BrandthreadCard>

              {/* Option 6: Continue Editing / Start fresh */}
              <BrandthreadCard
                style={s.halfCard}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/store-editor' as never);
                }}
              >
                <Feather name="edit-2" size={ICON.md} color={SUCCESS} />
                <Text style={s.halfCardTitle}>
                  {store && store.publishStatus !== 'not_started' ? 'Continue Editing' : 'Start Fresh'}
                </Text>
                <Text style={s.halfCardDesc}>
                  {store && store.publishStatus !== 'not_started'
                    ? 'Pick up where you left off.'
                    : 'Build from a blank canvas.'}
                </Text>
              </BrandthreadCard>
            </View>
          </View>

          {/* STORE MANAGEMENT */}
          <View style={s.section}>
            <SectionHeader title="Manage Your Store" />

            {/* Content — Sections, Pages, Navigation, Collections */}
            <Text style={s.mgmtSubLabel}>Content</Text>
            <View style={s.mgmtRow}>
              {contentItems.map(({ label, icon, route }) => (
                <TouchableOpacity
                  key={label}
                  style={s.mgmtCard}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as never); }}
                  activeOpacity={0.75}
                >
                  <View style={s.mgmtIconWrap}>
                    <Feather name={icon} size={ICON.md} color={PURPLE_LIGHT} />
                  </View>
                  <Text style={s.mgmtLabel}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Discovery — SEO, Domains */}
            <Text style={s.mgmtSubLabel}>Discovery</Text>
            <View style={s.mgmtRow}>
              {discoveryItems.map(({ label, icon, route }) => (
                <TouchableOpacity
                  key={label}
                  style={s.mgmtCard}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as never); }}
                  activeOpacity={0.75}
                >
                  <View style={s.mgmtIconWrap}>
                    <Feather name={icon} size={ICON.md} color={PURPLE_LIGHT} />
                  </View>
                  <Text style={s.mgmtLabel}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Management — Policies, Versions, Settings */}
            <Text style={s.mgmtSubLabel}>Management</Text>
            <View style={s.mgmtRow}>
              {managementItems.map(({ label, icon, route }) => (
                <TouchableOpacity
                  key={label}
                  style={s.mgmtCard}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as never); }}
                  activeOpacity={0.75}
                >
                  <View style={s.mgmtIconWrap}>
                    <Feather name={icon} size={ICON.md} color={PURPLE_LIGHT} />
                  </View>
                  <Text style={s.mgmtLabel}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* AI IMPROVE STORE */}
          <View style={[s.section, s.lastSection]}>
            <GradientCard colors={GRAD_CARD_GLOW} glow>
              <View style={s.aiImproveRow}>
                <View style={s.aiImproveIconWrap}>
                  <Feather name="zap" size={ICON.lg} color={GOLD} />
                  {suggestionCount > 0 && (
                    <View style={s.suggestionBadge}>
                      <Text style={s.suggestionBadgeText}>{suggestionCount}</Text>
                    </View>
                  )}
                </View>
                <View style={s.aiImproveText}>
                  <Text style={s.aiImproveTitle}>Improve Store with AI</Text>
                  <Text style={s.aiImproveDesc}>
                    Get personalized recommendations for your storefront.
                  </Text>
                </View>
              </View>
              <PrimaryButton
                label="Open Suggestions →"
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push('/store-ai-improve' as never);
                }}
                style={s.aiImproveBtn}
              />
            </GradientCard>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  header: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.xl,
  },
  headerSubtitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.5,
    marginBottom: SP.xs,
  },
  headerHeading: {
    fontSize: FS.h2,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: SP.sm,
  },
  headerDesc: {
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 22,
  },
  content: {
    paddingHorizontal: SP.md,
    paddingTop: SP.lg,
    gap: SP.lg,
  },
  section: { gap: SP.md },
  lastSection: { marginBottom: SP.lg },
  // Store status card
  storeStatusCard: { marginBottom: SP.xs },
  storeStatusTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: SP.md,
  },
  storeStatusLeft: { flex: 1, gap: SP.xs },
  storeName: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
  },
  storeStatusRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  lastEdited: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  quickActions: { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  quickActionBtn: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  quickActionText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  // Hero card
  heroCard: { marginBottom: SP.sm },
  heroCardBadgeRow: { flexDirection: 'row', marginBottom: SP.sm },
  popularBadge: {
    backgroundColor: GOLD + '30',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: GOLD + '60',
  },
  popularBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: GOLD },
  heroCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, marginBottom: SP.md },
  heroCardText: { flex: 1, gap: SP.xs },
  heroCardTitle: { fontSize: 18, fontFamily: FONT.bold, color: '#FFFFFF' },
  heroCardDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: 'rgba(255,255,255,0.8)' },
  heroCardButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: RADIUS.md,
    paddingVertical: SP.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroCardButtonText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  // Options grid
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  halfCard: {
    width: '48%',
    gap: SP.xs,
  },
  halfCardTitle: { fontSize: 14, fontFamily: FONT.bold, color: FG, marginTop: SP.xs },
  halfCardDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 16 },
  demoBadge: {
    marginTop: SP.xs,
    backgroundColor: CYAN_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  demoBadgeText: { fontSize: 9, fontFamily: FONT.semibold, color: CYAN },
  // Management grid
  mgmtRow: { flexDirection: 'row', gap: SP.sm },
  mgmtCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    alignItems: 'center',
    gap: SP.xs,
  },
  mgmtIconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mgmtLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
  mgmtSubLabel: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: SUBTLE,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: SP.sm,
    marginBottom: SP.xs,
  },
  // AI improve
  aiImproveRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.md },
  aiImproveIconWrap: { position: 'relative' },
  suggestionBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBadgeText: { fontSize: 9, fontFamily: FONT.bold, color: '#FFFFFF' },
  aiImproveText: { flex: 1, gap: SP.xs },
  aiImproveTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  aiImproveDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  aiImproveBtn: {},
});

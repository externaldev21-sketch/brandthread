/**
 * Manufacturer Hub — 6-tab main screen
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, Switch, RefreshControl, ActionSheetIOS, Platform, ActivityIndicator, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';
import { LinearGradient } from 'expo-linear-gradient';
import { formatCents } from '@/lib/money';
import { getEntitlementRejection } from '@/lib/entitlementError';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter, completeSetupTaskWhen } from '@/lib/setupCompletion';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, CARD_GLASS, CARD_ELEVATED_GLASS, SURFACE_GLASS, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, BLUE, ORANGE, RED, GOLD, ON_DARK,
  GRAD_PRIMARY, FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader, EmptyState,
  StatCard,
} from '@/components/BrandthreadUI';
import {
  searchManufacturers, getRelationships, getRelationship,
  saveManufacturer, getManufacturer,
  getFavoriteManufacturerIds, unfavoriteManufacturer,
  getQuoteRequests, getQuotes, acceptQuote, declineQuote, withdrawQuoteRequest,
  getSamples, getProductionOrders,
  getConversations, getOrCreateConversation,
} from '@/services/manufacturerService';
import {
  Manufacturer, ManufacturerRelationship, QuoteRequest, Quote, Sample,
  ProductionOrder, ManufacturerConversation, PRODUCTION_STAGES,
} from '@/services/manufacturerTypes';

// ─── Tab config ───────────────────────────────────────────────────────────────

type Tab = 'discover' | 'my_manufacturers' | 'quotes' | 'samples' | 'production' | 'messages';

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'discover',         label: 'Discover',     icon: 'search' },
  { key: 'my_manufacturers', label: 'My Mfgs',      icon: 'users' },
  { key: 'quotes',           label: 'Quotes',        icon: 'file-text' },
  { key: 'samples',          label: 'Samples',       icon: 'package' },
  { key: 'production',       label: 'Production',    icon: 'layers' },
  { key: 'messages',         label: 'Messages',      icon: 'message-circle' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function relStatusVariant(status: ManufacturerRelationship['status']): 'success' | 'info' | 'warning' | 'neutral' | 'purple' | 'error' {
  switch (status) {
    case 'active':    return 'success';
    case 'connected': return 'info';
    case 'saved':     return 'purple';
    case 'invited':   return 'warning';
    case 'paused':    return 'neutral';
    case 'archived':  return 'neutral';
    default:          return 'neutral';
  }
}

function quoteRequestStatusVariant(status: QuoteRequest['status']): 'success' | 'info' | 'warning' | 'neutral' | 'error' | 'purple' {
  switch (status) {
    case 'draft':           return 'neutral';
    case 'sent':            return 'info';
    case 'viewed':          return 'info';
    case 'questions_asked': return 'warning';
    case 'quote_received':  return 'success';
    case 'counteroffer_sent': return 'purple';
    case 'accepted':        return 'success';
    case 'expired':         return 'warning';
    case 'declined':
    case 'cancelled':       return 'error';
    default:                return 'neutral';
  }
}

function sampleStatusVariant(status: Sample['status']): 'success' | 'info' | 'warning' | 'neutral' | 'error' | 'purple' {
  switch (status) {
    case 'requested':        return 'neutral';
    case 'awaiting_payment': return 'warning';
    case 'paid':             return 'info';
    case 'in_development':   return 'info';
    case 'revision_requested': return 'warning';
    case 'shipped':          return 'purple';
    case 'delivered':        return 'success';
    case 'review_needed':    return 'warning';
    case 'approved':         return 'success';
    case 'rejected':         return 'error';
    case 'cancelled':        return 'neutral';
    default:                 return 'neutral';
  }
}

function productionStatusVariant(status: ProductionOrder['status']): 'success' | 'info' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'active':    return 'success';
    case 'pending':   return 'warning';
    case 'on_hold':   return 'warning';
    case 'completed': return 'success';
    case 'cancelled': return 'error';
    default:          return 'neutral';
  }
}

function showManufacturerUpgrade(error: unknown, router: ReturnType<typeof useRouter>): boolean {
  const rejection = getEntitlementRejection(error);
  if (!rejection) return false;
  Alert.alert(
    `Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Pro'}`,
    rejection.message,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'View plans', onPress: () => router.push('/subscription' as never) },
    ],
  );
  return true;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManufacturerHub() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tab, from } = useLocalSearchParams<{ tab?: string; from?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(tab === 'messages' ? 'messages' : 'discover');
  const isSellerSetup = isSellerSetupOrigin(from);

  function leaveSetupDestination() {
    if (isSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();
  const [upsellVisible, setUpsellVisible] = useState(false);
  const hasGrowthAccess = !GROWTH_PLAN_ENFORCEMENT_ENABLED || hasPlan('growth');

  useEffect(() => {
    if (tab === 'messages') setActiveTab('messages');
  }, [tab]);

  // Native modals use a global portal, so the gate must follow route focus.
  useFocusEffect(
    useCallback(() => {
      if (!planLoading && !planError && !hasGrowthAccess) {
        setUpsellVisible(true);
      }
      return () => setUpsellVisible(false);
    }, [hasGrowthAccess, planError, planLoading]),
  );

  const handleTabPress = (tab: Tab) => {
    Haptics.selectionAsync();
    setActiveTab(tab);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <HubHeader activeTab={activeTab} router={router} onLeave={leaveSetupDestination} />

      {/* Tab bar */}
      <View style={s.tabBarWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabBarContent}
        >
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={s.tabItem}
              onPress={() => handleTabPress(tab.key)}
              activeOpacity={0.7}
            >
              <View style={s.tabInner}>
                <Feather
                  name={tab.icon}
                  size={ICON.sm}
                  color={activeTab === tab.key ? PURPLE_LIGHT : MUTED}
                />
                <Text style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
                  {tab.label}
                </Text>
              </View>
              {activeTab === tab.key && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {planError && (
        <TouchableOpacity
          style={s.planErrorBanner}
          onPress={retryPlan}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Could not load plan. Tap to retry."
        >
          <Feather name="alert-circle" size={ICON.sm} color={ORANGE} />
          <Text style={s.planErrorText}>Could not load plan — tap to retry</Text>
          <Feather name="refresh-cw" size={ICON.sm} color={ORANGE} />
        </TouchableOpacity>
      )}

      {/* Tab content */}
      <View style={s.content}>
        {activeTab === 'discover'         && <DiscoverTab router={router} />}
        {activeTab === 'my_manufacturers' && <MyManufacturersTab router={router} />}
        {activeTab === 'quotes'           && <QuotesTab router={router} />}
        {activeTab === 'samples'          && <SamplesTab router={router} />}
        {activeTab === 'production'       && <ProductionTab router={router} />}
        {activeTab === 'messages'         && <MessagesTab router={router} />}
      </View>

      {/* Plan upsell — shown immediately for Starter sellers */}
      <PlanUpsellModal
        visible={upsellVisible}
        featureName="Manufacturer Hub"
        requiredPlan="growth"
        onClose={() => {
          setUpsellVisible(false);
          leaveSetupDestination();
        }}
        onUpgrade={() => {
          setUpsellVisible(false);
          router.push('/subscription' as never);
        }}
      />
    </View>
  );
}

// ─── Hub Header ───────────────────────────────────────────────────────────────

function HubHeader({ activeTab, router, onLeave }: {
  activeTab: Tab;
  router: ReturnType<typeof useRouter>;
  onLeave: () => void;
}) {
  return (
    <View style={s.header}>
      {/* Back button — always visible */}
      <TouchableOpacity
        style={s.headerBtn}
        onPress={onLeave}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
      >
        <Feather name="arrow-left" size={ICON.sm} color={FG} />
      </TouchableOpacity>

      <Text style={[s.headerTitle, { flex: 1, marginHorizontal: SP.sm }]}>Manufacturer Hub</Text>

      <View style={s.headerActions}>
        {/* Invite button shown on Discover tab — add your own off-platform manufacturer */}
        {activeTab === 'discover' && (
          <TouchableOpacity
            style={s.headerBtn}
            onPress={() => router.push('/invite-manufacturer' as never)}
            activeOpacity={0.75}
          >
            <Feather name="user-plus" size={ICON.sm} color={PURPLE_LIGHT} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.headerBtn} onPress={() => {}}>
          <Feather name="search" size={ICON.sm} color={FG} />
        </TouchableOpacity>
        <TouchableOpacity style={s.headerBtn} onPress={() => {}}>
          <Feather name="sliders" size={ICON.sm} color={FG} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOVER TAB
// ═══════════════════════════════════════════════════════════════════════════════

interface Filters {
  country: string;
  category: string;
  moqMax: number | undefined;
  unitPriceMaxCents: number | undefined;
  leadTimeDaysMax: number | undefined;
  verifiedOnly: boolean;
  ratingMin: number | undefined;
}

const DEFAULT_FILTERS: Filters = {
  country: '',
  category: '',
  moqMax: undefined,
  unitPriceMaxCents: undefined,
  leadTimeDaysMax: undefined,
  verifiedOnly: false,
  ratingMin: undefined,
};

function DiscoverTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (query = searchQuery, f = filters) => {
    try {
      setLoadError('');
      const [results, favoriteIds] = await Promise.all([
        searchManufacturers({
          query: query || undefined,
          country: f.country || undefined,
          category: f.category || undefined,
          moqMax: f.moqMax,
          unitPriceMaxCents: f.unitPriceMaxCents,
          leadTimeDaysMax: f.leadTimeDaysMax,
          verifiedOnly: f.verifiedOnly || undefined,
          ratingMin: f.ratingMin,
        }),
        getFavoriteManufacturerIds(),
      ]);
      setManufacturers(Array.isArray(results) ? results : []);
      setSavedIds(new Set(favoriteIds));
    } catch (e) {
      setManufacturers([]);
      setSavedIds(new Set());
      if (!showManufacturerUpgrade(e, router)) {
        setLoadError('Could not load manufacturers or favorites.');
      }
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, filters]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  const onSearch = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(q, filters), 350);
  };

  const applyFilters = (f: Filters) => {
    setFilters(f);
    setFilterModalVisible(false);
    load(searchQuery, f);
  };

  const toggleSave = async (mfg: Manufacturer) => {
    if (savingIds.has(mfg.id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMutationError('');
    setSavingIds(prev => new Set(prev).add(mfg.id));
    try {
      if (savedIds.has(mfg.id)) {
        await unfavoriteManufacturer(mfg.id);
        setSavedIds(prev => { const s = new Set(prev); s.delete(mfg.id); return s; });
      } else {
        await completeSetupTaskAfter(
          'connect_manufacturer',
          () => saveManufacturer(mfg.id),
        );
        setSavedIds(prev => new Set(prev).add(mfg.id));
      }
    } catch (e) {
      if (!showManufacturerUpgrade(e, router)) {
        setMutationError('Could not update this favorite. Try again.');
      }
      console.error(e);
    } finally {
      setSavingIds(prev => { const s = new Set(prev); s.delete(mfg.id); return s; });
    }
  };

  const visibleManufacturers = favoritesOnly
    ? manufacturers.filter(mfg => savedIds.has(mfg.id))
    : manufacturers;

  const onMessage = async (mfg: Manufacturer) => {
    try {
      const conv = await getOrCreateConversation(mfg.id);
      router.push((`/manufacturer-messages?threadId=${conv.id}`) as never);
    } catch (e) {
      showManufacturerUpgrade(e, router);
      console.error(e);
    }
  };

  return (
    <View style={s.flex}>
      {/* Search bar */}
      <View style={s.searchRow}>
        <TouchableOpacity
          style={s.searchToggle}
          onPress={() => setSearchActive(v => !v)}
          activeOpacity={0.8}
        >
          <Feather name="search" size={ICON.sm} color={MUTED} />
        </TouchableOpacity>
        {searchActive && (
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={onSearch}
            placeholder="Search manufacturers…"
            placeholderTextColor={SUBTLE}
            autoFocus
          />
        )}
        <TouchableOpacity
          style={[s.filterBtn, Object.values(filters).some(v => v !== '' && v !== false && v !== undefined) && s.filterBtnActive]}
          onPress={() => setFilterModalVisible(true)}
          activeOpacity={0.8}
        >
          <Feather name="sliders" size={ICON.sm} color={PURPLE_LIGHT} />
        </TouchableOpacity>
      </View>

      <View style={s.discoverModeRow}>
        <FilterChip label="All" active={!favoritesOnly} onPress={() => setFavoritesOnly(false)} />
        <FilterChip label={`Favorites (${savedIds.size})`} active={favoritesOnly} onPress={() => setFavoritesOnly(true)} />
      </View>

      {!!(loadError || mutationError) && (
        <TouchableOpacity
          style={s.inlineError}
          onPress={() => load()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading favorite manufacturers"
        >
          <Feather name="alert-circle" size={ICON.sm} color={ORANGE} />
          <Text style={s.inlineErrorText}>{loadError || mutationError}</Text>
          <Text style={s.inlineErrorAction}>Retry</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={visibleManufacturers}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={s.gridRow}
        renderItem={({ item }) => (
          <ManufacturerCard
            mfg={item}
            saved={savedIds.has(item.id)}
            saving={savingIds.has(item.id)}
            onSave={() => toggleSave(item)}
            onMessage={() => onMessage(item)}
            onProfile={() => router.push((`/manufacturer-profile?id=${item.id}`) as never)}
            onQuote={() => router.push((`/quote-request?manufacturerId=${item.id}`) as never)}
          />
        )}
        contentContainerStyle={[s.listContent, s.gridContent]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={favoritesOnly ? 'heart' : 'search'}
              title={loadError ? 'Could not load manufacturers' : favoritesOnly ? 'No favorite manufacturers yet' : 'No manufacturers found'}
              description={loadError ? 'Check your connection and try again.' : favoritesOnly ? 'Save manufacturers from Discover and they will appear here.' : 'Try adjusting your search or filters.'}
              action={loadError
                ? { label: 'Try again', onPress: () => load() }
                : favoritesOnly
                  ? { label: 'Browse manufacturers', onPress: () => setFavoritesOnly(false) }
                  : { label: 'Clear filters', onPress: () => applyFilters(DEFAULT_FILTERS) }}
            />
          )
        }
      />

      <FilterModal
        visible={filterModalVisible}
        filters={filters}
        onApply={applyFilters}
        onClose={() => setFilterModalVisible(false)}
      />
    </View>
  );
}

// ─── Manufacturer Card ────────────────────────────────────────────────────────

interface ManufacturerCardProps {
  mfg: Manufacturer;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onMessage: () => void;
  onProfile: () => void;
  onQuote: () => void;
}

function ManufacturerCard({ mfg, saved, saving, onSave, onMessage, onProfile, onQuote }: ManufacturerCardProps) {
  const { theme } = useAppTheme();
  return (
    <View style={card.root}>
      {/* Compact directory tile: image first, then the key sourcing details. */}
      <TouchableOpacity onPress={onProfile} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`View ${mfg.name} profile`}>
        <View style={card.cover}>
          {mfg.profileImageUri ? (
            <Image source={{ uri: mfg.profileImageUri }} style={card.coverImage} resizeMode="cover" />
          ) : (
            <View style={card.coverFallback}>
              <Text style={card.coverFallbackText}>{mfg.name.charAt(0)}</Text>
            </View>
          )}
          <TouchableOpacity
            style={card.saveOverlay}
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${mfg.name} from favorites` : `Add ${mfg.name} to favorites`}
          >
            <Feather name="heart" size={15} color={saved ? RED : FG} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      <View style={card.topRow}>
        <View style={card.nameCol}>
          <View style={card.nameRow}>
            <Text style={card.name} numberOfLines={1}>{mfg.name}</Text>
            {mfg.isVerified && (
              <View style={[card.verifiedBadge, { backgroundColor: theme.secondaryDim }]}>
                <Feather name="check-circle" size={11} color={theme.secondary} />
              </View>
            )}
          </View>
          <Text style={card.location} numberOfLines={1}>{mfg.city}, {mfg.country}</Text>
          <View style={card.ratingRow}>
            <Feather name="star" size={12} color={GOLD} />
            <Text style={card.ratingText}>{mfg.reviewCount > 0 ? mfg.rating.toFixed(1) : 'Not rated'}</Text>
            {mfg.reviewCount > 0 && <Text style={card.reviewCount}>({mfg.reviewCount})</Text>}
          </View>
        </View>
      </View>

      <Text style={card.specialties} numberOfLines={2}>
        {(Array.isArray(mfg.specialties) ? mfg.specialties : []).slice(0, 3).join(' • ')}
      </Text>
      <View style={card.detailStack}>
        <Text style={card.stats} numberOfLines={1}>MOQ {mfg.moq || 'Contact'} · {mfg.leadTimeDays ? `${mfg.leadTimeDays}d lead` : 'Lead time varies'}</Text>
        <Text style={card.response} numberOfLines={1}>{mfg.responseTimeHours > 0 ? `Replies in ~${mfg.responseTimeHours}h` : 'Response time not provided'}</Text>
      </View>

      {/* Actions */}
      <View style={card.actionRow}>
        <TouchableOpacity
          style={card.iconAction}
          onPress={onMessage}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Message ${mfg.name}`}
        >
          <Feather name="mail" size={15} color={theme.secondary} />
        </TouchableOpacity>
        <TouchableOpacity style={[card.profileBtn, { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={onQuote} activeOpacity={0.7}>
          <Text style={[card.profileBtnText, { color: theme.onAccent }]}>Request quote</Text>
          <Feather name="arrow-right" size={ICON.sm} color={theme.onAccent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  root:          { flex: 1, minWidth: 0, backgroundColor: CARD_GLASS, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginBottom: SP.sm, padding: SP.sm },
  cover:         { height: 112, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: PURPLE_DIM, position: 'relative', marginBottom: SP.sm },
  coverImage:    { width: '100%', height: '100%' },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverFallbackText: { fontSize: 34, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  saveOverlay:   { position: 'absolute', top: 7, right: 7, width: 28, height: 28, borderRadius: 14, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  topRow:        { marginBottom: SP.xs },
  nameCol:       { flex: 1 },
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: SP.xs, flexWrap: 'wrap' },
  name:          { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, flex: 1 },
  verifiedBadge: { width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  verifiedText:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: CYAN },
  location:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  ratingRow:     { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ratingText:    { fontSize: FS.xs, fontFamily: FONT.semibold, color: GOLD },
  reviewCount:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  specialties:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: SP.xs, minHeight: 28 },
  detailStack:   { minHeight: 36, marginBottom: SP.sm },
  stats:         { fontSize: FS.xs, fontFamily: FONT.regular, color: FG, marginBottom: 3 },
  response:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  actionRow:     { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  iconAction:    { width: 32, height: 32, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  profileBtn:    { flex: 1, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: RADIUS.sm, borderWidth: 1 },
  profileBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: ON_DARK },
});

// ─── Filter Modal ─────────────────────────────────────────────────────────────

function FilterModal({ visible, filters, onApply, onClose }: {
  visible: boolean;
  filters: Filters;
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Filters>(filters);
  const insets = useSafeAreaInsets();

  useEffect(() => { if (visible) setLocal(filters); }, [visible]);

  const set = <K extends keyof Filters>(key: K, val: Filters[K]) =>
    setLocal(prev => ({ ...prev, [key]: val }));

  const toggle = <K extends keyof Filters>(key: K, val: Filters[K]) =>
    setLocal(prev => ({ ...prev, [key]: prev[key] === val ? (typeof val === 'number' ? undefined : '') : val }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[fm.root, { paddingBottom: insets.bottom + SP.md }]}>
        <View style={fm.handle} />
        <View style={fm.header}>
          <Text style={fm.title}>Filter Manufacturers</Text>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={ICON.md} color={MUTED} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fm.scroll}>

          <Text style={fm.sectionLabel}>Country</Text>
          <View style={fm.chipRow}>
            {['Portugal', 'China', 'United States', 'Turkey'].map(c => (
              <FilterChip key={c} label={c} active={local.country === c} onPress={() => toggle('country', c as any)} />
            ))}
          </View>

          <Text style={fm.sectionLabel}>Category</Text>
          <View style={fm.chipRow}>
            {['Hoodies', 'T-Shirts', 'Activewear', 'Denim', 'Outerwear'].map(c => (
              <FilterChip key={c} label={c} active={local.category === c} onPress={() => toggle('category', c as any)} />
            ))}
          </View>

          <Text style={fm.sectionLabel}>Min Order Qty (MOQ)</Text>
          <View style={fm.chipRow}>
            {[{ label: '≤25', val: 25 }, { label: '≤50', val: 50 }, { label: '≤100', val: 100 }, { label: '≤200', val: 200 }, { label: 'Any', val: undefined }].map(({ label, val }) => (
              <FilterChip key={label} label={label} active={local.moqMax === val} onPress={() => set('moqMax', val)} />
            ))}
          </View>

          <Text style={fm.sectionLabel}>Unit Price</Text>
          <View style={fm.chipRow}>
            {[{ label: '≤$10', val: 10 }, { label: '≤$20', val: 20 }, { label: '≤$35', val: 35 }, { label: 'Any', val: undefined }].map(({ label, val }) => (
              <FilterChip key={label} label={label} active={local.unitPriceMaxCents === (val === undefined ? undefined : val * 100)} onPress={() => set('unitPriceMaxCents', val === undefined ? undefined : val * 100)} />
            ))}
          </View>

          <Text style={fm.sectionLabel}>Lead Time</Text>
          <View style={fm.chipRow}>
            {[{ label: '≤14 days', val: 14 }, { label: '≤30 days', val: 30 }, { label: '≤45 days', val: 45 }, { label: 'Any', val: undefined }].map(({ label, val }) => (
              <FilterChip key={label} label={label} active={local.leadTimeDaysMax === val} onPress={() => set('leadTimeDaysMax', val)} />
            ))}
          </View>

          <Text style={fm.sectionLabel}>Rating</Text>
          <View style={fm.chipRow}>
            {[{ label: '≥4.5', val: 4.5 }, { label: '≥4.0', val: 4.0 }, { label: 'Any', val: undefined }].map(({ label, val }) => (
              <FilterChip key={label} label={label} active={local.ratingMin === val} onPress={() => set('ratingMin', val)} />
            ))}
          </View>

          <View style={fm.switchRow}>
            <Text style={fm.switchLabel}>Verified only</Text>
            <Switch
              value={local.verifiedOnly}
              onValueChange={v => set('verifiedOnly', v)}
              trackColor={{ true: PURPLE, false: BORDER }}
              thumbColor={ON_DARK}
            />
          </View>

        </ScrollView>

        <View style={fm.footer}>
          <SecondaryButton label="Reset" onPress={() => setLocal(DEFAULT_FILTERS)} style={fm.resetBtn} small />
          <PrimaryButton label="Apply filters" onPress={() => onApply(local)} style={fm.applyBtn} />
        </View>
      </View>
    </Modal>
  );
}

const fm = StyleSheet.create({
  root:        { flex: 1, backgroundColor: SURFACE_GLASS },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginTop: SP.sm },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.md },
  title:       { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  scroll:      { paddingHorizontal: SP.md, paddingBottom: SP.lg },
  sectionLabel:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginTop: SP.md, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  switchRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.lg, paddingVertical: SP.sm },
  switchLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  footer:      { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: BORDER },
  resetBtn:    { flex: 1 },
  applyBtn:    { flex: 2 },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MY MANUFACTURERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function MyManufacturersTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [relationships, setRelationships] = useState<ManufacturerRelationship[]>([]);
  const [mfgMap, setMfgMap] = useState<Record<string, Manufacturer>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const rels = await getRelationships();
      const safeRels = Array.isArray(rels) ? rels : [];
      setRelationships(safeRels);
      await completeSetupTaskWhen('connect_manufacturer', safeRels.length > 0);
      const map: Record<string, Manufacturer> = {};
      await Promise.all(safeRels.map(async rel => {
        const mfg = await getManufacturer(rel.manufacturerId);
        if (mfg) map[mfg.id] = mfg;
      }));
      setMfgMap(map);
    } catch (e) {
      setRelationships([]);
      setError('Could not load your saved manufacturers.');
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  const showMore = (rel: ManufacturerRelationship, mfg: Manufacturer) => {
    const options = ['Message', 'Request Quote', 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 2 },
        idx => {
          if (idx === 0) getOrCreateConversation(mfg.id)
            .then(conv => router.push((`/manufacturer-messages?threadId=${conv.id}`) as never))
            .catch(() => setError('Could not open a conversation. Please try again.'));
          if (idx === 1) router.push((`/quote-request?manufacturerId=${mfg.id}`) as never);
        }
      );
    } else {
      Alert.alert(mfg.name, 'Choose action', [
        { text: 'Message', onPress: () => getOrCreateConversation(mfg.id)
          .then(conv => router.push((`/manufacturer-messages?threadId=${conv.id}`) as never))
          .catch(() => setError('Could not open a conversation. Please try again.')) },
        { text: 'Request Quote', onPress: () => router.push((`/quote-request?manufacturerId=${mfg.id}`) as never) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  if (!loading && error) {
    return <EmptyState icon="alert-circle" title="Could not load manufacturers" description={error}
      action={{ label: 'Try again', onPress: load, icon: 'refresh-cw' }} style={s.emptyState} />;
  }

  if (!loading && relationships.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="Build your production network."
        description="Save manufacturers and track your relationships here."
        action={{ label: 'Invite a manufacturer', onPress: () => router.push('/invite-manufacturer' as never), icon: 'user-plus' }}
        style={s.emptyState}
      />
    );
  }

  return (
    <FlatList
      data={relationships}
      keyExtractor={item => item.id}
      renderItem={({ item: rel }) => {
        const mfg = mfgMap[rel.manufacturerId];
        if (!mfg) return null;
        return (
          <View style={relCard.root}>
            <View style={relCard.topRow}>
              <View style={relCard.avatar}>
                <Text style={relCard.avatarText}>{mfg.name.charAt(0)}</Text>
              </View>
              <View style={relCard.info}>
                <View style={relCard.nameRow}>
                  <Text style={relCard.name} numberOfLines={1}>{mfg.name}</Text>
                  <StatusBadge label={rel.status} variant={relStatusVariant(rel.status)} small />
                </View>
                <Text style={relCard.location}>{mfg.city}, {mfg.country}</Text>
                <Text style={relCard.counts}>
                  Products: {rel.activeProductIds.length} · Quotes: 0 · Samples: 0
                </Text>
                {rel.lastMessagePreview && (
                  <Text style={relCard.lastMsg} numberOfLines={1}>
                    "{rel.lastMessagePreview}" · {timeAgo(rel.lastMessageAt)}
                  </Text>
                )}
              </View>
            </View>
            <View style={relCard.divider} />
            <View style={relCard.actionRow}>
              <TouchableOpacity style={relCard.btn} onPress={() => getOrCreateConversation(mfg.id).then(conv => router.push((`/manufacturer-messages?threadId=${conv.id}`) as never))}>
                <Feather name="message-circle" size={ICON.sm} color={CYAN} />
                <Text style={[relCard.btnText, { color: CYAN }]}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity style={relCard.btn} onPress={() => router.push((`/quote-request?manufacturerId=${mfg.id}`) as never)}>
                <Feather name="file-text" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={[relCard.btnText, { color: PURPLE_LIGHT }]}>Quote</Text>
              </TouchableOpacity>
              <TouchableOpacity style={relCard.btn} onPress={() => router.push((`/manufacturer-profile?id=${mfg.id}`) as never)}>
                <Feather name="user" size={ICON.sm} color={MUTED} />
                <Text style={relCard.btnText}>Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={relCard.btn} onPress={() => showMore(rel, mfg)}>
                <Feather name="more-horizontal" size={ICON.sm} color={MUTED} />
                <Text style={relCard.btnText}>More</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
    />
  );
}

const relCard = StyleSheet.create({
  root:     { backgroundColor: CARD_GLASS, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:   { flexDirection: 'row', gap: SP.md },
  avatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER_ACTIVE },
  avatarText:{ fontSize: FS.md, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  info:     { flex: 1 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.xs },
  name:     { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flex: 1 },
  location: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  counts:   { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  lastMsg:  { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 3 },
  divider:  { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  actionRow:{ flexDirection: 'row', gap: SP.xs },
  btn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SP.sm, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED },
  btnText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUOTES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function QuotesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [manufacturerNames, setManufacturerNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const [reqs, qs] = await Promise.all([getQuoteRequests(), getQuotes()]);
      setQuoteRequests((Array.isArray(reqs) ? reqs : []).filter(r => r.status !== 'accepted'));
      setQuotes(Array.isArray(qs) ? qs : []);
      const ids = [...new Set([...reqs, ...qs].map(item => item.manufacturerId).filter(Boolean))];
      const profiles = await Promise.all(ids.map(id => getManufacturer(id)));
      setManufacturerNames(Object.fromEntries(profiles.filter(Boolean).map(profile => [profile!.id, profile!.name])));
    } catch (e) {
      setQuoteRequests([]);
      setQuotes([]);
      setManufacturerNames({});
      setError('Could not load quotes. Check your connection and try again.');
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  const handleAccept = (quote: Quote) => {
    Alert.alert('Accept Quote', `Accept this quote for ${formatCents(quote.unitPriceCents)}/unit?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Accept', onPress: () => acceptQuote(quote.id).then(load)
        .catch(() => setError('Could not accept this quote. Refresh and try again.')) },
    ]);
  };

  const handleDecline = (quote: Quote) => {
    Alert.alert('Decline Quote', 'Are you sure you want to decline this quote?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => declineQuote(quote.id).then(load)
        .catch(() => setError('Could not decline this quote. Refresh and try again.')) },
    ]);
  };

  // Group quotes by requestId for compare detection
  const quotesByRequest: Record<string, Quote[]> = {};
  if (!loading && error) {
    return <EmptyState icon="alert-circle" title="Could not load quotes" description={error}
      action={{ label: 'Try again', onPress: load, icon: 'refresh-cw' }} style={s.emptyState} />;
  }

  quotes.forEach(q => {
    if (!quotesByRequest[q.quoteRequestId]) quotesByRequest[q.quoteRequestId] = [];
    quotesByRequest[q.quoteRequestId].push(q);
  });

  if (!loading && quoteRequests.length === 0 && quotes.length === 0) {
    return (
      <View style={s.flex}>
        <EmptyState
          icon="file-text"
          title="Request your first production quote."
          description="Send quote requests to manufacturers and compare their offers."
          action={{ label: 'Request a quote', onPress: () => router.push('/quote-request' as never), icon: 'plus' }}
          style={s.emptyState}
        />
        <QuotesFAB router={router} />
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
      >
        {quoteRequests.length > 0 && (
          <>
            <SectionHeader title="Quote Requests" style={s.sectionHeader} />
            {quoteRequests.map(req => (
              <QuoteRequestCard
                key={req.id}
                req={req}
                manufacturerName={manufacturerNames[req.manufacturerId]}
                onView={() => router.push((`/quote-detail?quoteId=${req.id}`) as never)}
                onWithdraw={() => withdrawQuoteRequest(req.id).then(load).catch(() => setError('Could not withdraw this request. Refresh and try again.'))}
              />
            ))}
          </>
        )}
        {quotes.length > 0 && (
          <>
            <SectionHeader title="Quotes Received" style={s.sectionHeader} />
            {quotes.map(q => (
              <QuoteReceivedCard
                key={q.id}
                quote={q}
                manufacturerName={manufacturerNames[q.manufacturerId]}
                canCompare={(quotesByRequest[q.quoteRequestId]?.length ?? 0) >= 2}
                onAccept={() => handleAccept(q)}
                onDecline={() => handleDecline(q)}
                onCounter={() => router.push((`/quote-detail?quoteId=${q.id}&mode=counter`) as never)}
                onCompare={() => router.push((`/quote-compare?requestId=${q.quoteRequestId}`) as never)}
                onDetails={() => router.push((`/quote-detail?quoteId=${q.id}`) as never)}
              />
            ))}
          </>
        )}
      </ScrollView>
      <QuotesFAB router={router} />
    </View>
  );
}

function QuotesFAB({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={fab.root}
      onPress={() => router.push('/quote-request' as never)}
      activeOpacity={0.85}
    >
      <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={fab.grad}>
        <Feather name="plus" size={ICON.md} color={theme.onAccent} />
        <Text style={[fab.label, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Request quote</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const fab = StyleSheet.create({
  root: { position: 'absolute', bottom: SP.lg, right: SP.md, borderRadius: RADIUS.pill, overflow: 'hidden', elevation: 8 },
  grad: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm + 2 },
  label:{ fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
});

function QuoteRequestCard({ req, manufacturerName, onView, onWithdraw }: { req: QuoteRequest; manufacturerName?: string; onView: () => void; onWithdraw: () => void }) {
  return (
    <View style={qc.root}>
      <View style={qc.topRow}>
        <Text style={qc.productName} numberOfLines={1}>{req.productName}</Text>
        <StatusBadge label={req.status.replace(/_/g, ' ')} variant={quoteRequestStatusVariant(req.status)} small />
      </View>
      {!!manufacturerName && <Text style={qc.mfgName}>{manufacturerName}</Text>}
      <Text style={qc.details}>Qty: {req.quantity}{req.targetUnitPriceCents ? ` · Target: ${formatCents(req.targetUnitPriceCents)}/unit` : ''}</Text>
      {req.submittedAt && <Text style={qc.date}>Submitted: {fmtDate(req.submittedAt)}</Text>}
      <View style={qc.actionRow}>
        <TouchableOpacity style={qc.btn} onPress={onView}>
          <Text style={qc.btnText}>View</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[qc.btn, qc.dangerBtn]} onPress={onWithdraw}>
          <Text style={[qc.btnText, { color: RED }]}>Withdraw</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function QuoteReceivedCard({ quote, manufacturerName, canCompare, onAccept, onDecline, onCounter, onCompare, onDetails }: {
  quote: Quote; canCompare: boolean;
  manufacturerName?: string;
  onAccept: () => void; onDecline: () => void;
  onCounter: () => void; onCompare: () => void; onDetails: () => void;
}) {
  return (
    <View style={qc.root}>
      <View style={qc.topRow}>
        <Text style={qc.productName} numberOfLines={1}>{quote.productName}</Text>
        <StatusBadge label="Quote received" variant="success" small />
      </View>
      {!!manufacturerName && <Text style={qc.mfgName}>{manufacturerName}</Text>}
      <Text style={qc.details}>Unit: {formatCents(quote.unitPriceCents)} · Total: ~{formatCents(quote.totalEstimateCents)}</Text>
      {quote.validUntil && <Text style={qc.date}>Expires: {fmtDate(quote.validUntil)}</Text>}
      <View style={[qc.actionRow, { flexWrap: 'wrap' }]}>
        <TouchableOpacity style={[qc.btn, qc.successBtn]} onPress={onAccept}>
          <Text style={[qc.btnText, { color: SUCCESS }]}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[qc.btn, qc.dangerBtn]} onPress={onDecline}>
          <Text style={[qc.btnText, { color: RED }]}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={qc.btn} onPress={onCounter}>
          <Text style={qc.btnText}>Counter</Text>
        </TouchableOpacity>
        {canCompare && (
          <TouchableOpacity style={qc.btn} onPress={onCompare}>
            <Text style={qc.btnText}>Compare</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={qc.btn} onPress={onDetails}>
          <Text style={qc.btnText}>Details</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const qc = StyleSheet.create({
  root:       { backgroundColor: CARD_GLASS, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  productName:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flex: 1, marginRight: SP.sm },
  mfgName:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.xs },
  details:    { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, marginBottom: SP.xs },
  date:       { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginBottom: SP.sm },
  actionRow:  { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  btn:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED },
  dangerBtn:  { borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.08)' },
  successBtn: { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.08)' },
  btnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
});

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SamplesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const s = await getSamples();
      setSamples(s.filter(order => order.orderType !== 'bulk'));
    } catch (e) {
      setError('Could not load sample orders.');
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));
  useEffect(() => {
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) return <View style={s.centered}><ActivityIndicator color={PURPLE} /></View>;
  if (error) {
    return <EmptyState icon="alert-circle" title="Could not load samples" description={error}
      action={{ label: 'Try again', onPress: load, icon: 'refresh-cw' }} style={s.emptyState} />;
  }
  if (samples.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="Your samples will appear here."
        description="Request samples from manufacturers to review quality before production."
        action={{ label: 'Create sample', onPress: () => router.push('/quote-request' as never), icon: 'plus' }}
        style={s.emptyState}
      />
    );
  }

  return (
    <FlatList
      data={samples}
      keyExtractor={item => item.id}
      renderItem={({ item }) => {
        const canReview = item.status === 'review_needed' || item.status === 'delivered';
        return (
          <View style={smpCard.root}>
            <View style={smpCard.topRow}>
              <Text style={smpCard.productName} numberOfLines={1}>{item.productName}</Text>
              <StatusBadge label={item.status.replace(/_/g, ' ')} variant={sampleStatusVariant(item.status)} small />
            </View>
            {!!item.manufacturerName && <Text style={smpCard.mfgName}>{item.manufacturerName}</Text>}
            {item.estimatedCompletionDate && (
              <Text style={smpCard.date}>Est: {fmtDate(item.estimatedCompletionDate)}</Text>
            )}
            <Text style={smpCard.details}>Type: {item.type.replace(/_/g, ' ')} · Cost: {formatCents(item.costCents)}</Text>
            <View style={smpCard.actionRow}>
              <TouchableOpacity style={smpCard.btn} onPress={() => router.push((`/sample-detail?id=${item.id}`) as never)}>
                <Text style={smpCard.btnText}>Details</Text>
              </TouchableOpacity>
              {canReview && (
                <>
                  <TouchableOpacity style={[smpCard.btn, smpCard.successBtn]} onPress={() => router.push((`/sample-detail?id=${item.id}&action=approve`) as never)}>
                    <Text style={[smpCard.btnText, { color: SUCCESS }]}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[smpCard.btn, smpCard.warnBtn]} onPress={() => router.push((`/sample-detail?id=${item.id}&action=revision`) as never)}>
                    <Text style={[smpCard.btnText, { color: ORANGE }]}>Revision</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );
      }}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
    />
  );
}

const smpCard = StyleSheet.create({
  root:       { backgroundColor: CARD_GLASS, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  productName:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flex: 1, marginRight: SP.sm },
  mfgName:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.xs },
  date:       { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginBottom: SP.xs },
  details:    { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, marginBottom: SP.sm },
  actionRow:  { flexDirection: 'row', gap: SP.sm },
  btn:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED },
  successBtn: { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.08)' },
  warnBtn:    { borderColor: 'rgba(249,115,22,0.3)', backgroundColor: 'rgba(249,115,22,0.08)' },
  btnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ProductionTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const orders = await getProductionOrders();
      setProductionOrders(orders);
    } catch (e) {
      setError('Could not load production orders.');
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));
  useEffect(() => {
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) return <View style={s.centered}><ActivityIndicator color={PURPLE} /></View>;
  if (error) {
    return <EmptyState icon="alert-circle" title="Could not load production" description={error}
      action={{ label: 'Try again', onPress: load, icon: 'refresh-cw' }} style={s.emptyState} />;
  }
  if (productionOrders.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="Approved products move into production here."
        description="Accept a quote to start a production order."
        action={{ label: 'View quotes', onPress: () => router.push('/manufacturer-hub' as never), icon: 'file-text' }}
        style={s.emptyState}
      />
    );
  }

  return (
    <FlatList
      data={productionOrders}
      keyExtractor={item => item.id}
      renderItem={({ item: order }) => {
        const stageKeys = PRODUCTION_STAGES.map(s => s.key);
        const currentIdx = stageKeys.indexOf(order.currentStage);
        const progressPct = Math.round((currentIdx / (PRODUCTION_STAGES.length - 1)) * 100);
        const currentStageLabel = PRODUCTION_STAGES.find(s => s.key === order.currentStage)?.label ?? order.currentStage;

        return (
          <View style={prodCard.root}>
            <View style={prodCard.topRow}>
              <View style={prodCard.nameCol}>
                <Text style={prodCard.productName} numberOfLines={1}>{order.productName}</Text>
                <Text style={prodCard.mfgLine}>{order.manufacturerName ?? 'Manufacturer'} · {order.quantity} units</Text>
              </View>
              <StatusBadge label={order.status} variant={productionStatusVariant(order.status)} small />
            </View>

            <Text style={prodCard.stage}>
              Stage {currentIdx + 1}/{PRODUCTION_STAGES.length}: {currentStageLabel}
              {order.estimatedCompletionDate ? `  ·  Est: ${fmtDate(order.estimatedCompletionDate)}` : ''}
            </Text>

            <Text style={prodCard.costs}>
              Cost: {formatCents(order.totalCostCents)} · Paid: {formatCents(order.depositAmountCents)} · Remaining: {formatCents(order.remainingBalanceCents)}
            </Text>

            {/* Progress bar */}
            <View style={prodCard.track}>
              <View style={[prodCard.fill, { width: `${progressPct}%` as any }]} />
            </View>
            <Text style={prodCard.pct}>{progressPct}%</Text>

            <View style={prodCard.actionRow}>
              <TouchableOpacity style={prodCard.btn} onPress={() => router.push((`/production-detail?id=${order.id}`) as never)}>
                <Text style={prodCard.btnText}>Details</Text>
              </TouchableOpacity>
              {!!order.threadId && (
                <TouchableOpacity style={prodCard.btn} onPress={() => router.push((`/manufacturer-messages?threadId=${order.threadId}`) as never)}>
                  <Text style={prodCard.btnText}>Message</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      }}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
    />
  );
}

const prodCard = StyleSheet.create({
  root:       { backgroundColor: CARD_GLASS, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP.sm },
  nameCol:    { flex: 1, marginRight: SP.sm },
  productName:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  mfgLine:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  stage:      { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, marginBottom: SP.xs },
  costs:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.sm },
  track:      { height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, overflow: 'hidden', marginBottom: SP.xs },
  fill:       { height: '100%', borderRadius: RADIUS.pill, backgroundColor: PURPLE },
  pct:        { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT, marginBottom: SP.sm },
  actionRow:  { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  btn:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED },
  advanceBtn: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  btnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function MessagesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [conversations, setConversations] = useState<ManufacturerConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const convs = await getConversations();
      setConversations(convs);
    } catch (e) {
      setError('Could not load manufacturer messages.');
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));
  useEffect(() => {
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) return <View style={s.centered}><ActivityIndicator color={PURPLE} /></View>;
  if (error) {
    return <EmptyState icon="alert-circle" title="Could not load messages" description={error}
      action={{ label: 'Try again', onPress: load, icon: 'refresh-cw' }} style={s.emptyState} />;
  }
  if (conversations.length === 0) {
    return (
      <EmptyState
        icon="message-circle"
        title="Manufacturer conversations will appear here."
        description="Message manufacturers directly from their profiles or quote requests."
        style={s.emptyState}
      />
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={item => item.id}
      renderItem={({ item: conv }) => (
        <TouchableOpacity
          style={msgCard.root}
          activeOpacity={0.8}
          onPress={() => router.push((`/manufacturer-messages?threadId=${conv.id}`) as never)}
        >
          <View style={msgCard.avatar}>
            <Text style={msgCard.avatarText}>{conv.manufacturerName.charAt(0)}</Text>
          </View>
          <View style={msgCard.body}>
            <View style={msgCard.topRow}>
              <Text style={msgCard.name} numberOfLines={1}>{conv.manufacturerName}</Text>
              <Text style={msgCard.time}>{timeAgo(conv.lastMessageAt)}</Text>
            </View>
            {conv.contextLabel && (
              <Text style={msgCard.context} numberOfLines={1}>{conv.contextLabel}</Text>
            )}
            {conv.lastMessage && (
              <Text style={msgCard.preview} numberOfLines={1}>{conv.lastMessage}</Text>
            )}
          </View>
          {conv.unreadCount > 0 && (
            <View style={msgCard.badge}>
              <Text style={msgCard.badgeText}>{conv.unreadCount > 9 ? '9+' : conv.unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={PURPLE} />}
    />
  );
}

const msgCard = StyleSheet.create({
  root:      { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD_GLASS, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, marginHorizontal: SP.md, marginBottom: SP.sm, padding: SP.md },
  avatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER_ACTIVE },
  avatarText:{ fontSize: FS.md, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  body:      { flex: 1 },
  topRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  name:      { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flex: 1 },
  time:      { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginLeft: SP.sm },
  context:   { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT, marginBottom: 2 },
  preview:   { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  badge:     { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
});

// ─── Root styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  flex:         { flex: 1 },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.headerH },
  headerTitle:  { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  headerActions:{ flexDirection: 'row', gap: SP.sm },
  headerBtn:    { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  tabBarWrapper:{ borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE_GLASS },
  tabBarContent:{ paddingHorizontal: SP.md },
  tabItem:      { marginRight: SP.sm, alignItems: 'center' },
  tabInner:     { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingVertical: SP.sm, paddingHorizontal: SP.sm },
  tabLabel:     { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive:{ color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  tabUnderline: { height: 2, width: '100%', backgroundColor: PURPLE, borderRadius: RADIUS.pill },
  planErrorBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginTop: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: '#2B1E0F', borderWidth: 1, borderColor: ORANGE },
  planErrorText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: ORANGE },
  content:      { flex: 1 },
  listContent:  { paddingTop: SP.md, paddingBottom: SP.xxl + COMP.tabBarH },
  gridContent:  { paddingHorizontal: SP.md },
  gridRow:      { gap: SP.sm, alignItems: 'stretch' },
  sectionHeader:{ marginBottom: SP.xs },
  searchRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  searchToggle: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  searchInput:  { flex: 1, height: 36, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE, paddingHorizontal: SP.md, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  filterBtn:    { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  filterBtnActive:{ borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  discoverModeRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.sm, padding: SP.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: ORANGE, backgroundColor: '#2B1E0F' },
  inlineErrorText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: ORANGE },
  inlineErrorAction: { fontSize: FS.sm, fontFamily: FONT.semibold, color: ORANGE },
  emptyState:   { flex: 1, justifyContent: 'center' },
});

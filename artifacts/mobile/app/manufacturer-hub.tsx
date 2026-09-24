/**
 * Manufacturer Hub — 6-tab main screen
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
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
import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';
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
  getConversations, getOrCreateConversation, type DirectorySort,
} from '@/services/manufacturerService';
import { getDirectoryFacets, getSellerOrders, type DirectoryFacets, type SellerOrderRow } from '@/services/manufacturerOrderFlow';
import { formatMoney, orderStatusLabel, stageIndex } from '@workspace/manufacturer-flow';
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
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tab, from } = useLocalSearchParams<{ tab?: string; from?: string }>();
  const isTab = (value: unknown): value is Tab => TABS.some((item) => item.key === value);
  const [activeTab, setActiveTab] = useState<Tab>(isTab(tab) ? tab : 'discover');
  const isSellerSetup = isSellerSetupOrigin(from);

  function leaveSetupDestination() {
    if (isSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  const { hasPlan, loading: planLoading, error: planError } = useSubscriptionPlan();
  const [upsellVisible, setUpsellVisible] = useState(false);
  const hasGrowthAccess = !GROWTH_PLAN_ENFORCEMENT_ENABLED || hasPlan('growth');

  useEffect(() => {
    if (isTab(tab)) setActiveTab(tab);
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
                  color={activeTab === tab.key ? theme.accentLight : theme.muted}
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
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  return (
    <View style={s.header}>
      {/* Back button — always visible */}
      <TouchableOpacity
        style={s.headerBtn}
        onPress={onLeave}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
      >
        <Feather name="arrow-left" size={ICON.sm} color={theme.text} />
      </TouchableOpacity>

      <Text style={[s.headerTitle, { flex: 1, marginHorizontal: SP.sm }]}>Manufacturer Hub</Text>

      {/* Search/filter icons removed here — Discover already has its own working
          search + filter controls; these were dead (no onPress). */}
      <View style={s.headerActions}>
        {/* Invite your own (off-platform) manufacturer with a private signup link */}
        <TouchableOpacity
          style={s.headerBtn}
          onPress={() => router.push('/invite-manufacturer' as never)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Invite your own manufacturer"
          testID="button-invite-manufacturer"
        >
          <Feather name="plus" size={ICON.md} color={theme.text} />
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
  minYears: number | undefined;
  hasPhotos: boolean;
  sort: DirectorySort;
}

const DEFAULT_FILTERS: Filters = {
  country: '',
  category: '',
  moqMax: undefined,
  unitPriceMaxCents: undefined,
  leadTimeDaysMax: undefined,
  verifiedOnly: false,
  ratingMin: undefined,
  minYears: undefined,
  hasPhotos: false,
  sort: 'recommended',
};

function activeFilterCount(f: Filters) {
  return [f.country, f.category, f.moqMax, f.unitPriceMaxCents, f.leadTimeDaysMax, f.ratingMin, f.minYears]
    .filter((value) => value !== '' && value !== undefined).length
    + (f.verifiedOnly ? 1 : 0) + (f.hasPhotos ? 1 : 0);
}

function DiscoverTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (query = searchQuery, f = filters) => {
    try {
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
          minYears: f.minYears,
          hasPhotos: f.hasPhotos || undefined,
          sort: f.sort,
        }),
        getFavoriteManufacturerIds(),
      ]);
      setLoadError(false);
      setManufacturers(Array.isArray(results) ? results : []);
      setSavedIds(new Set(favoriteIds));
    } catch (e) {
      setManufacturers([]);
      setSavedIds(new Set());
      if (!showManufacturerUpgrade(e, router)) {
        setLoadError(true);
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
          <Feather name="search" size={ICON.sm} color={theme.muted} />
        </TouchableOpacity>
        {searchActive && (
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={onSearch}
            placeholder="Search manufacturers…"
            placeholderTextColor={theme.subtle}
            autoFocus
          />
        )}
        <TouchableOpacity
          style={[s.filterBtn, activeFilterCount(filters) > 0 && s.filterBtnActive]}
          onPress={() => setFilterModalVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Filter manufacturers"
          testID="button-directory-filters"
        >
          <Feather name="sliders" size={ICON.sm} color={theme.accentLight} />
          {activeFilterCount(filters) > 0 && <Text style={s.filterCount}>{activeFilterCount(filters)}</Text>}
        </TouchableOpacity>
      </View>

      <View style={s.discoverModeRow}>
        <FilterChip label="All" active={!favoritesOnly} onPress={() => setFavoritesOnly(false)} />
        <FilterChip label={`Favorites (${savedIds.size})`} active={favoritesOnly} onPress={() => setFavoritesOnly(true)} />
      </View>

      {!!mutationError && (
        <TouchableOpacity
          style={s.inlineError}
          onPress={() => setMutationError('')}
          accessibilityRole="alert"
        >
          <Feather name="alert-circle" size={ICON.sm} color={theme.warning} />
          <Text style={s.inlineErrorText}>{mutationError}</Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
        ListHeaderComponent={!loading && !loadError && visibleManufacturers.length > 0 ? (
          <Text style={s.resultCount} testID="directory-result-count">
            {visibleManufacturers.length} {visibleManufacturers.length === 1 ? 'manufacturer' : 'manufacturers'}
            {activeFilterCount(filters) > 0 ? ' match your filters' : ''}
          </Text>
        ) : null}
        ListEmptyComponent={
            loading ? (
              <View style={s.skeletonGrid} testID="directory-loading">
                {[0, 1, 2, 3].map((item) => <View key={item} style={s.skeletonTile} />)}
              </View>
            ) : loadError ? (
              <EmptyState
                icon="wifi-off"
                title="Directory unavailable"
                description="We couldn't load manufacturers. Check your connection and try again."
                action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }}
              />
            ) : (
            <EmptyState
              icon={favoritesOnly ? 'heart' : 'search'}
              title={favoritesOnly ? 'No favorite manufacturers yet' : 'No manufacturers found'}
              description={favoritesOnly ? 'Save manufacturers from Discover and they will appear here.' : 'Try adjusting your search or filters.'}
              action={favoritesOnly
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
  const card = useMemo(() => makeCard(theme), [theme]);
  return (
    <View style={card.root}>
      {/* Compact directory tile: image first, then the key sourcing details. */}
      <View style={card.cover}>
        <TouchableOpacity onPress={onProfile} activeOpacity={0.85} style={card.coverTouch} accessibilityRole="button" accessibilityLabel={`View ${mfg.name} profile`}>
          {mfg.profileImageUri ? (
            <Image source={{ uri: mfg.profileImageUri }} style={card.coverImage} resizeMode="cover" />
          ) : (
            <View style={card.coverFallback}>
              <Text style={card.coverFallbackText}>{mfg.name.charAt(0)}</Text>
            </View>
          )}
        </TouchableOpacity>
          {mfg.yearsInBusiness > 0 && (
            <View style={card.yearsBadge}>
              <Text style={card.yearsText}>{mfg.yearsInBusiness} {mfg.yearsInBusiness === 1 ? 'yr' : 'yrs'}</Text>
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
            <Feather name="heart" size={15} color={saved ? theme.error : theme.text} />
          </TouchableOpacity>
        </View>

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
          <Text style={card.location} numberOfLines={1}>{[mfg.city, mfg.country].filter(Boolean).join(', ')}</Text>
          <View style={card.ratingRow}>
            <Feather name="star" size={12} color={theme.warning} />
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

const makeCard = (theme: AppThemePreset) => StyleSheet.create({
  root:          { flex: 1, minWidth: 0, backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginBottom: SP.sm, padding: SP.sm },
  cover:         { height: 112, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: theme.accentDim, position: 'relative', marginBottom: SP.sm },
  coverTouch:    { flex: 1 },
  coverImage:    { width: '100%', height: '100%' },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverFallbackText: { fontSize: 34, fontFamily: FONT.bold, color: theme.accentLight },
  yearsBadge:    { position: 'absolute', left: 7, bottom: 7, paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADIUS.pill, backgroundColor: 'rgba(10,10,11,0.78)' }, // theme-exempt: scrim over the cover photo
  yearsText:     { fontSize: 10, fontFamily: FONT.semibold, color: '#FAFAFA' }, // theme-exempt: text on the photo scrim
  saveOverlay:   { position: 'absolute', top: 7, right: 7, width: 28, height: 28, borderRadius: 14, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  topRow:        { marginBottom: SP.xs },
  nameCol:       { flex: 1 },
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: SP.xs, flexWrap: 'wrap' },
  name:          { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, flex: 1 },
  verifiedBadge: { width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  verifiedText:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.secondary },
  location:      { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  ratingRow:     { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ratingText:    { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.warning },
  reviewCount:   { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  specialties:   { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, marginBottom: SP.xs, minHeight: 28 },
  detailStack:   { minHeight: 36, marginBottom: SP.sm },
  stats:         { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.text, marginBottom: 3 },
  response:      { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  actionRow:     { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  iconAction:    { width: 32, height: 32, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  profileBtn:    { flex: 1, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: RADIUS.sm, borderWidth: 1 },
  profileBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.onAccent },
});

// ─── Filter Modal ─────────────────────────────────────────────────────────────

function FilterModal({ visible, filters, onApply, onClose }: {
  visible: boolean;
  filters: Filters;
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const fm = useMemo(() => makeFm(theme), [theme]);
  const [local, setLocal] = useState<Filters>(filters);
  const [facets, setFacets] = useState<DirectoryFacets | null>(null);
  const [facetError, setFacetError] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return;
    setLocal(filters);
    setFacetError(false);
    getDirectoryFacets().then(setFacets).catch(() => setFacetError(true));
  }, [visible]);

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
            <Feather name="x" size={ICON.md} color={theme.muted} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fm.scroll}>

          <Text style={fm.sectionLabel}>Sort by</Text>
          <View style={fm.chipRow}>
            {([['recommended', 'Recommended'], ['experience', 'Most experience'], ['rating', 'Top rated'], ['moq', 'Lowest MOQ'], ['newest', 'Newest']] as const).map(([val, label]) => (
              <FilterChip key={val} label={label} active={local.sort === val} onPress={() => set('sort', val)} />
            ))}
          </View>

          <Text style={fm.sectionLabel}>Country</Text>
          <View style={fm.chipRow}>
            {facets?.countries.length ? facets.countries.map(c => (
              <FilterChip key={c.name} label={c.name} count={c.count} active={local.country === c.name} onPress={() => toggle('country', c.name as any)} />
            )) : <Text style={fm.hint}>{facetError ? 'Countries could not be loaded.' : facets ? 'No manufacturers listed yet.' : 'Loading…'}</Text>}
          </View>

          <Text style={fm.sectionLabel}>Specialty</Text>
          <View style={fm.chipRow}>
            {facets?.specialties.length ? facets.specialties.map(c => (
              <FilterChip key={c.name} label={c.name} count={c.count} active={local.category === c.name} onPress={() => toggle('category', c.name as any)} />
            )) : <Text style={fm.hint}>{facetError ? 'Specialties could not be loaded.' : facets ? 'No manufacturers listed yet.' : 'Loading…'}</Text>}
          </View>

          <Text style={fm.sectionLabel}>Years in business</Text>
          <View style={fm.chipRow}>
            {[{ label: 'Any', val: undefined }, { label: '3+ years', val: 3 }, { label: '5+ years', val: 5 }, { label: '10+ years', val: 10 }, { label: '20+ years', val: 20 }].map(({ label, val }) => (
              <FilterChip key={label} label={label} active={local.minYears === val} onPress={() => set('minYears', val)} />
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
            <Text style={fm.switchLabel}>Has factory photos</Text>
            <Switch
              value={local.hasPhotos}
              onValueChange={v => set('hasPhotos', v)}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor={theme.onAccent}
            />
          </View>
          <View style={fm.switchRow}>
            <Text style={fm.switchLabel}>Verified only</Text>
            <Switch
              value={local.verifiedOnly}
              onValueChange={v => set('verifiedOnly', v)}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor={theme.onAccent}
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

const makeFm = (theme: AppThemePreset) => StyleSheet.create({
  root:        { flex: 1, backgroundColor: theme.surfaceGlass },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginTop: SP.sm },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.md },
  title:       { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  scroll:      { paddingHorizontal: SP.md, paddingBottom: SP.lg },
  sectionLabel:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.muted, marginTop: SP.md, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  switchRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.lg, paddingVertical: SP.sm },
  switchLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: theme.text },
  hint:        { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.subtle },
  footer:      { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: theme.border },
  resetBtn:    { flex: 1 },
  applyBtn:    { flex: 2 },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MY MANUFACTURERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function MyManufacturersTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const relCard = useMemo(() => makeRelCard(theme), [theme]);
  const [relationships, setRelationships] = useState<ManufacturerRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const rels = await getRelationships();
      const safeRels = (Array.isArray(rels) ? rels : []).filter((rel) => rel.manufacturer);
      setRelationships(safeRels);
      await completeSetupTaskWhen('connect_manufacturer', safeRels.length > 0);
    } catch (e) {
      if (!showManufacturerUpgrade(e, router)) setError(true);
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  const openThread = (rel: ManufacturerRelationship) => {
    const go = (threadId: string) => router.push((`/manufacturer-messages?threadId=${threadId}`) as never);
    if (rel.threadId) { go(rel.threadId); return; }
    getOrCreateConversation(rel.manufacturerId)
      .then((conv) => go(conv.id))
      .catch((e) => { if (!showManufacturerUpgrade(e, router)) Alert.alert('Message unavailable', 'Could not open a conversation. Please try again.'); });
  };

  if (loading && relationships.length === 0) {
    return <View style={s.skeletonList} testID="relationships-loading">{[0, 1, 2].map((item) => <View key={item} style={s.skeletonRow} />)}</View>;
  }

  if (error) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load your manufacturers"
        description="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }}
        style={s.emptyState}
      />
    );
  }

  if (relationships.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="Build your production network."
        description="Message a manufacturer from Discover, or invite one you already work with. They'll appear here with their orders and messages."
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
        const mfg = rel.manufacturer!;
        const counts = [
          rel.activeOrders ? `${rel.activeOrders} active ${rel.activeOrders === 1 ? 'order' : 'orders'}` : null,
          rel.awaitingPayment ? `${rel.awaitingPayment} awaiting payment` : null,
          !rel.activeOrders && rel.totalOrders ? `${rel.totalOrders} past ${rel.totalOrders === 1 ? 'order' : 'orders'}` : null,
        ].filter(Boolean).join(' · ') || 'No orders yet';
        return (
          <View style={relCard.root} testID={`relationship-${mfg.id}`}>
            <TouchableOpacity style={relCard.topRow} activeOpacity={0.8} onPress={() => router.push((`/manufacturer-profile?id=${mfg.id}`) as never)}>
              <View style={relCard.avatar}>
                {mfg.photo ? <Image source={{ uri: mfg.photo }} style={relCard.avatarImage} /> : <Text style={relCard.avatarText}>{mfg.businessName.charAt(0)}</Text>}
              </View>
              <View style={relCard.info}>
                <View style={relCard.nameRow}>
                  <Text style={relCard.name} numberOfLines={1}>{mfg.businessName}</Text>
                  {!mfg.isPublicDirectory && <StatusBadge label="Private" variant="neutral" small />}
                </View>
                <Text style={relCard.location}>{[mfg.city, mfg.country].filter(Boolean).join(', ')}{mfg.yearsInBusiness ? ` · ${mfg.yearsInBusiness} yrs` : ''}</Text>
                <Text style={[relCard.counts, rel.awaitingPayment ? { color: theme.warning } : null]}>{counts}</Text>
                {rel.lastMessagePreview && (
                  <Text style={relCard.lastMsg} numberOfLines={1}>
                    "{rel.lastMessagePreview}" · {timeAgo(rel.lastMessageAt)}
                  </Text>
                )}
              </View>
              {rel.unreadCount > 0 && (
                <View style={relCard.unread}><Text style={relCard.unreadText}>{rel.unreadCount > 9 ? '9+' : rel.unreadCount}</Text></View>
              )}
            </TouchableOpacity>
            <View style={relCard.divider} />
            <View style={relCard.actionRow}>
              <TouchableOpacity style={relCard.btn} onPress={() => openThread(rel)} testID={`relationship-message-${mfg.id}`}>
                <Feather name="message-circle" size={ICON.sm} color={theme.secondary} />
                <Text style={[relCard.btnText, { color: theme.secondary }]}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity style={relCard.btn} onPress={() => router.push((`/quote-request?manufacturerId=${mfg.id}`) as never)}>
                <Feather name="file-text" size={ICON.sm} color={theme.accentLight} />
                <Text style={[relCard.btnText, { color: theme.accentLight }]}>Quote</Text>
              </TouchableOpacity>
              <TouchableOpacity style={relCard.btn} onPress={() => router.push((`/manufacturer-profile?id=${mfg.id}`) as never)}>
                <Feather name="user" size={ICON.sm} color={theme.muted} />
                <Text style={relCard.btnText}>Profile</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
    />
  );
}

const makeRelCard = (theme: AppThemePreset) => StyleSheet.create({
  root:     { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:   { flexDirection: 'row', gap: SP.md },
  avatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  avatarText:{ fontSize: FS.md, fontFamily: FONT.bold, color: theme.accentLight },
  avatarImage:{ width: '100%', height: '100%' },
  unread:   { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, alignSelf: 'center' },
  unreadText:{ fontSize: 11, fontFamily: FONT.bold, color: theme.background },
  info:     { flex: 1 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.xs },
  name:     { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, flex: 1 },
  location: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  counts:   { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  lastMsg:  { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: 3 },
  divider:  { height: 1, backgroundColor: theme.border, marginVertical: SP.sm },
  actionRow:{ flexDirection: 'row', gap: SP.xs },
  btn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SP.sm, borderRadius: RADIUS.sm, backgroundColor: theme.cardElevated },
  btnText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUOTES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function QuotesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [manufacturerNames, setManufacturerNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
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
      setError(true);
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
        .catch(() => Alert.alert('Quote update failed', 'Could not accept this quote. Refresh and try again.')) },
    ]);
  };

  const handleDecline = (quote: Quote) => {
    Alert.alert('Decline Quote', 'Are you sure you want to decline this quote?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => declineQuote(quote.id).then(load)
        .catch(() => Alert.alert('Quote update failed', 'Could not decline this quote. Refresh and try again.')) },
    ]);
  };

  if (error) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load quotes"
        description="Check your connection and try again."
        action={{ label: 'Retry', onPress: () => { setLoading(true); load(); } }}
        style={s.emptyState}
      />
    );
  }

  // Group quotes by requestId for compare detection
  const quotesByRequest: Record<string, Quote[]> = {};
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
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
                onWithdraw={() => withdrawQuoteRequest(req.id).then(load).catch(() => Alert.alert('Quote update failed', 'Could not withdraw this request. Refresh and try again.'))}
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
  const fab = useMemo(() => makeFab(theme), [theme]);
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

const makeFab = (theme: AppThemePreset) => StyleSheet.create({
  root: { position: 'absolute', bottom: SP.lg, right: SP.md, borderRadius: RADIUS.pill, overflow: 'hidden', elevation: 8 },
  grad: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm + 2 },
  label:{ fontSize: FS.sm, fontFamily: FONT.bold, color: theme.onAccent },
});

function QuoteRequestCard({ req, manufacturerName, onView, onWithdraw }: { req: QuoteRequest; manufacturerName?: string; onView: () => void; onWithdraw: () => void }) {
  const { theme } = useAppTheme();
  const qc = useMemo(() => makeQc(theme), [theme]);
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
          <Text style={[qc.btnText, { color: theme.error }]}>Withdraw</Text>
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
  const { theme } = useAppTheme();
  const qc = useMemo(() => makeQc(theme), [theme]);
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
          <Text style={[qc.btnText, { color: theme.success }]}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[qc.btn, qc.dangerBtn]} onPress={onDecline}>
          <Text style={[qc.btnText, { color: theme.error }]}>Decline</Text>
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

const makeQc = (theme: AppThemePreset) => StyleSheet.create({
  root:       { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  productName:{ fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, flex: 1, marginRight: SP.sm },
  mfgName:    { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.xs },
  details:    { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text, marginBottom: SP.xs },
  date:       { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginBottom: SP.sm },
  actionRow:  { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  btn:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardElevated },
  dangerBtn:  { borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.08)' },
  successBtn: { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.08)' },
  btnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
});

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function SamplesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const smpCard = useMemo(() => makeSmpCard(theme), [theme]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const s = await getSamples();
      setSamples(s.filter(order => order.orderType !== 'bulk'));
    } catch (e) {
      setError(true);
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

  if (loading && samples.length === 0) return <View style={s.skeletonList}>{[0, 1].map((item) => <View key={item} style={s.skeletonRow} />)}</View>;
  if (error) {
    return (
      <EmptyState icon="wifi-off" title="Couldn't load samples" description="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }} style={s.emptyState} />
    );
  }
  if (samples.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="Your samples will appear here."
        description="Message a manufacturer about your design. When they send a sample card in chat, pay it there and track it here."
        action={{ label: 'Find a manufacturer', onPress: () => router.setParams({ tab: 'discover' } as never), icon: 'search' }}
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
              <TouchableOpacity style={smpCard.btn} onPress={() => router.push((`/production-detail?id=${item.id}`) as never)}>
                <Text style={smpCard.btnText}>{item.status === 'pending_payment' || item.status === 'awaiting_payment' ? 'Review & pay' : 'Track'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={smpCard.btn} onPress={() => router.push((`/sample-detail?id=${item.id}`) as never)}>
                <Text style={smpCard.btnText}>Details</Text>
              </TouchableOpacity>
              {canReview && (
                <>
                  <TouchableOpacity style={[smpCard.btn, smpCard.successBtn]} onPress={() => router.push((`/sample-detail?id=${item.id}&action=approve`) as never)}>
                    <Text style={[smpCard.btnText, { color: theme.success }]}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[smpCard.btn, smpCard.warnBtn]} onPress={() => router.push((`/sample-detail?id=${item.id}&action=revision`) as never)}>
                    <Text style={[smpCard.btnText, { color: theme.warning }]}>Revision</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );
      }}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
    />
  );
}

const makeSmpCard = (theme: AppThemePreset) => StyleSheet.create({
  root:       { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  productName:{ fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, flex: 1, marginRight: SP.sm },
  mfgName:    { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.xs },
  date:       { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginBottom: SP.xs },
  details:    { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text, marginBottom: SP.sm },
  actionRow:  { flexDirection: 'row', gap: SP.sm },
  btn:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardElevated },
  successBtn: { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.08)' },
  warnBtn:    { borderColor: 'rgba(249,115,22,0.3)', backgroundColor: 'rgba(249,115,22,0.08)' },
  btnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ProductionTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const rows = await getSellerOrders();
      setOrders(rows.filter((order) => order.orderType === 'bulk'));
    } catch (e) {
      if (!showManufacturerUpgrade(e, router)) setError(true);
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

  if (loading && orders.length === 0) return <View style={s.skeletonList} testID="production-loading">{[0, 1].map((item) => <View key={item} style={s.skeletonRow} />)}</View>;
  if (error) {
    return (
      <EmptyState icon="wifi-off" title="Couldn't load production orders" description="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }} style={s.emptyState} />
    );
  }
  if (orders.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="Bulk orders show up here."
        description="When a manufacturer sends you a bulk order card in chat and you pay it, you can follow every stage of production here."
        action={{ label: 'Open messages', onPress: () => router.setParams({ tab: 'messages' } as never), icon: 'message-circle' }}
        style={s.emptyState}
      />
    );
  }

  return (
    <FlatList
      data={orders}
      keyExtractor={item => item.id}
      renderItem={({ item: order }) => <OrderRowCard order={order} router={router} />}
      contentContainerStyle={s.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
    />
  );
}

/** Compact six-stage summary for a sample or bulk order. */
function OrderRowCard({ order, router }: { order: SellerOrderRow; router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const prodCard = useMemo(() => makeProdCard(theme), [theme]);
  const reached = stageIndex(order.status) + 1;
  const awaiting = order.status === 'pending_payment';
  return (
    <View style={prodCard.root} testID={`order-row-${order.id}`}>
      <TouchableOpacity activeOpacity={0.85} onPress={() => router.push((`/production-detail?id=${order.id}`) as never)} accessibilityRole="button" accessibilityLabel={`Open tracker for ${order.title}`}>
      <View style={prodCard.topRow}>
        <View style={prodCard.nameCol}>
          <Text style={prodCard.productName} numberOfLines={1}>{order.title}</Text>
          <Text style={prodCard.mfgLine}>{order.manufacturerName ?? 'Manufacturer'} · {order.quantity.toLocaleString('en-US')} pcs · {formatMoney(order.priceCents)}</Text>
        </View>
        <StatusBadge label={orderStatusLabel(order.status)} variant={awaiting ? 'warning' : order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'neutral' : 'info'} small />
      </View>
      {order.status !== 'cancelled' && (
        <View style={prodCard.segments}>
          {Array.from({ length: 6 }, (_, index) => <View key={index} style={[prodCard.segment, index < reached && prodCard.segmentDone]} />)}
        </View>
      )}
      <Text style={prodCard.stage}>{awaiting ? 'Pay the card to start production' : reached > 0 ? `Stage ${reached} of 6 · ${orderStatusLabel(order.status)}` : orderStatusLabel(order.status)}</Text>
      </TouchableOpacity>
      <View style={prodCard.actionRow}>
        <TouchableOpacity style={prodCard.btn} onPress={() => router.push((`/production-detail?id=${order.id}`) as never)}><Text style={prodCard.btnText}>{awaiting ? 'Review & pay' : 'Open tracker'}</Text></TouchableOpacity>
        {!!order.threadId && (
          <TouchableOpacity style={prodCard.btn} onPress={() => router.push((`/manufacturer-messages?threadId=${order.threadId}`) as never)}>
            <Text style={prodCard.btnText}>Message</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeProdCard = (theme: AppThemePreset) => StyleSheet.create({
  root:       { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginHorizontal: SP.md, marginBottom: SP.md, padding: SP.md },
  topRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP.sm },
  nameCol:    { flex: 1, marginRight: SP.sm },
  productName:{ fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  mfgLine:    { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  stage:      { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text, marginBottom: SP.xs },
  costs:      { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.sm },
  track:      { height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, overflow: 'hidden', marginBottom: SP.xs },
  fill:       { height: '100%', borderRadius: RADIUS.pill, backgroundColor: theme.accent },
  pct:        { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.accentLight, marginBottom: SP.sm },
  segments:   { flexDirection: 'row', gap: 4, marginBottom: SP.sm },
  segment:    { flex: 1, height: 5, borderRadius: 3, backgroundColor: theme.borderSubtle },
  segmentDone:{ backgroundColor: theme.text },
  actionRow:  { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  btn:        { paddingHorizontal: SP.sm, paddingVertical: 6, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardElevated },
  advanceBtn: { borderColor: theme.border, backgroundColor: theme.accentDim },
  btnText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
});

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function MessagesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const msgCard = useMemo(() => makeMsgCard(theme), [theme]);
  const [conversations, setConversations] = useState<ManufacturerConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const convs = await getConversations();
      setConversations(convs);
    } catch (e) {
      setError(true);
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

  if (loading) return <View style={s.centered}><ActivityIndicator color={theme.accent} /></View>;
  if (error) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Couldn't load messages"
        description="Check your connection and try again."
        action={{ label: 'Retry', onPress: () => { setLoading(true); load(); } }}
        style={s.emptyState}
      />
    );
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
    />
  );
}

const makeMsgCard = (theme: AppThemePreset) => StyleSheet.create({
  root:      { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginHorizontal: SP.md, marginBottom: SP.sm, padding: SP.md },
  avatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
  avatarText:{ fontSize: FS.md, fontFamily: FONT.bold, color: theme.accentLight },
  body:      { flex: 1 },
  topRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  name:      { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, flex: 1 },
  time:      { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginLeft: SP.sm },
  context:   { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.accentLight, marginBottom: 2 },
  preview:   { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  badge:     { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.onAccent },
});

// ─── Root styles ─────────────────────────────────────────────────────────────

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  flex:         { flex: 1 },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.headerH },
  headerTitle:  { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.3 },
  headerActions:{ flexDirection: 'row', gap: SP.sm },
  headerBtn:    { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  tabBarWrapper:{ borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.surfaceGlass },
  tabBarContent:{ paddingHorizontal: SP.md },
  tabItem:      { marginRight: SP.sm, alignItems: 'center' },
  tabInner:     { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingVertical: SP.sm, paddingHorizontal: SP.sm },
  tabLabel:     { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  tabLabelActive:{ color: theme.accentLight, fontFamily: FONT.semibold },
  tabUnderline: { height: 2, width: '100%', backgroundColor: theme.accent, borderRadius: RADIUS.pill },
  content:      { flex: 1 },
  listContent:  { paddingTop: SP.md, paddingBottom: SP.xxl + COMP.tabBarH },
  gridContent:  { paddingHorizontal: SP.md },
  gridRow:      { gap: SP.sm, alignItems: 'stretch' },
  sectionHeader:{ marginBottom: SP.xs },
  searchRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  searchToggle: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  searchInput:  { flex: 1, height: 36, backgroundColor: theme.card, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, paddingHorizontal: SP.md, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text },
  filterBtn:    { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  filterBtnActive:{ borderColor: theme.border, backgroundColor: theme.accentDim },
  filterCount:  { position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: theme.text, color: theme.background, fontSize: 10, fontFamily: FONT.bold, textAlign: 'center', lineHeight: 16, overflow: 'hidden' },
  resultCount:  { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, paddingHorizontal: SP.md, marginBottom: SP.sm },
  skeletonList: { padding: SP.md, gap: SP.md },
  skeletonRow:  { height: 132, borderRadius: RADIUS.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, paddingHorizontal: SP.md },
  skeletonTile: { width: '48%', height: 260, borderRadius: RADIUS.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  discoverModeRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  inlineError: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.sm, padding: SP.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.warning, backgroundColor: `${theme.warning}1F` },
  inlineErrorText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.warning },
  emptyState:   { flex: 1, justifyContent: 'center' },
});

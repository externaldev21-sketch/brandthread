/**
 * Manufacturer Hub — landing + the Quotes / Samples / Orders / Messages
 * sections.
 *
 * The landing is deliberately short: two actions at the top ("Find a
 * manufacturer" → the category picker in app/manufacturer-find.tsx, "Invite
 * your factory" → the unchanged invite flow), a compact row into the four
 * existing sections, then one plain list of the manufacturers this seller
 * already works with (lib/manufacturerHubSummary.ts). The old five-tab
 * strip clipped at 390pt and crowded everything onto one screen.
 *
 * `?tab=quotes|samples|production|messages` opens that section as its own
 * pushed screen, so existing deep links (profile "Inbox", order screens)
 * keep working; the section components below are unchanged.
 */

import React, { useState, useCallback, useMemo } from 'react';

import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

import { View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl, Pressable } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

import { Button } from '@/components/ui/Button';

import { ListRow } from '@/components/ui/ListRow';

import { RetryRow } from '@/components/ui/RetryRow';

import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { haptic } from '@/lib/haptics';

import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';

import { useFocusedInterval } from '@/hooks/useFocusedInterval';

import { GROWTH_PLAN_ENFORCEMENT_ENABLED } from '@/lib/growthTools';

import { LinearGradient } from 'expo-linear-gradient';

import { getEntitlementRejection } from '@/lib/entitlementError';

import { leaveSetupFlow } from '@/lib/setupNavigation';

import { goBackOr } from '@/lib/navigation/goBackOr';

import { isSellerDevPreview } from '@/lib/devPreview';

import { completeSetupTaskWhen } from '@/lib/setupCompletion';

import { buildMyManufacturers, type MyManufacturerRow } from '@/lib/manufacturerHubSummary';

import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';

import { ListSkeleton } from '@/components/layout';

import { ScreenHeader } from '@/components/ScreenHeader';

import { StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';

import { getRelationships, getManufacturersByIds, getQuoteRequests, getQuotes, acceptQuote, declineQuote, withdrawQuoteRequest, getSamples, getProductionOrders, getConversations } from '@/services/manufacturerService';

import { getSellerOrders, type SellerOrderRow } from '@/services/manufacturerOrderFlow';

import { formatMoney, orderStatusLabel, stageIndex } from '@workspace/manufacturer-flow';

import { ManufacturerConversation, QuoteRequest, Quote, Sample, ProductionOrder } from '@/services/manufacturerTypes';

import { formatCents } from '@/lib/money';

import { fmtRelativeDay } from '@/lib/format';

// ─── Sections ─────────────────────────────────────────────────────────────────

type Section = 'quotes' | 'samples' | 'production' | 'messages';

const SECTIONS: { key: Section; label: string; icon: IconName }[] = [
  { key: 'quotes',     label: 'Quotes',   icon: 'file-text' },
  { key: 'samples',    label: 'Samples',  icon: 'package' },
  { key: 'production', label: 'Orders',   icon: 'layers' },
  { key: 'messages',   label: 'Messages', icon: 'message-circle' },
];

const isSection = (value: unknown): value is Section => SECTIONS.some((item) => item.key === value);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Raw enum -> sentence-case badge label, e.g. 'awaiting_payment' -> 'Awaiting payment'. */
function statusLabel(status: string): string {
  const text = status.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  return fmtRelativeDay(iso);
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

/**
 * "Send to manufacturer" on a product opens the hub with ?productId=…. Every
 * quote request started from the hub then carries that product, so the
 * seller doesn't have to find it again (quote-request already reads it).
 */
function useQuoteRequestHref() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  return (manufacturerId?: string) => {
    const params = new URLSearchParams();
    if (manufacturerId) params.set('manufacturerId', manufacturerId);
    if (productId) params.set('productId', productId);
    const qs = params.toString();
    return (qs ? `/quote-request?${qs}` : '/quote-request') as never;
  };
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
  const { tab, from } = useLocalSearchParams<{ tab?: string; from?: string }>();
  // Old links may still say ?tab=discover or ?tab=my_manufacturers; both
  // now live on the landing itself.
  const section = isSection(tab) ? tab : null;

  function leaveSetupDestination() {
    // Pop to the exact screen underneath (dashboard / setup checklist / tab);
    // only a cold deep link with no history falls back to the `from` origin.
    leaveSetupFlow(router, from);
  }

  const { hasPlan, loading: planLoading, error: planError } = useSubscriptionPlan();
  const [upsellVisible, setUpsellVisible] = useState(false);
  // The demo opens the browse-only manufacturer UI without fabricating a
  // paid entitlement. All mutation/payment APIs remain blocked by the preview
  // network policy.
  const hasGrowthAccess = isSellerDevPreview() || !GROWTH_PLAN_ENFORCEMENT_ENABLED || hasPlan('growth');

  // Native modals use a global portal, so the gate must follow route focus.
  useFocusEffect(
    useCallback(() => {
      if (!isSellerDevPreview() && !planLoading && !planError && !hasGrowthAccess) {
        setUpsellVisible(true);
      }
      return () => setUpsellVisible(false);
    }, [hasGrowthAccess, planError, planLoading]),
  );

  const sectionLabel = SECTIONS.find((item) => item.key === section)?.label;

  return (
    <View style={s.root}>
      {section ? (
        <ScreenHeader title={sectionLabel ?? 'Manufacturer Hub'} onBack={() => goBackOr(router, '/manufacturer-hub')} />
      ) : (
        <ScreenHeader title="Manufacturer Hub" onBack={leaveSetupDestination} />
      )}

      <View style={s.content}>
        {section === 'quotes'     && <QuotesTab router={router} />}
        {section === 'samples'    && <SamplesTab router={router} />}
        {section === 'production' && <ProductionTab router={router} />}
        {section === 'messages'   && <MessagesTab router={router} />}
        {!section && <HubLanding router={router} />}
      </View>

      {/* Plan upsell — shown immediately for Starter sellers */}
      <PlanUpsellModal
        visible={upsellVisible}
        featureName="Manufacturer Hub"
        requiredPlan="growth"
        onClose={() => {
          setUpsellVisible(false);
          if (section) goBackOr(router, '/manufacturer-hub');
          else leaveSetupDestination();
        }}
        onUpgrade={() => {
          setUpsellVisible(false);
          router.push('/subscription' as never);
        }}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANDING
// ═══════════════════════════════════════════════════════════════════════════════

function HubLanding({ router }: { router: ReturnType<typeof useRouter> }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  // "Send to manufacturer" on a product opens the hub with ?productId=…;
  // the find flow carries it through to the quote request.
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const [rows, setRows] = useState<MyManufacturerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      // The signed-out preview has relationships (demo fixtures) but no
      // threads, quotes, samples or orders to fold in.
      if (isSellerDevPreview()) {
        setRows(buildMyManufacturers({ relationships: await getRelationships() }));
        setError(false);
        return;
      }
      // allSettled: one slow or failing source shouldn't hide the others.
      const [relationships, conversations, quoteRequests, quotes, samples, orders] = await Promise.allSettled([
        getRelationships(), getConversations(), getQuoteRequests(), getQuotes(), getSamples(), getProductionOrders(),
      ]);
      const value = <T,>(result: PromiseSettledResult<T[]>): T[] => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []);
      const settled = [relationships, conversations, quoteRequests, quotes, samples, orders];
      if (settled.every((result) => result.status === 'rejected')) {
        const reason = (relationships as PromiseRejectedResult).reason;
        if (!showManufacturerUpgrade(reason, router)) setError(true);
        return;
      }
      const sources = {
        relationships: value(relationships), conversations: value(conversations), quoteRequests: value(quoteRequests),
        quotes: value(quotes), samples: value(samples), orders: value(orders),
      };
      // Quotes carry only an id; look up the names the other sources lack.
      const named = new Set([
        ...sources.relationships.filter((rel) => rel.manufacturer).map((rel) => rel.manufacturerId),
        ...sources.conversations.map((conv) => conv.manufacturerId),
      ]);
      const unnamed = [...sources.quoteRequests, ...sources.quotes, ...sources.samples]
        .map((item) => item.manufacturerId).filter((id) => id && !named.has(id));
      const profiles = unnamed.length ? await getManufacturersByIds(unnamed).catch(() => []) : [];
      setRows(buildMyManufacturers({ ...sources, profiles }));
      setError(false);
      await completeSetupTaskWhen('connect_manufacturer', sources.relationships.length > 0);
    } catch (e) {
      if (!showManufacturerUpgrade(e, router)) setError(true);
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const findHref = (productId ? `/manufacturer-find?productId=${encodeURIComponent(productId)}` : '/manufacturer-find') as never;
  const openSection = (key: Section) => {
    haptic('select');
    router.push((`/manufacturer-hub?tab=${key}`) as never);
  };

  return (
    <ScrollView
      contentContainerStyle={s.landingContent}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
    >
      <View style={s.ctaStack}>
        <Button label="Find a manufacturer" icon="search" fullWidth onPress={() => router.push(findHref)} testID="button-find-manufacturer" />
        <Button label="Invite your factory" icon="user-plus" variant="secondary" fullWidth onPress={() => router.push('/invite-manufacturer' as never)} testID="button-invite-factory" />
      </View>

      {/* The four existing sections, one tap each — not a scrolling tab strip. */}
      <View style={s.sectionRow}>
        {SECTIONS.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [s.sectionTile, pressed && s.sectionTilePressed]}
            onPress={() => openSection(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            testID={`hub-section-${item.key}`}
          >
            <Icon name={item.icon} size={ICON.sm} color={theme.text} />
            <Text style={s.sectionTileLabel} numberOfLines={1}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <SectionHeader title="Your manufacturers" style={s.listHeader} />
      {loading ? (
        <View testID="my-manufacturers-loading"><ListSkeleton rows={3} /></View>
      ) : error ? (
        <RetryRow label="Couldn't load your manufacturers" onRetry={() => { setLoading(true); load(); }} testID="my-manufacturers-retry" />
      ) : rows.length === 0 ? (
        <View style={s.landingEmpty} testID="my-manufacturers-empty">
          <Text style={s.landingEmptyText}>Factories you message, quote or order from will show up here.</Text>
          <Button label="Find a manufacturer" variant="secondary" size="small" onPress={() => router.push(findHref)} />
        </View>
      ) : (
        <View testID="my-manufacturers-list">
          {rows.map((row, index) => (
            <ListRow
              key={row.manufacturerId}
              avatar={{ uri: row.photo, name: row.name }}
              title={row.name}
              titleNumberOfLines={1}
              subtitle={row.statusLine}
              subtitleNumberOfLines={1}
              chevron
              divider={index < rows.length - 1}
              style={s.manufacturerRow}
              onPress={() => router.push((`/manufacturer-profile?id=${row.manufacturerId}`) as never)}
              testID={`my-manufacturer-${row.manufacturerId}`}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUOTES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function QuotesTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const quoteHref = useQuoteRequestHref();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [manufacturerNames, setManufacturerNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (isSellerDevPreview()) { setError(false); setQuoteRequests([]); setQuotes([]); setManufacturerNames({}); setLoading(false); setRefreshing(false); return; }
    try {
      setError(false);
      const [reqs, qs] = await Promise.all([getQuoteRequests(), getQuotes()]);
      setQuoteRequests((Array.isArray(reqs) ? reqs : []).filter(r => r.status !== 'accepted'));
      setQuotes(Array.isArray(qs) ? qs : []);
      const profiles = await getManufacturersByIds([...reqs, ...qs].map(item => item.manufacturerId));
      setManufacturerNames(Object.fromEntries(profiles.map(profile => [profile.id, profile.name])));
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
    Alert.alert('Accept quote?', `Accept this quote for ${formatCents(quote.unitPriceCents)}/unit?`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Accept quote', onPress: () => acceptQuote(quote.id).then(load)
        .catch(() => Alert.alert("Couldn't accept quote", 'Refresh and try again.')) },
    ]);
  };

  const handleDecline = (quote: Quote) => {
    Alert.alert('Decline quote?', 'Are you sure you want to decline this quote?', [
      { text: 'Keep quote', style: 'cancel' },
      { text: 'Decline quote', style: 'destructive', onPress: () => declineQuote(quote.id).then(load)
        .catch(() => Alert.alert("Couldn't decline quote", 'Refresh and try again.')) },
    ]);
  };

  if (error) {
    return (
      <EmptyState
        icon="alert-circle"
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

  if (loading && quoteRequests.length === 0 && quotes.length === 0) {
    return <View style={s.skeletonList} testID="quotes-loading">{[0, 1].map((item) => <View key={item} style={s.skeletonRow} />)}</View>;
  }

  if (quoteRequests.length === 0 && quotes.length === 0) {
    return (
      <View style={s.flex}>
        <EmptyState
          icon="file-text"
          title="Request your first production quote"
          description="Send quote requests to manufacturers and compare their offers."
          action={{ label: 'Request a quote', onPress: () => router.push(quoteHref()), icon: 'plus' }}
          style={s.emptyState}
        />
      </View>
    );
  }

  const handleWithdraw = (req: QuoteRequest) => {
    Alert.alert('Withdraw this request?', 'The manufacturer will be notified.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => withdrawQuoteRequest(req.id).then(load)
        .catch(() => Alert.alert('Quote update failed', 'Could not withdraw this request. Refresh and try again.')) },
    ]);
  };

  return (
    <View style={s.flex}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
      >
        {quoteRequests.length > 0 && (
          <>
            <SectionHeader title="Quote requests" style={s.sectionHeader} />
            {quoteRequests.map(req => (
              <QuoteRequestCard
                key={req.id}
                req={req}
                manufacturerName={manufacturerNames[req.manufacturerId]}
                onView={() => router.push((`/quote-detail?quoteId=${req.id}`) as never)}
                onWithdraw={() => withdrawQuoteRequest(req.id).then(load).catch(() => Alert.alert("Couldn't withdraw request", 'Refresh and try again.'))}
              />
            ))}
          </>
        )}
        {quotes.length > 0 && (
          <>
            <SectionHeader title="Quotes received" style={s.sectionHeader} />
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
  const quoteHref = useQuoteRequestHref();
  const { theme } = useAppTheme();
  const fab = useMemo(() => makeFab(theme), [theme]);
  return (
    <TouchableOpacity
      style={fab.root}
      onPress={() => router.push(quoteHref())}
      activeOpacity={0.85}
    >
      <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={fab.grad}>
        <Icon name="plus" size={ICON.md} color={theme.onAccent} />
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
        <StatusBadge label={statusLabel(req.status)} variant={quoteRequestStatusVariant(req.status)} small />
      </View>
      {!!manufacturerName && <Text style={qc.mfgName}>{manufacturerName}</Text>}
      <Text style={qc.details}>Qty: {req.quantity}{req.targetUnitPriceCents ? ` · Target: ${formatCents(req.targetUnitPriceCents)}/unit` : ''}</Text>
      {req.submittedAt && <Text style={qc.date}>Submitted: {fmtDate(req.submittedAt)}</Text>}
      <View style={qc.actionRow}>
        <Button label="View" variant="secondary" size="compact" onPress={onView} />
        <Button label="Withdraw" variant="destructive" size="compact" onPress={onWithdraw} />
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
        <Button label="Accept" variant="primary" size="compact" onPress={onAccept} />
        <Button label="Decline" variant="destructive" size="compact" onPress={onDecline} />
        <Button label="Counter" variant="secondary" size="compact" onPress={onCounter} />
        {canCompare && (
          <Button label="Compare" variant="secondary" size="compact" onPress={onCompare} />
        )}
        <Button label="Details" variant="secondary" size="compact" onPress={onDetails} />
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
    if (isSellerDevPreview()) { setError(false); setSamples([]); setLoading(false); setRefreshing(false); return; }
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
  useFocusedInterval(load, 15_000, !isSellerDevPreview());

  if (loading && samples.length === 0) return <View style={s.skeletonList}>{[0, 1].map((item) => <View key={item} style={s.skeletonRow} />)}</View>;
  if (error) {
    return (
      <EmptyState icon="alert-circle" title="Couldn't load samples" description="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }} style={s.emptyState} />
    );
  }
  if (samples.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="Your samples will appear here"
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
              <StatusBadge label={statusLabel(item.status)} variant={sampleStatusVariant(item.status)} small />
            </View>
            {!!item.manufacturerName && <Text style={smpCard.mfgName}>{item.manufacturerName}</Text>}
            {item.estimatedCompletionDate && (
              <Text style={smpCard.date}>Est: {fmtDate(item.estimatedCompletionDate)}</Text>
            )}
            <Text style={smpCard.details}>Type: {item.type.replace(/_/g, ' ')} · Cost: {formatCents(item.costCents)}</Text>
            <View style={smpCard.actionRow}>
              <Button
                label={item.status === 'pending_payment' || item.status === 'awaiting_payment' ? 'Review & pay' : 'Track'}
                variant="secondary"
                size="compact"
                onPress={() => router.push((`/production-detail?id=${item.id}`) as never)}
              />
              <Button label="Details" variant="secondary" size="compact" onPress={() => router.push((`/sample-detail?id=${item.id}`) as never)} />
              {canReview && (
                <>
                  <Button label="Approve" variant="primary" size="compact" onPress={() => router.push((`/sample-detail?id=${item.id}&action=approve`) as never)} />
                  <Button label="Revision" variant="secondary" size="compact" onPress={() => router.push((`/sample-detail?id=${item.id}&action=revision`) as never)} />
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
    if (isSellerDevPreview()) { setError(false); setOrders([]); setLoading(false); setRefreshing(false); return; }
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
  useFocusedInterval(load, 15_000, !isSellerDevPreview());

  if (loading && orders.length === 0) return <View style={s.skeletonList} testID="production-loading">{[0, 1].map((item) => <View key={item} style={s.skeletonRow} />)}</View>;
  if (error) {
    return (
      <EmptyState icon="alert-circle" title="Couldn't load production orders" description="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }} style={s.emptyState} />
    );
  }
  if (orders.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="Bulk orders show up here"
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
        <Button label={awaiting ? 'Review & pay' : 'Open tracker'} variant="secondary" size="compact" onPress={() => router.push((`/production-detail?id=${order.id}`) as never)} />
        {!!order.threadId && (
          <Button label="Message" variant="secondary" size="compact" onPress={() => router.push((`/manufacturer-messages?threadId=${order.threadId}`) as never)} />
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
  segmentDone:{ backgroundColor: theme.accent },
  actionRow:  { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
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
  useFocusedInterval(load, 10_000, !isSellerDevPreview());

  if (loading) return <View style={{ padding: SP.md }}><ListSkeleton rows={6} /></View>;
  if (error) {
    return (
      <EmptyState
        icon="alert-circle"
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
        title="Manufacturer conversations will appear here"
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
  avatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
  content:      { flex: 1 },
  listContent:  { paddingTop: SP.md, paddingBottom: SP.xxl + COMP.tabBarH },
  sectionHeader:{ marginBottom: SP.xs },
  skeletonList: { padding: SP.md, gap: SP.md },
  skeletonRow:  { height: 132, borderRadius: RADIUS.lg, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  // paddingBottom keeps the description/action clear of the seller tab bar
  // (COMP.tabBarH) even when flex-centering pushes content toward the
  // bottom of a taller viewport — this was previously running text under
  // the bar on several of these tabs' error states.
  emptyState:   { flex: 1, justifyContent: 'center', paddingBottom: COMP.tabBarH + SP.lg },

  // Landing — one 16pt gutter, generous vertical rhythm, no cards.
  landingContent: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.xxl + COMP.tabBarH },
  ctaStack:     { gap: SP.sm },
  sectionRow:   { flexDirection: 'row', gap: SP.sm, marginTop: SP.lg },
  sectionTile:  { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: SP.xs, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card },
  sectionTilePressed: { backgroundColor: theme.cardElevated },
  sectionTileLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.text },
  listHeader:   { marginTop: SP.xl, marginBottom: SP.xs },
  manufacturerRow: { minHeight: 64 },
  landingEmpty: { alignItems: 'flex-start', gap: SP.md, paddingVertical: SP.md },
  landingEmptyText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 20 },
});

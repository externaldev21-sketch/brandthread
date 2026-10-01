/**
 * AI credits — balance, monthly allowance, credit packs and usage history.
 *
 * Layout follows two Mobbin references, reskinned to black/white/silver:
 *  - Photoroom "Space usage": one card of label / value rows with hairline
 *    dividers and a renewal date under the usage list
 *    (https://mobbin.com/screens/1e1b9135-afc7-4935-a8fd-b2b576b385e8)
 *  - Picsart "Why is AI Avatar paid?": radio pack list with a "Most popular"
 *    tag, one confirm button and a one-time-payment footnote
 *    (https://mobbin.com/screens/9b7a44cd-3327-4f30-9a2c-cdbbc48259b9)
 *
 * Credits belong to the seller plan: Starter and Growth see their balance,
 * rollover and packs; Pro is unlimited and sees only that; accounts without a
 * plan see a path to the plans. Purchases: iOS/Android buy a store consumable
 * through RevenueCat (credited by RevenueCat's webhook); web uses Stripe
 * Checkout. A path that is not configured simply hides the pack section.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { BrandthreadScreen } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { SkeletonBlock } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { tabularType, TABULAR_NUMS } from '@/constants/typography';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isPreviewDemoMode, isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { useRevenueCat } from '@/lib/revenueCat';
import { invalidateAiCredits } from '@/hooks/useAiCredits';
import {
  STORE_PRODUCT_FOR_PACK, buildCreditsReturnUrl, entryLabel, formatDelta, formatPackPrice, formatResetDate,
  type AiCreditEntry, type AiCreditsOverview,
} from '@/lib/aiCredits';

const POPULAR_PACK_ID = 'credits_1500';
const DEMO_TOOLS = [
  { tool: 'logo', label: 'Logo', cost: 5 },
  { tool: 'photoshoot', label: 'AI photoshoot', cost: 8 },
  { tool: 'bg_remove', label: 'Remove background', cost: 2 },
];
const DEMO_PACKS = [
  { id: 'credits_500', credits: 500, amountCents: 599, label: '500 credits' },
  { id: 'credits_1500', credits: 1500, amountCents: 1499, label: '1,500 credits' },
  { id: 'credits_5000', credits: 5000, amountCents: 4499, label: '5,000 credits' },
];
const nextReset = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)).toISOString();

// Shown only under the explicit `&demo=1` web preview; never to a real account.
function demoOverview(kind: string | undefined): AiCreditsOverview {
  const base = { resetsAt: nextReset(), purchase: { stripe: true } };
  if (kind === 'pro') {
    return { ...base, plan: 'pro', unlimited: true, balance: null, monthlyBalance: null, rolloverBalance: null, purchasedBalance: null,
      monthlyAllowance: null, lowCreditsThreshold: null, isLow: false, packs: [], tools: DEMO_TOOLS.map(({ tool, label }) => ({ tool, label })) };
  }
  if (kind === 'none') {
    return { ...base, plan: 'free', unlimited: false, balance: 0, monthlyBalance: 0, rolloverBalance: 0, purchasedBalance: 0,
      monthlyAllowance: 0, lowCreditsThreshold: 0, isLow: true, packs: [], tools: DEMO_TOOLS };
  }
  return { ...base, plan: 'growth', unlimited: false, balance: 2964, monthlyBalance: 1964, rolloverBalance: 800, purchasedBalance: 200,
    monthlyAllowance: 4000, lowCreditsThreshold: 800, isLow: false, packs: DEMO_PACKS, tools: DEMO_TOOLS };
}
const DEMO_HISTORY: AiCreditEntry[] = [
  { id: 'd1', kind: 'debit', delta: -8, toolKey: 'photoshoot', balanceAfter: 2964, createdAt: new Date(Date.now() - 36e5).toISOString() },
  { id: 'd2', kind: 'debit', delta: -5, toolKey: 'logo', balanceAfter: 2972, createdAt: new Date(Date.now() - 5 * 36e5).toISOString() },
  { id: 'd3', kind: 'pack_purchase', delta: 500, toolKey: null, balanceAfter: 2977, createdAt: new Date(Date.now() - 864e5).toISOString() },
  { id: 'd4', kind: 'debit', delta: -2, toolKey: 'bg_remove', balanceAfter: 2477, createdAt: new Date(Date.now() - 2 * 864e5).toISOString() },
  { id: 'd5', kind: 'rollover', delta: 800, toolKey: null, balanceAfter: 2479, createdAt: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'd6', kind: 'monthly_grant', delta: 4000, toolKey: null, balanceAfter: 2479, createdAt: new Date(Date.now() - 3 * 864e5).toISOString() },
];

export default function AiCreditsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const { isSignedIn } = useAuth();
  const rc = useRevenueCat();
  const params = useLocalSearchParams<{ paymentReturn?: string; checkout_session_id?: string; demoPlan?: string }>();

  const demo = isPreviewDemoMode() && (isBuyerDevPreview() || isSellerDevPreview());
  const live = !!isSignedIn;

  const [overview, setOverview] = useState<AiCreditsOverview | null>(null);
  const [entries, setEntries] = useState<AiCreditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string>(POPULAR_PACK_ID);
  const [buying, setBuying] = useState(false);
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const returnHandled = useRef(false);

  const load = useCallback(async () => {
    if (demo) {
      setOverview(demoOverview(params.demoPlan)); setEntries(params.demoPlan === 'pro' ? [] : DEMO_HISTORY); setCursor(null); setLoading(false);
      return;
    }
    if (!live) { setLoading(false); return; }
    setLoadError(false);
    try {
      const [o, h] = await Promise.all([api.aiCredits.get(), api.aiCredits.history(30)]);
      setOverview(o); setEntries(h.entries); setCursor(h.nextCursor);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api, demo, live, params.demoPlan]);

  useEffect(() => { void load(); }, [load]);

  const native = Platform.OS !== 'web';
  const canBuy = !!overview && overview.packs.length > 0 && (native ? rc.available : overview.purchase.stripe);

  // Store prices (native) so the list shows what the store will charge.
  const productIds = useMemo(() => overview?.packs.map((p) => STORE_PRODUCT_FOR_PACK[p.id]).filter(Boolean) as string[] | undefined, [overview]);
  useEffect(() => {
    if (!native || !rc.available || !productIds?.length || !live) return;
    let active = true;
    rc.creditPackPrices(productIds).then((p) => { if (active) setStorePrices(p); }).catch(() => {});
    return () => { active = false; };
  }, [native, rc, productIds, live]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || demo) return;
    setLoadingMore(true);
    try {
      const h = await api.aiCredits.history(30, cursor);
      setEntries((prev) => [...prev, ...h.entries]);
      setCursor(h.nextCursor);
    } catch { /* the list keeps what it has; the button stays for another try */ }
    finally { setLoadingMore(false); }
  }, [api, cursor, demo, loadingMore]);

  const verify = useCallback(async (sessionId: string) => {
    try {
      await api.aiCredits.verify(sessionId);
      invalidateAiCredits();
      await load();
    } catch {
      Alert.alert('Payment not confirmed', 'We could not confirm your payment yet. If you were charged, your credits will appear shortly.');
    }
  }, [api, load]);

  // Stripe return on web (full-page redirect back to /ai-credits?paymentReturn=1&checkout_session_id=...).
  useEffect(() => {
    if (params.paymentReturn !== '1' || returnHandled.current || !live) return;
    const id = typeof params.checkout_session_id === 'string' ? params.checkout_session_id : null;
    returnHandled.current = true;
    router.setParams({ paymentReturn: undefined, checkout_session_id: undefined } as never);
    if (id) void verify(id);
  }, [params.paymentReturn, params.checkout_session_id, live, router, verify]);

  async function buy() {
    const pack = overview?.packs.find((p) => p.id === selected);
    if (!pack || buying || demo) return;
    setBuying(true);
    try {
      if (native) {
        const before = overview?.balance ?? 0;
        await rc.purchaseCreditPack(STORE_PRODUCT_FOR_PACK[pack.id]!);
        // RevenueCat's webhook credits the pack; poll briefly for it to land.
        for (let i = 0; i < 8; i += 1) {
          await new Promise((r) => setTimeout(r, 1500));
          const o = await api.aiCredits.get();
          if ((o.balance ?? 0) > before) break;
        }
        invalidateAiCredits();
        await load();
        return;
      }
      const returnUrl = buildCreditsReturnUrl(window.location.origin);
      const { url } = await api.aiCredits.checkout(pack.id, returnUrl);
      if (!url) throw new Error('no url');
      window.location.assign(url);
    } catch (e: any) {
      const cancelled = e?.userCancelled === true || /cancel/i.test(String(e?.message ?? ''));
      if (!cancelled) Alert.alert('Purchase failed', 'Could not complete the purchase. Please try again.');
    } finally {
      setBuying(false);
    }
  }

  const tools = overview?.tools ?? [];

  return (
    <BrandthreadScreen scrollable noSafeTop>
      <ScreenHeader title="AI credits" onBack={() => goBackOr(router)} />
      {loading ? (
        <View style={styles.body}>
          <SkeletonBlock width={120} height={14} style={{ marginTop: SP.md }} />
          <SkeletonBlock width={180} height={48} style={{ marginTop: SP.sm }} />
          <SkeletonBlock width="100%" height={150} radius={RADIUS.lg} style={{ marginTop: SP.lg }} />
        </View>
      ) : !overview ? (
        <View style={styles.body}>
          {loadError
            ? <RetryRow label="Couldn't load your credits" onRetry={() => { setLoading(true); void load(); }} />
            : <Text style={styles.muted}>Sign in to see your AI credits.</Text>}
        </View>
      ) : (
        <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
          {overview.unlimited ? (
            <>
              <Text style={styles.balanceLabel}>AI generation</Text>
              <Text style={[styles.balance, tabularType('display')]} testID="ai-credits-unlimited">Unlimited</Text>
            </>
          ) : (
            <>
              <Text style={styles.balanceLabel}>Available credits</Text>
              <Text style={[styles.balance, tabularType('display')]} testID="ai-credits-balance">
                {(overview.balance ?? 0).toLocaleString('en-US')}
              </Text>
              {overview.monthlyAllowance || (overview.purchasedBalance ?? 0) > 0 || overview.packs.length > 0 ? (
              <View style={styles.card}>
                {overview.monthlyAllowance ? (
                  <Row styles={styles} label="Monthly credits" value={`${(overview.monthlyBalance ?? 0).toLocaleString('en-US')} of ${overview.monthlyAllowance.toLocaleString('en-US')}`} />
                ) : null}
                {overview.monthlyAllowance ? (
                  <Row styles={styles} label="Rolled over" value={(overview.rolloverBalance ?? 0).toLocaleString('en-US')} />
                ) : null}
                {(overview.purchasedBalance ?? 0) > 0 || overview.packs.length > 0 ? (
                  <Row styles={styles} label="Purchased credits" value={(overview.purchasedBalance ?? 0).toLocaleString('en-US')} last={!overview.monthlyAllowance} />
                ) : null}
                {overview.monthlyAllowance ? (
                  <Row styles={styles} label="Monthly credits reset" value={formatResetDate(overview.resetsAt)} last />
                ) : null}
              </View>
              ) : null}
              {!overview.monthlyAllowance && overview.packs.length === 0 ? (
                <View style={{ marginTop: SP.lg }}>
                  <Button label="See plans" onPress={() => router.push('/plans' as never)} fullWidth />
                </View>
              ) : null}
            </>
          )}

          {canBuy ? (
            <>
              <Text style={styles.sectionTitle}>Get more credits</Text>
              {overview.packs.map((pack) => {
                const on = pack.id === selected;
                const price = (native && storePrices[STORE_PRODUCT_FOR_PACK[pack.id] ?? '']) || formatPackPrice(pack.amountCents);
                return (
                  <Pressable
                    key={pack.id}
                    onPress={() => setSelected(pack.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${pack.label}, ${price}`}
                    style={[styles.pack, on && styles.packOn]}
                  >
                    {pack.id === POPULAR_PACK_ID ? (
                      <View style={styles.popular}><Text style={styles.popularText}>Most popular</Text></View>
                    ) : null}
                    <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                    <Text style={styles.packTitle}>{pack.label}</Text>
                    <Text style={[styles.packPrice, TABULAR_NUMS]}>{price}</Text>
                  </Pressable>
                );
              })}
              <View style={{ marginTop: SP.sm }}>
                <Button label="Confirm purchase" onPress={() => void buy()} loading={buying} fullWidth />
              </View>
              <Text style={styles.footnote}>One-time payment. No subscription.</Text>
            </>
          ) : null}

          {overview.unlimited ? null : <Text style={styles.sectionTitle}>History</Text>}
          {overview.unlimited ? null : entries.length === 0 ? (
            <Text style={styles.muted}>No activity yet.</Text>
          ) : (
            <View>
              {entries.map((entry, i) => (
                <View key={entry.id} style={[styles.historyRow, i < entries.length - 1 && styles.historyDivider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyLabel} numberOfLines={1}>{entryLabel(entry, tools)}</Text>
                    <Text style={styles.historyDate} numberOfLines={1}>
                      {new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' · '}
                      {new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Text style={[styles.historyDelta, TABULAR_NUMS, entry.delta > 0 && { color: theme.text }]}>{formatDelta(entry.delta)}</Text>
                </View>
              ))}
              {cursor ? (
                <Pressable onPress={() => void loadMore()} style={styles.more} accessibilityRole="button" accessibilityLabel="Load more history">
                  {loadingMore ? <ActivityIndicator color={theme.text} /> : <Text style={styles.moreText}>Load more</Text>}
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      )}
    </BrandthreadScreen>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Row({ styles, label, value, last }: { styles: Styles; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, TABULAR_NUMS]}>{value}</Text>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  body: { paddingHorizontal: SP.md },
  muted: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: SP.md },
  balanceLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, marginTop: SP.md },
  balance: { color: theme.text, marginTop: 2 },
  card: {
    marginTop: SP.lg, borderRadius: RADIUS.lg, backgroundColor: theme.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingHorizontal: SP.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  rowLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.text },
  rowValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  sectionTitle: { fontSize: 20, fontFamily: FONT.semibold, color: theme.text, marginTop: SP.xl, marginBottom: SP.sm },
  pack: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 64, paddingHorizontal: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, marginBottom: SP.sm,
  },
  packOn: { borderColor: theme.text, borderWidth: 2 },
  popular: {
    position: 'absolute', top: -10, right: SP.md, paddingHorizontal: 12, paddingVertical: 3,
    borderRadius: RADIUS.pill, backgroundColor: theme.text,
  },
  popularText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.background },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.muted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: theme.text },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.text },
  packTitle: { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  packPrice: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
  footnote: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', marginTop: SP.sm },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 60 },
  historyDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSubtle },
  historyLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: theme.text },
  historyDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: 2 },
  historyDelta: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.muted, textAlign: 'right' },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: SP.xs },
  moreText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
});

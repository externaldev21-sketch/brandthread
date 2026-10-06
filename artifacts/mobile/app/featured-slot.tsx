/**
 * Featured on Discover — seller purchase flow.
 * Route: /featured-slot            (choose a length and pay)
 *        /featured-slot?id=<uuid>&paymentReturn=1   (Stripe Checkout return)
 *
 * Same shape as the Boost flow it is reached from: pick a length, see the
 * window and total, pay (iOS / Android: App Store / Google Play consumable via
 * RevenueCat, QA-0004; web: Stripe Checkout), then track the state
 * (In review / Scheduled / Live / Rejected / Ended). Nothing goes live on the
 * client's say-so: the server confirms payment, an admin approves, and a
 * rejected or withdrawn slot is refunded in full.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import {
  buildFeaturedReturnUrl, featuredStateLabel, needsStoreRefund, storeName, storeRefundUrl,
} from '@/services/featuredSlotService';
import { useRevenueCat } from '@/lib/revenueCat';
import {
  confirmNativePromotion, featuredProductId, isPurchaseCancelled, nativePromotionsEnabled,
} from '@/lib/iapPromotions';
import type { FeaturedAvailability, FeaturedSlot } from '@/lib/api';

const DAY = 86_400_000;
type Styles = ReturnType<typeof makeStyles>;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function demoAvailability(): FeaturedAvailability {
  const now = Date.now();
  const w = (days: number, startOffset = 0) => ({
    startsAt: new Date(now + startOffset * DAY).toISOString(),
    endsAt: new Date(now + (startOffset + days) * DAY).toISOString(),
  });
  return {
    placement: 'discover_brands', capacity: 4, openSlot: null,
    options: [
      { durationDays: 3, priceCents: 2900, availableNow: true, ...w(3) },
      { durationDays: 7, priceCents: 5900, availableNow: true, ...w(7) },
      { durationDays: 14, priceCents: 9900, availableNow: false, ...w(14, 2) },
    ],
  };
}

export default function FeaturedSlotScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { text: FG, muted: MUTED } = theme;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const params = useLocalSearchParams<{ id?: string; paymentReturn?: string }>();
  const { purchaseConsumable } = useRevenueCat();
  // iOS / Android buy through the store (App Store 3.1.1); web keeps Stripe.
  const nativeRail = nativePromotionsEnabled();

  // Signed-out web preview must not call protected APIs: it renders only with &demo=1.
  const demo = isSellerDevPreview() && isPreviewDemoMode() && !isSignedIn;
  const canCallApi = !!isSignedIn;

  const [availability, setAvailability] = useState<FeaturedAvailability | null>(demo ? demoAvailability() : null);
  const [history, setHistory] = useState<FeaturedSlot[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [selected, setSelected] = useState(7);
  const [busy, setBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const returnConsumed = useRef(false);

  const load = useCallback(async () => {
    if (!canCallApi) { setLoading(false); return; }
    try {
      const [a, mine] = await Promise.all([api.featuredSlots.availability(), api.featuredSlots.mine()]);
      setAvailability(a);
      setHistory(mine);
    } catch {
      Alert.alert('Featured', 'Could not load availability. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [api, canCallApi]);

  useEffect(() => { void load(); }, [load]);

  const verify = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const slot = await api.featuredSlots.verify(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (slot.displayState === 'in_review') {
        Alert.alert('In review', "Payment confirmed. We'll review your brand before it goes live, and refund you in full if it isn't approved.");
      }
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      Alert.alert(
        msg.includes('402') || msg.includes('unpaid') ? 'Checkout cancelled' : 'Could not confirm payment',
        msg.includes('402') || msg.includes('unpaid') ? 'Your payment was not completed. You can try again.' : 'Please check your slot status.',
      );
    } finally {
      setBusy(false);
      void load();
    }
  }, [api, load]);

  useEffect(() => {
    if (params.paymentReturn !== '1' || !params.id || returnConsumed.current) return;
    returnConsumed.current = true;
    router.setParams({ paymentReturn: undefined } as never);
    void verify(params.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.paymentReturn, params.id]);

  const option = useMemo(
    () => availability?.options.find((o) => o.durationDays === selected) ?? availability?.options[0] ?? null,
    [availability, selected],
  );
  const open = availability?.openSlot ?? null;

  async function pay() {
    if (!option || !canCallApi) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    try {
      const slot = await api.featuredSlots.reserve(option.durationDays);
      if (nativeRail) {
        try {
          const { transactionId } = await purchaseConsumable(featuredProductId(slot.durationDays));
          // The RevenueCat webhook grants it too if the verify retries run out.
          const confirmed = await confirmNativePromotion(() => api.featuredSlots.iapVerify(slot.id, transactionId));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            confirmed ? 'In review' : 'Payment received',
            confirmed
              ? "Payment confirmed. We'll review your brand before it goes live."
              : 'Your slot will show as In review here shortly.',
          );
        } catch (e) {
          if (!isPurchaseCancelled(e)) Alert.alert('Payment failed', 'Could not complete the purchase. Please try again.');
        }
        return;
      }
      const returnUrl = buildFeaturedReturnUrl(slot.id);
      const { url, paymentStatus } = await api.featuredSlots.pay(slot.id, returnUrl);
      if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') { await verify(slot.id); return; }
      if (!url) { Alert.alert('Error', 'Could not start checkout. Please try again.'); return; }
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === 'success') { await verify(slot.id); return; }
      Alert.alert('Checkout cancelled', 'Your payment was not completed. Your spot is held for 30 minutes.');
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      Alert.alert('Featured', msg.includes('already_booked') || msg.includes('409')
        ? 'You already have a Featured slot booked or in review.'
        : 'Could not start checkout. Please try again.');
    } finally {
      setBusy(false);
      void load();
    }
  }

  function cancel(slot: FeaturedSlot) {
    const paid = slot.paid;
    const message = !paid
      ? 'Release this reservation?'
      : needsStoreRefund(slot)
        ? `Request the refund from ${storeName(Platform.OS)}.`
        : 'Your payment will be refunded in full.';
    Alert.alert('Cancel Featured slot', message, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel slot', style: 'destructive',
        onPress: async () => {
          setCancellingId(slot.id);
          try { await api.featuredSlots.cancel(slot.id); } catch { Alert.alert('Featured', 'Could not cancel. Please try again.'); }
          finally { setCancellingId(null); void load(); }
        },
      },
    ]);
  }

  const goBack = () => goBackOr(router);

  return (
    <View style={s.screen}>
      <ScreenHeader title="Featured" onBack={goBack} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 140 }}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={FG} /></View>
        ) : !availability ? null : (
          <>
            {open ? (
              <View style={s.card}>
                <SlotState s={s} slot={open} />
                <Text style={s.meta}>{formatDay(open.startsAt)} – {formatDay(open.endsAt)} · {open.durationDays} days · {formatCents(open.priceCents)}</Text>
                {(open.displayState === 'in_review' || open.displayState === 'scheduled' || open.displayState === 'awaiting_payment') && (
                  <TouchableOpacity style={s.linkBtn} onPress={() => cancel(open)} disabled={cancellingId === open.id} accessibilityRole="button">
                    {cancellingId === open.id ? <ActivityIndicator size="small" color={MUTED} /> : <Text style={s.linkBtnText}>Cancel</Text>}
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
                <Text style={s.heading}>Length</Text>
                {availability.options.map((o) => {
                  const on = o.durationDays === (option?.durationDays ?? selected);
                  return (
                    <TouchableOpacity
                      key={o.durationDays}
                      style={[s.option, on && s.optionOn]}
                      onPress={() => setSelected(o.durationDays)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      testID={`featured-option-${o.durationDays}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.optionTitle}>{o.durationDays} days</Text>
                        <Text style={s.meta}>{o.availableNow ? 'Starts today' : `Next opening ${formatDay(o.startsAt)}`}</Text>
                      </View>
                      <Text style={s.optionPrice}>{formatCents(o.priceCents)}</Text>
                      <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
                    </TouchableOpacity>
                  );
                })}

                {option && (
                  <View style={s.summary}>
                    <Row s={s} label="Starts" value={formatDay(option.startsAt)} />
                    <Row s={s} label="Ends" value={formatDay(option.endsAt)} />
                    <Row s={s} label="Spots" value={`${availability.capacity} brands at a time`} />
                    <Row s={s} label="Total" value={formatCents(option.priceCents)} bold />
                  </View>
                )}
                <Text style={s.note}>
                  {nativeRail
                    ? `Reviewed before it goes live. If it isn't approved, request a refund from ${storeName(Platform.OS)}.`
                    : "Reviewed before it goes live. Refunded in full if it isn't approved."}
                </Text>
                <Button
                  label={`Pay ${formatCents(option?.priceCents ?? 0)}`}
                  variant="primary"
                  fullWidth
                  loading={busy}
                  disabled={busy || !option}
                  onPress={pay}
                  style={{ marginTop: SP.lg }}
                  testID="featured-pay"
                />
              </>
            )}

            {history.filter((h) => h.id !== open?.id).length > 0 && (
              <View style={{ marginTop: SP.xl }}>
                <Text style={s.heading}>History</Text>
                {history.filter((h) => h.id !== open?.id).map((h) => (
                  <View key={h.id} style={s.card}>
                    <SlotState s={s} slot={h} />
                    <Text style={s.meta}>{formatDay(h.startsAt)} – {formatDay(h.endsAt)} · {formatCents(h.priceCents)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

    </View>
  );
}

function Row({ label, value, bold, s }: { label: string; value: string; bold?: boolean; s: Styles }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, bold && { fontFamily: FONT.bold }]}>{value}</Text>
    </View>
  );
}

function SlotState({ slot, s }: { slot: FeaturedSlot; s: Styles }) {
  return (
    <View style={{ marginBottom: SP.xs }}>
      <View style={s.badge}><Text style={s.badgeText}>{featuredStateLabel(slot.displayState)}</Text></View>
      {slot.displayState === 'rejected' && !needsStoreRefund(slot) && (
        <Text style={s.meta}>{slot.rejectionReason ? `${slot.rejectionReason}. ` : ''}Your payment was refunded.</Text>
      )}
      {slot.displayState === 'cancelled' && slot.refundStatus === 'refunded' && (
        <Text style={s.meta}>Your payment was refunded.</Text>
      )}
      {(slot.displayState === 'rejected' || slot.displayState === 'cancelled') && slot.paid && needsStoreRefund(slot) && (
        <StoreRefund s={s} reason={slot.displayState === 'rejected' ? slot.rejectionReason : null} />
      )}
    </View>
  );
}

/** Store-paid slots: only Apple / Google can refund, so point the seller there (QA-0004). */
function StoreRefund({ reason, s }: { reason: string | null; s: Styles }) {
  const url = storeRefundUrl(Platform.OS);
  return (
    <View>
      <Text style={s.meta}>
        {reason ? `${reason}. ` : ''}Paid through {storeName(Platform.OS)}, so the refund comes from there.
      </Text>
      {url && (
        <TouchableOpacity style={s.linkBtn} onPress={() => { void Linking.openURL(url); }} accessibilityRole="link">
          <Text style={s.linkBtnText}>Request a refund</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  const { background: BG, text: FG, muted: MUTED, border: BORDER } = theme;
  const SUBTLE = theme.muted;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { paddingTop: SP.xl, alignItems: 'center' },
  heading: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, marginBottom: SP.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md, marginBottom: SP.sm,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER,
  },
  optionOn: { borderColor: FG },
  optionTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG },
  optionPrice: { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
  meta: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: MUTED, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: FG },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: FG },
  summary: { marginTop: SP.md, paddingTop: SP.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.xs },
  rowLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  rowValue: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  note: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: SP.md },
  card: { paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  badge: { alignSelf: 'flex-start', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: FG },
  badgeText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG },
  linkBtn: { marginTop: SP.sm, alignSelf: 'flex-start', paddingVertical: SP.xs },
  linkBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: MUTED },
});
}

/**
 * Seller: wholesale price list (item 59). One price list for approved
 * business buyers: on/off, a default % off retail, an order minimum, fixed
 * prices per product (wholesale-products.tsx), and buyer requests to approve
 * or decline. Reached from More, Store, Wholesale.
 *
 * Reference: Shopify iOS admin, Catalogs, "Creating a catalog" (status,
 * Pricing with an overall adjustment stepper, a Products row that opens the
 * per-product prices), reskinned to Brandthread.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { BrandthreadScreen, HapticSwitch, LoadingSkeleton, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { RetryRow } from '@/components/ui/RetryRow';
import { Snackbar } from '@/components/ui/Snackbar';
import { QuantityStepper } from '@/components/ui/QuantityStepper';
import { CheckoutField, CheckoutSection, GUTTER, useCheckoutColors, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { FONT, FS, SP } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { hapticLight } from '@/lib/haptics';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_WHOLESALE_OVERVIEW } from '@/lib/wholesalePreview';
import {
  MAX_PERCENT_OFF, centsToPriceText, pendingRequests, priceTextToCents, productsSummary,
  type WholesaleBuyerRequest, type WholesaleSellerOverview, type WholesaleSettings,
} from '@/lib/wholesale';

const EMPTY: WholesaleSellerOverview = {
  settings: { enabled: false, minOrderCents: 0, defaultPercentOff: 0 }, prices: [], products: [], buyers: [],
};

export default function WholesaleScreen() {
  const router = useRouter();
  const api = useApi();
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const preview = isSellerDevPreview();
  const [data, setData] = useState<WholesaleSellerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [minText, setMinText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const percentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => () => { if (percentTimer.current) clearTimeout(percentTimer.current); }, []);

  const load = useCallback(async () => {
    setFailed(false);
    if (preview) {
      // Signed-out preview never calls the API. Sample data only with &demo=1.
      const next = isPreviewDemoMode() ? PREVIEW_WHOLESALE_OVERVIEW : EMPTY;
      setData(next);
      setMinText(centsToPriceText(next.settings.minOrderCents || null));
      setLoading(false);
      return;
    }
    try {
      const next = await api.wholesale.seller.overview();
      setData(next);
      setMinText(centsToPriceText(next.settings.minOrderCents || null));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, preview]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save(patch: Partial<WholesaleSettings>, success?: string) {
    if (!data) return;
    setError(null);
    const before = data.settings;
    setData({ ...data, settings: { ...data.settings, ...patch } });
    if (preview) { if (success) setToast(success); return; }
    try {
      const settings = await api.wholesale.seller.saveSettings(patch);
      setData(d => (d ? { ...d, settings } : d));
      if (success) setToast(success);
    } catch (err) {
      setData(d => (d ? { ...d, settings: before } : d));
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Couldn’t save that. Try again.');
    }
  }

  function changePercent(next: number) {
    if (!data) return;
    setData({ ...data, settings: { ...data.settings, defaultPercentOff: next } });
    // One save once the taps settle, not one per tap.
    if (percentTimer.current) clearTimeout(percentTimer.current);
    percentTimer.current = setTimeout(() => { void save({ defaultPercentOff: next }); }, 600);
  }

  function commitMinimum() {
    if (!data) return;
    const cents = minText.trim() ? priceTextToCents(minText) : 0;
    if (cents == null) { setError('Enter an amount like 250 or 250.00'); return; }
    if (cents === data.settings.minOrderCents) return;
    void save({ minOrderCents: cents }, 'Minimum saved');
  }

  async function decide(buyer: WholesaleBuyerRequest, status: 'approved' | 'declined') {
    if (!data || deciding) return;
    hapticLight();
    const apply = () => setData(d => (d ? { ...d, buyers: d.buyers.map(b => (b.id === buyer.id ? { ...b, status } : b)) } : d));
    const done = status === 'approved' ? 'Buyer approved' : 'Request declined';
    if (preview) { apply(); setToast(done); return; }
    setDeciding(buyer.id);
    try {
      await api.wholesale.seller.decide(buyer.id, status);
      apply();
      setToast(done);
    } catch {
      setError('Couldn’t update that request. Try again.');
    } finally {
      setDeciding(null);
    }
  }

  function confirmRemove(buyer: WholesaleBuyerRequest) {
    Alert.alert(`Remove ${buyer.businessName}?`, 'They pay retail prices from their next order.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void decide(buyer, 'declined') },
    ]);
  }

  const settings = data?.settings;
  const pending = data ? pendingRequests(data.buyers) : [];
  const approved = data ? data.buyers.filter(b => b.status === 'approved') : [];

  return (
    <View style={{ flex: 1 }}>
      <BrandthreadScreen scrollable noSafeTop>
        <ScreenHeader title="Wholesale" onBack={() => goBackOr(router)} />
        <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
          {loading ? (
            <View style={{ gap: SP.sm }}><LoadingSkeleton height={56} /><LoadingSkeleton height={132} /><LoadingSkeleton height={72} /></View>
          ) : failed || !data || !settings ? (
            <RetryRow label="Couldn’t load wholesale" onRetry={() => void load()} />
          ) : (
            <>
              <View style={s.switchRow}>
                <Text style={[s.title, { flex: 1 }]}>Wholesale pricing</Text>
                <HapticSwitch
                  value={settings.enabled}
                  onValueChange={value => void save({ enabled: value }, value ? 'Wholesale on' : 'Wholesale off')}
                  accessibilityLabel="Wholesale pricing"
                />
              </View>

              <CheckoutSection title="Pricing" style={s.section}>
                <View style={s.stepperRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.title}>Default discount</Text>
                    <Text style={s.fine}>{settings.defaultPercentOff}% off retail</Text>
                  </View>
                  <QuantityStepper value={settings.defaultPercentOff} min={0} max={MAX_PERCENT_OFF} onChange={changePercent} testID="wholesale-percent" />
                </View>
                <CheckoutField
                  label="Minimum order"
                  value={minText}
                  onChangeText={setMinText}
                  onBlur={commitMinimum}
                  onSubmitEditing={commitMinimum}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                  placeholder="0.00"
                  style={{ marginTop: SP.md, marginBottom: 0 }}
                />
                {error ? <Text style={s.error}>{error}</Text> : null}
              </CheckoutSection>

              <CheckoutSection title="Products" style={s.section}>
                <PressableScale
                  style={s.navRow}
                  onPress={() => { hapticLight(); router.push('/wholesale-products' as never); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Price list, ${productsSummary(data.products, data.prices)}`}
                >
                  <Feather name="tag" size={20} color={ck.text} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.title}>Price list</Text>
                    <Text style={s.fine} numberOfLines={1}>{productsSummary(data.products, data.prices)}</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={ck.muted} />
                </PressableScale>
              </CheckoutSection>

              <CheckoutSection title="Buyer requests" style={s.section}>
                {pending.length === 0 ? (
                  <Text style={s.fine}>No requests yet. Buyers apply from the ••• menu on your store.</Text>
                ) : pending.map(buyer => (
                  <View key={buyer.id} style={s.buyerRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.title} numberOfLines={1}>{buyer.businessName}</Text>
                      <Text style={s.fine} numberOfLines={1}>{buyer.username ? `@${buyer.username}` : buyer.name ?? 'Buyer'}</Text>
                    </View>
                    <Button label="Decline" variant="secondary" size="compact" onPress={() => void decide(buyer, 'declined')} disabled={deciding === buyer.id} />
                    <Button label="Approve" size="compact" onPress={() => void decide(buyer, 'approved')} loading={deciding === buyer.id} />
                  </View>
                ))}
              </CheckoutSection>

              {approved.length > 0 ? (
                <CheckoutSection title="Approved buyers" style={s.section}>
                  {approved.map(buyer => (
                    <View key={buyer.id} style={s.buyerRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.title} numberOfLines={1}>{buyer.businessName}</Text>
                        <Text style={s.fine} numberOfLines={1}>{buyer.username ? `@${buyer.username}` : buyer.name ?? 'Buyer'}</Text>
                      </View>
                      <PressableScale style={s.removeButton} onPress={() => confirmRemove(buyer)} accessibilityRole="button" accessibilityLabel={`Remove ${buyer.businessName}`} hitSlop={12}>
                        <Text style={s.textAction}>Remove</Text>
                      </PressableScale>
                    </View>
                  ))}
                </CheckoutSection>
              ) : null}
            </>
          )}
        </View>
      </BrandthreadScreen>
      <Snackbar visible={!!toast} message={toast ?? ''} onDismiss={() => setToast(null)} />
    </View>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    section: { marginTop: SP.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 52 },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 52 },
    navRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 52 },
    buyerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 60, paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: ck.divider },
    title: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted, marginTop: 2 },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.text, marginTop: SP.sm },
    removeButton: { minHeight: 44, justifyContent: 'center' },
    textAction: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline', color: ck.text },
  });
}

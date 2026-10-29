/**
 * Pop-up mode — sell in person with Tap to Pay on iPhone.
 *
 * Flow copied from Shopify's in-person "Create order" / Quick Sale
 * (Mobbin: https://mobbin.com/flows/692ed2c6-d91b-4376-8aba-568048415be1),
 * reskinned: Products section with "Add products" → product/variant picker
 * ("$38.00 • 9 available") → line items with quantity steppers and remove →
 * Payment summary → sticky charge button → card tap → paid → New sale.
 *
 * Money: the server prices every sale (/api/seller/terminal); the app only
 * sends ids and quantities. Orders are created by the Stripe webhook.
 * Tap to Pay needs the Stripe Terminal SDK in the native build
 * (lib/tapToPay.ts); without it the Charge step says so instead of charging.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenExplainer } from '@/components/first-run-tips/ScreenExplainer';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { PrimaryButton, PressableScale, SecondaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BottomSheet, ErrorState, QuantityStepper, SuccessCheck } from '@/components/ui';
import { TapToPayCharger, type TapToPayChargerHandle } from '@/components/popup/TapToPayCharger';
import { tapToPayAvailability } from '@/lib/tapToPay';
import {
  POPUP_DEMO_PRODUCTS, addToCart, cartItemCount, cartTotalCents, paymentBody, setQuantity,
  type PopupCartLine, type PopupProduct, type PopupStatus,
} from '@/lib/popupMode';

type Theme = ReturnType<typeof useAppTheme>['theme'];

type Phase =
  | { kind: 'cart' }
  | { kind: 'starting' }
  | { kind: 'tap'; paymentIntentId: string }
  | { kind: 'paid'; amountCents: number; paymentIntentId: string; orderId: string | null; orderNumber: string | null }
  | { kind: 'unavailable' }
  | { kind: 'location' }
  | { kind: 'failed'; message: string };

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; status: PopupStatus; products: PopupProduct[] }
  | { kind: 'off' }
  | { kind: 'error' };

/** The server's error code from an ApiError body (either envelope shape). */
function errorCode(error: unknown): string | null {
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed?.code ?? parsed?.error?.code ?? null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body !== 'string') return fallback;
  try {
    const parsed = JSON.parse(body);
    const message = typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message;
    return typeof message === 'string' && message ? message : fallback;
  } catch {
    return fallback;
  }
}

function newKey(): string {
  return `pop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function PopupModeScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const demo = isPreviewDemoMode();

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [cart, setCart] = useState<PopupCartLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'cart' });
  const charger = useRef<TapToPayChargerHandle>(null);
  const saleKey = useRef<string>(newKey());

  const totalCents = cartTotalCents(cart);
  const itemCount = cartItemCount(cart);

  const fetchAll = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const status = await api.popup.status();
      if (!status.enabled) {
        setLoad({ kind: 'off' });
        return;
      }
      // A seller without payouts sees the setup gate; the catalog isn't needed.
      if (status.needsPayoutSetup ?? !status.paymentsReady) {
        setLoad({ kind: 'ready', status: { ...status, paymentsReady: false }, products: [] });
        return;
      }
      if (status.terminalUnavailable) {
        setLoad({ kind: 'off' });
        return;
      }
      const { products } = await api.popup.catalog();
      setLoad({ kind: 'ready', status, products });
    } catch (error) {
      if (demo) {
        setLoad({
          kind: 'ready',
          status: { enabled: true, paymentsReady: true, location: null, hasSellerLocation: true },
          products: POPUP_DEMO_PRODUCTS,
        });
        return;
      }
      setLoad(errorCode(error) === 'TERMINAL_NOT_CONFIGURED' ? { kind: 'off' } : { kind: 'error' });
    }
  }, [api, demo]);

  useFocusEffect(useCallback(() => {
    if (phase.kind === 'cart') void fetchAll();
    // Reload only when the screen regains focus in the cart step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll]));

  // A changed cart is a new sale attempt.
  useEffect(() => { saleKey.current = newKey(); }, [cart]);

  const fetchConnectionToken = useCallback(async () => (await api.popup.connectionToken()).secret, [api]);

  const resetSale = useCallback(() => {
    setCart([]);
    setPhase({ kind: 'cart' });
    void fetchAll();
  }, [fetchAll]);

  const charge = useCallback(async () => {
    if (cart.length === 0 || load.kind !== 'ready') return;
    if (!tapToPayAvailability().available) {
      setPhase({ kind: 'unavailable' });
      return;
    }
    setPhase({ kind: 'starting' });
    let locationId: string;
    try {
      locationId = (await api.popup.location()).location.id;
    } catch (error) {
      const code = errorCode(error);
      if (code === 'LOCATION_REQUIRED' || code === 'LOCATION_INCOMPLETE') {
        setPhase({ kind: 'location' });
        return;
      }
      setPhase({ kind: 'failed', message: errorMessage(error, 'Couldn\'t start the payment. Try again.') });
      return;
    }
    let start;
    try {
      start = await api.popup.createPayment(paymentBody(cart, saleKey.current));
    } catch (error) {
      if (errorCode(error) === 'OUT_OF_STOCK') void fetchAll();
      setPhase({ kind: 'failed', message: errorMessage(error, 'Couldn\'t start the payment. No one was charged.') });
      return;
    }
    setPhase({ kind: 'tap', paymentIntentId: start.paymentIntentId });
    const outcome = await charger.current?.charge(start.clientSecret, locationId)
      ?? { status: 'failed' as const, declined: false, message: 'Tap to Pay isn\'t ready. Try again.' };
    if (outcome.status === 'canceled') {
      await api.popup.cancelPayment(start.paymentIntentId).catch(() => {});
      saleKey.current = newKey();
      setPhase({ kind: 'cart' });
      return;
    }
    if (outcome.status === 'failed') {
      // A declined card can be retried on the same intent; anything else starts fresh.
      if (!outcome.declined) {
        await api.popup.cancelPayment(start.paymentIntentId).catch(() => {});
        saleKey.current = newKey();
      }
      setPhase({ kind: 'failed', message: outcome.message });
      return;
    }
    setPhase({ kind: 'paid', amountCents: start.amountCents, paymentIntentId: start.paymentIntentId, orderId: null, orderNumber: null });
    // The order is made by the Stripe webhook; pick up its number when it lands.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(1000);
      try {
        const status = await api.popup.getPayment(start.paymentIntentId);
        if (status.order) {
          setPhase((current) => current.kind === 'paid' && current.paymentIntentId === start.paymentIntentId
            ? { ...current, orderId: status.order!.orderId, orderNumber: status.order!.orderNumber }
            : current);
          return;
        }
      } catch {
        // Keep showing the confirmed payment; the order still appears in Orders.
      }
    }
  }, [api, cart, fetchAll, load.kind]);

  const cancelTap = useCallback(async () => {
    if (phase.kind !== 'tap') return;
    await charger.current?.cancel();
  }, [phase]);

  const unavailableTitle = (() => {
    const availability = tapToPayAvailability();
    if (!availability.available && availability.reason === 'not_in_build') return 'Tap to Pay isn\'t in this version of the app';
    return Platform.OS === 'android' ? 'Tap to Pay needs the Brandthread app' : 'Tap to Pay needs the Brandthread iPhone app';
  })();

  // ── Full-screen states ──────────────────────────────────────────────────
  function centered(children: React.ReactNode) {
    return <View style={[styles.centered, { paddingBottom: insets.bottom + SP.lg }]}>{children}</View>;
  }

  let body: React.ReactNode;
  if (load.kind === 'loading' && phase.kind === 'cart') {
    body = centered(<ActivityIndicator color={theme.text} />);
  } else if (load.kind === 'error') {
    body = <ErrorState message="Couldn't load Pop-up mode." onRetry={fetchAll} />;
  } else if (load.kind === 'off') {
    body = centered(
      <>
        <Feather name="smartphone" size={36} color={theme.muted} />
        <Text style={styles.stateTitle}>Pop-up mode isn't available for your store yet</Text>
      </>,
    );
  } else if (phase.kind === 'starting') {
    body = centered(
      <>
        <ActivityIndicator color={theme.text} />
        <Text style={styles.stateBody}>Starting payment</Text>
      </>,
    );
  } else if (phase.kind === 'tap') {
    body = centered(
      <>
        <Text style={styles.bigAmount}>{formatCents(totalCents)}</Text>
        <Feather name="wifi" size={40} color={theme.text} style={styles.contactless} />
        <Text style={styles.stateTitle}>Hold card near top of iPhone</Text>
        <View style={styles.stateButton}><SecondaryButton label="Cancel" onPress={cancelTap} /></View>
      </>,
    );
  } else if (phase.kind === 'paid') {
    body = centered(
      <>
        <SuccessCheck />
        <Text style={styles.bigAmount}>{formatCents(phase.amountCents)}</Text>
        <Text style={styles.stateTitle}>Paid</Text>
        {phase.orderNumber ? <Text style={styles.stateBody}>Order {phase.orderNumber}</Text> : null}
        <View style={styles.stateButton}><PrimaryButton label="New sale" onPress={resetSale} /></View>
        {phase.orderId ? (
          <View style={styles.stateButtonSecondary}>
            <SecondaryButton
              label="View order"
              onPress={() => router.push(`/order-detail?id=${encodeURIComponent(phase.orderId!)}` as never)}
            />
          </View>
        ) : null}
      </>,
    );
  } else if (phase.kind === 'unavailable') {
    body = centered(
      <>
        <Feather name="smartphone" size={36} color={theme.muted} />
        <Text style={styles.stateTitle}>{unavailableTitle}</Text>
        <View style={styles.stateButton}><SecondaryButton label="Back to sale" onPress={() => setPhase({ kind: 'cart' })} /></View>
      </>,
    );
  } else if (phase.kind === 'location') {
    body = centered(
      <>
        <Feather name="map-pin" size={36} color={theme.muted} />
        <Text style={styles.stateTitle}>Add your pop-up address</Text>
        <View style={styles.stateButton}><PrimaryButton label="Add location" onPress={() => { setPhase({ kind: 'cart' }); router.push('/locations' as never); }} /></View>
        <View style={styles.stateButtonSecondary}><SecondaryButton label="Back to sale" onPress={() => setPhase({ kind: 'cart' })} /></View>
      </>,
    );
  } else if (phase.kind === 'failed') {
    body = centered(
      <>
        <Feather name="alert-circle" size={36} color={theme.muted} />
        <Text style={styles.stateTitle}>{phase.message}</Text>
        <View style={styles.stateButton}><PrimaryButton label="Try again" onPress={charge} /></View>
        <View style={styles.stateButtonSecondary}><SecondaryButton label="Back to sale" onPress={() => setPhase({ kind: 'cart' })} /></View>
      </>,
    );
  } else if (load.kind === 'ready' && !load.status.paymentsReady) {
    body = centered(
      <>
        <Feather name="credit-card" size={36} color={theme.muted} />
        <Text style={styles.stateTitle}>Set up payouts to use Pop-up mode</Text>
        <Text style={styles.stateBody}>Connect payouts to take card payments in person.</Text>
        <View style={styles.stateButton}><PrimaryButton label="Set up payouts" onPress={() => router.push('/payouts' as never)} /></View>
      </>,
    );
  } else if (load.kind === 'ready' && load.products.length === 0 && cart.length === 0) {
    body = centered(
      <>
        <Feather name="package" size={36} color={theme.muted} />
        <Text style={styles.stateTitle}>No in-stock products</Text>
        <View style={styles.stateButton}><PrimaryButton label="Add product" onPress={() => router.push('/add-product' as never)} /></View>
      </>,
    );
  } else {
    body = (
      <>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Products</Text>
            <PressableScale
              onPress={() => setPickerOpen(true)}
              style={styles.addButton}
              accessibilityRole="button"
              accessibilityLabel="Add products"
              testID="popup-add-products"
            >
              <Feather name="plus" size={16} color={theme.onAccent} />
              <Text style={styles.addButtonText}>Add products</Text>
            </PressableScale>

            {cart.map((line) => (
              <View key={line.variantId} style={styles.line} testID="popup-cart-line">
                <View style={styles.lineTop}>
                  <Thumb uri={line.imageUrl} styles={styles} theme={theme} />
                  <View style={styles.lineInfo}>
                    <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                    {line.variantLabel ? <Text style={styles.lineMeta} numberOfLines={1}>{line.variantLabel}</Text> : null}
                  </View>
                  <PressableScale
                    onPress={() => setCart((current) => setQuantity(current, line.variantId, 0))}
                    style={styles.removeButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${line.name}`}
                  >
                    <Feather name="x" size={18} color={theme.muted} />
                  </PressableScale>
                </View>
                <View style={styles.lineBottom}>
                  <QuantityStepper
                    value={line.quantity}
                    min={1}
                    max={line.stock}
                    size="sm"
                    itemLabel={line.name}
                    onChange={(next) => setCart((current) => setQuantity(current, line.variantId, next))}
                  />
                  <Text style={styles.lineUnit}>{formatCents(line.unitCents)} × {line.quantity}</Text>
                  <Text style={styles.lineTotal}>{formatCents(line.unitCents * line.quantity)}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{formatCents(totalCents)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Items</Text>
              <Text style={styles.summaryValue}>{itemCount}</Text>
            </View>
            <View style={[styles.summaryRow, styles.summaryTotalRow]}>
              <Text style={styles.summaryTotalLabel}>Total</Text>
              <Text style={styles.summaryTotalValue}>{formatCents(totalCents)}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label={cart.length === 0 ? 'Charge' : `Charge ${formatCents(totalCents)}`}
            onPress={charge}
            disabled={cart.length === 0}
            testID="popup-charge"
          />
        </View>
      </>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Pop-up mode" />
      {body}
      <TapToPayCharger ref={charger} fetchConnectionToken={fetchConnectionToken} />
      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} testID="popup-picker">
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Add products</Text>
        </View>
        <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
          {(load.kind === 'ready' ? load.products : []).map((product) => (
            <View key={product.productId} style={styles.pickProduct}>
              <View style={styles.pickProductHeader}>
                <Thumb uri={product.imageUrl} styles={styles} theme={theme} />
                <Text style={styles.pickProductName} numberOfLines={1}>{product.name}</Text>
              </View>
              {product.variants.map((variant) => {
                const inCart = cart.find((line) => line.variantId === variant.variantId);
                const full = !!inCart && inCart.quantity >= variant.stock;
                return (
                  <PressableScale
                    key={variant.variantId}
                    onPress={() => { if (!full) setCart((current) => addToCart(current, product, variant)); }}
                    style={styles.pickVariant}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${product.name} ${variant.label}`}
                    accessibilityState={{ selected: !!inCart, disabled: full }}
                  >
                    <View style={[styles.checkbox, inCart && styles.checkboxOn]}>
                      {inCart ? <Feather name="check" size={13} color={theme.onAccent} /> : null}
                    </View>
                    <View style={styles.pickVariantInfo}>
                      <Text style={styles.pickVariantLabel} numberOfLines={1}>{variant.label || 'Default'}</Text>
                      <Text style={styles.pickVariantMeta}>
                        {formatCents(variant.priceCents)} • {variant.stock} available
                      </Text>
                    </View>
                    {inCart ? <Text style={styles.pickCount}>{inCart.quantity}</Text> : null}
                  </PressableScale>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + SP.sm }]}>
          <PrimaryButton label="Done" onPress={() => setPickerOpen(false)} />
        </View>
      </BottomSheet>
      <ScreenExplainer id="explain-popup-mode" />
    </View>
  );
}

function Thumb({ uri, styles, theme }: { uri: string | null; styles: ReturnType<typeof makeStyles>; theme: Theme }) {
  if (uri) return <Image source={{ uri }} style={styles.thumb} contentFit="cover" />;
  return (
    <View style={[styles.thumb, styles.thumbEmpty]}>
      <Feather name="image" size={16} color={theme.subtle} />
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg, gap: SP.sm },
  stateTitle: { fontSize: FS.md, fontFamily: FONT.semibold, color: theme.text, textAlign: 'center', marginTop: SP.sm },
  stateBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },
  stateButton: { alignSelf: 'stretch', width: '100%', marginTop: SP.lg },
  stateButtonSecondary: { alignSelf: 'stretch', width: '100%', marginTop: SP.sm },
  bigAmount: { fontSize: 44, fontFamily: FONT.bold, color: theme.text, marginTop: SP.md, fontVariant: ['tabular-nums'] },
  contactless: { transform: [{ rotate: '90deg' }], marginTop: SP.lg },

  scroll: { paddingBottom: SP.lg },
  section: {
    paddingHorizontal: SP.md, paddingVertical: SP.md, gap: SP.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  addButton: {
    height: 44, borderRadius: RADIUS.md, backgroundColor: theme.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs,
  },
  addButtonText: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.onAccent },

  line: {
    borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md,
    backgroundColor: theme.card, padding: SP.sm, gap: SP.sm,
  },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  lineInfo: { flex: 1, minWidth: 0 },
  lineName: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  lineMeta: { fontSize: FS.meta, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  removeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  lineBottom: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  lineUnit: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'right' },
  lineTotal: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, minWidth: 72, textAlign: 'right' },

  thumb: { width: 40, height: 40, borderRadius: RADIUS.xs, backgroundColor: theme.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },

  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  summaryValue: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  summaryTotalRow: { marginTop: SP.xs },
  summaryTotalLabel: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
  summaryTotalValue: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },

  footer: {
    paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, backgroundColor: theme.background,
  },

  sheetHeader: { paddingHorizontal: SP.md, paddingBottom: SP.sm },
  sheetTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text, textAlign: 'center' },
  sheetList: { maxHeight: 460 },
  pickProduct: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingVertical: SP.xs },
  pickProductHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  pickProductName: { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  pickVariant: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm, paddingLeft: SP.md + 48 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  pickVariantInfo: { flex: 1, minWidth: 0 },
  pickVariantLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  pickVariantMeta: { fontSize: FS.meta, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  pickCount: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, fontVariant: ['tabular-nums'] },
  sheetFooter: { paddingHorizontal: SP.md, paddingTop: SP.sm },
});

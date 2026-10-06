/**
 * Checkout settings (seller). Every control is saved to the store and
 * enforced by the API:
 *  - Checkout mode (PATCH /api/seller/settings → lib/sellerCheckoutSettings.ts):
 *      Guest checkout only — buyers check out without an account: cards and
 *        addresses aren't saved and nobody is asked to sign up;
 *      Accounts optional — guest or signed in;
 *      Accounts required — guest checkout is refused.
 *  - Tipping: a tip choice in the buyer's in-app checkout, paid out with the order.
 *  - Post-purchase page → "Add extra features after checkout": one product
 *    offered on the buyer's order confirmation, added with one tap and
 *    charged to the card they just used (PUT /api/seller/post-purchase-offer,
 *    api-server lib/postPurchaseOffer.ts).
 *  - Conversion tracking (the old "Additional scripts" box): a native app
 *    can't run a store's own scripts, so the store's Meta Pixel, TikTok Pixel
 *    and Google Analytics 4 get each paid order as a Purchase event from
 *    Brandthread's server (PUT /api/seller/conversion-tracking,
 *    lib/conversionTracking.ts). Secrets are write-only: the screen only
 *    ever sees them masked.
 *  - Checkout language: the store language (Languages screen); buyers who
 *    check out from this store alone see checkout in it.
 * The signed-out seller web preview never calls the API: changes stay local
 * and products come from the app's local product store.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { formatCents } from '@/lib/money';
import { ApiError } from '@/lib/networkNotice';
import { Button, OptionSheet } from '@/components/ui';
import { getProducts } from '@/services/productService';
import {
  CHECKOUT_MODE_OPTIONS, DEFAULT_SELLER_CHECKOUT_SETTINGS, checkoutModeOption, sellerCheckoutSettingsFrom, storeLanguageName,
  type CheckoutMode, type SellerCheckoutSettings,
} from '@/lib/checkoutSettings';
import {
  DEFAULT_POST_PURCHASE_OFFER, EMPTY_TRACKING, OFFER_DISCOUNT_STEPS, PROVIDER_LABELS, offerPriceCents, offerableProducts,
  trackingFieldError, trackingPatchFor,
  type ConversionProvider, type ConversionTrackingView, type OfferProductOption, type PostPurchaseOfferResponse,
  type PostPurchaseOfferSettings,
} from '@/lib/checkoutExtras';

const PROVIDERS: ConversionProvider[] = ['meta', 'tiktok', 'ga4'];

function providerValues(view: ConversionTrackingView, provider: ConversionProvider) {
  if (provider === 'meta') return { id: view.metaPixelId, secret: view.metaAccessTokenMasked, idField: 'metaPixelId' as const, secretField: 'metaAccessToken' as const };
  if (provider === 'tiktok') return { id: view.tiktokPixelId, secret: view.tiktokAccessTokenMasked, idField: 'tiktokPixelId' as const, secretField: 'tiktokAccessToken' as const };
  return { id: view.ga4MeasurementId, secret: view.ga4ApiSecretMasked, idField: 'ga4MeasurementId' as const, secretField: 'ga4ApiSecret' as const };
}

/** The signed-out preview keeps tracking locally: secrets are masked the way the server returns them. */
function previewTrackingAfter(view: ConversionTrackingView, patch: Record<string, string | null>): ConversionTrackingView {
  const mask = (value: string | null | undefined, previous: string | null) => (value === undefined ? previous : value === null ? null : `••••${value.slice(-4)}`);
  const next: ConversionTrackingView = {
    metaPixelId: 'metaPixelId' in patch ? patch.metaPixelId : view.metaPixelId,
    metaAccessTokenMasked: mask(patch.metaAccessToken, view.metaAccessTokenMasked),
    tiktokPixelId: 'tiktokPixelId' in patch ? patch.tiktokPixelId : view.tiktokPixelId,
    tiktokAccessTokenMasked: mask(patch.tiktokAccessToken, view.tiktokAccessTokenMasked),
    ga4MeasurementId: 'ga4MeasurementId' in patch ? patch.ga4MeasurementId : view.ga4MeasurementId,
    ga4ApiSecretMasked: mask(patch.ga4ApiSecret, view.ga4ApiSecretMasked),
    activeProviders: [],
  };
  next.activeProviders = PROVIDERS.filter(p => { const v = providerValues(next, p); return !!v.id && !!v.secret; });
  return next;
}

export default function CheckoutScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const previewOnly = isSellerDevPreview();
  const [settings, setSettings] = useState<SellerCheckoutSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const settingsRef = useRef<SellerCheckoutSettings | null>(null);
  settingsRef.current = settings;

  const [offer, setOffer] = useState<PostPurchaseOfferSettings>({ ...DEFAULT_POST_PURCHASE_OFFER });
  const [products, setProducts] = useState<OfferProductOption[]>([]);
  /** The saved offer's product as the server sees it (shown even when it's out of stock). */
  const [serverProduct, setServerProduct] = useState<PostPurchaseOfferResponse['product']>(null);
  const [tracking, setTracking] = useState<ConversionTrackingView>({ ...EMPTY_TRACKING });
  const [sheet, setSheet] = useState<'mode' | 'product' | 'discount' | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);
  const [openProvider, setOpenProvider] = useState<ConversionProvider | null>(null);
  const [draft, setDraft] = useState<{ id: string; secret: string }>({ id: '', secret: '' });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingTracking, setSavingTracking] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    if (previewOnly) {
      setSettings(prev => prev ?? { ...DEFAULT_SELLER_CHECKOUT_SETTINGS });
      // The app's local product store (never the API in the signed-out preview).
      void getProducts().then(list => setProducts(offerableProducts(list))).catch(() => setProducts([]));
      return;
    }
    try {
      const data = await api.seller.getSettings();
      setSettings(sellerCheckoutSettingsFrom(data?.settings));
    } catch {
      if (!settingsRef.current) setLoadFailed(true);
      return;
    }
    // The extras load independently: one failing never blanks the others.
    void api.seller.getPostPurchaseOffer().then(result => {
      if (result?.offer) setOffer(result.offer);
      setServerProduct(result?.product ?? null);
    }).catch(() => undefined);
    void api.products.list().then(list => setProducts(offerableProducts(list))).catch(() => setProducts([]));
    void api.seller.getConversionTracking().then(result => { if (result?.tracking) setTracking(result.tracking); }).catch(() => undefined);
  }, [api, previewOnly]);

  // Reloads on focus so a store language changed on the Languages screen shows here.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function save(patch: Partial<Pick<SellerCheckoutSettings, 'checkoutMode' | 'tippingEnabled'>>) {
    const prior = settingsRef.current;
    if (!prior) return;
    haptic();
    setSettings({ ...prior, ...patch });
    if (previewOnly) return;
    try {
      const result = await api.seller.updateSettings(patch);
      if (result?.settings) setSettings(sellerCheckoutSettingsFrom(result.settings));
    } catch {
      setSettings(prior);
      Alert.alert('Could not save', 'Your checkout settings were not changed. Try again.');
    }
  }

  async function saveOffer(next: PostPurchaseOfferSettings) {
    const prior = offer;
    haptic();
    setOffer(next);
    if (previewOnly) return;
    setSavingOffer(true);
    try {
      const result = await api.seller.savePostPurchaseOffer(next);
      if (result?.offer) setOffer(result.offer);
      setServerProduct(result?.product ?? null);
    } catch (err) {
      setOffer(prior);
      const message = err instanceof ApiError && err.status === 400 ? err.message : 'Your post-purchase offer was not changed. Try again.';
      Alert.alert('Could not save', message);
    } finally {
      setSavingOffer(false);
    }
  }

  function toggleOffer() {
    if (!offer.enabled && !offer.productId) {
      // Turning it on starts with choosing what to offer.
      setSheet('product');
      return;
    }
    void saveOffer({ ...offer, enabled: !offer.enabled });
  }

  function openTracking(provider: ConversionProvider) {
    haptic();
    if (openProvider === provider) { setOpenProvider(null); return; }
    setOpenProvider(provider);
    setDraft({ id: providerValues(tracking, provider).id ?? '', secret: '' });
    setDraftError(null);
  }

  async function saveTracking(provider: ConversionProvider, clear = false) {
    const values = providerValues(tracking, provider);
    if (!clear) {
      const idError = trackingFieldError(values.idField, draft.id);
      const secretError = trackingFieldError(values.secretField, draft.secret);
      if (idError || secretError) { setDraftError(idError ?? secretError); return; }
      if (!draft.id.trim()) { setDraftError(`Enter your ${PROVIDER_LABELS[provider].idLabel}`); return; }
      if (!draft.secret.trim() && !values.secret) { setDraftError(`Paste your ${PROVIDER_LABELS[provider].secretLabel}`); return; }
    }
    const patch = trackingPatchFor(provider, draft, clear);
    haptic();
    setDraftError(null);
    if (previewOnly) {
      setTracking(view => previewTrackingAfter(view, patch));
      setOpenProvider(null);
      return;
    }
    setSavingTracking(true);
    try {
      const result = await api.seller.saveConversionTracking(patch);
      if (result?.tracking) setTracking(result.tracking);
      setOpenProvider(null);
    } catch (err) {
      setDraftError(err instanceof ApiError && err.status === 400 ? err.message : 'Not saved. Check your connection and try again.');
    } finally {
      setSavingTracking(false);
    }
  }

  if (!settings) {
    return (
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Checkout settings" />
        {loadFailed ? (
          <View style={styles.section}>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              We couldn't load your checkout settings. Check your connection and try again.
            </Text>
            <TouchableOpacity onPress={() => { void load(); }} activeOpacity={0.7} style={[styles.selectBox, { borderColor: colors.border }]}>
              <Text style={[styles.selectValue, { color: colors.foreground }]}>Try again</Text>
              <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}><ActivityIndicator color={colors.primary} /></View>
        )}
      </View>
    );
  }

  const mode = checkoutModeOption(settings.checkoutMode);
  const tipping = settings.tippingEnabled;
  const offeredProduct: OfferProductOption | null = products.find(product => product.id === offer.productId)
    ?? (serverProduct && serverProduct.id === offer.productId
      ? { id: serverProduct.id, name: serverProduct.name, image: serverProduct.image, priceCents: serverProduct.priceCents, inStock: serverProduct.inStock }
      : null);
  const guestOnly = settings.checkoutMode === 'guest_only';

  const checkbox = (checked: boolean) => (
    <View style={[styles.checkbox, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : 'transparent' }]}>
      {checked && <Feather name="check" size={12} color={colors.primaryForeground} />}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Checkout settings" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <TouchableOpacity
            onPress={() => { haptic(); setSheet('mode'); }}
            activeOpacity={0.7}
            style={[styles.selectBox, { borderColor: colors.border, marginBottom: 12 }]}
            accessibilityRole="button"
            accessibilityLabel={`Checkout mode: ${mode.label}`}
            accessibilityHint="Choose guest checkout only, accounts optional or accounts required"
            testID="checkout-mode"
          >
            <Text style={[styles.selectValue, { color: colors.foreground }]}>{mode.label}</Text>
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>{mode.description}</Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tipping</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Customers can choose between 3 presets or enter a custom amount
          </Text>
          <TouchableOpacity
            onPress={() => { void save({ tippingEnabled: !tipping }); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tipping }}
            activeOpacity={0.7}
            style={styles.checkRow}
          >
            {checkbox(tipping)}
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Show tipping options at checkout</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section} testID="checkout-post-purchase">
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Post-purchase page</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground, marginBottom: 14 }]}>
            After checkout, buyers see one more product from your store and add it to their order with one tap. It ships with their order and is charged to the card they just used.
          </Text>

          <TouchableOpacity
            onPress={toggleOffer}
            activeOpacity={0.7}
            style={styles.radioRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: offer.enabled, busy: savingOffer }}
            testID="checkout-post-purchase-toggle"
          >
            {checkbox(offer.enabled)}
            <Text style={[styles.radioLabel, { color: colors.foreground }]}>Add extra features after checkout</Text>
          </TouchableOpacity>

          {offer.enabled || offer.productId ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Product to offer</Text>
              <TouchableOpacity
                onPress={() => { haptic(); setSheet('product'); }}
                activeOpacity={0.7}
                style={[styles.langRow, { borderColor: colors.border, marginBottom: SP.sm + 4 }]}
                accessibilityRole="button"
                accessibilityLabel={`Product to offer: ${offeredProduct?.name ?? 'none chosen'}`}
                testID="checkout-post-purchase-product"
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.langText, { color: colors.foreground }]} numberOfLines={1}>
                    {offeredProduct?.name ?? (offer.productId ? 'This product can’t be offered. Choose another' : 'Choose a product')}
                  </Text>
                  {offeredProduct ? (
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                      {offeredProduct.inStock ? formatCents(offeredProduct.priceCents) : 'Out of stock: buyers won’t see the offer'}
                    </Text>
                  ) : null}
                </View>
                <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Discount</Text>
              <TouchableOpacity
                onPress={() => { haptic(); setSheet('discount'); }}
                activeOpacity={0.7}
                style={[styles.langRow, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={`Discount: ${offer.discountPercent}%`}
                testID="checkout-post-purchase-discount"
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.langText, { color: colors.foreground }]}>
                    {offer.discountPercent > 0 ? `${offer.discountPercent}% off` : 'No discount'}
                  </Text>
                  {offeredProduct ? (
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                      Buyers pay {formatCents(offerPriceCents(offeredProduct.priceCents, offer.discountPercent))}
                    </Text>
                  ) : null}
                </View>
                <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              {guestOnly ? (
                <Text style={[styles.note, { color: colors.mutedForeground }]}>
                  Guest checkout only saves no cards, so buyers won’t see this offer until you allow accounts.
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section} testID="checkout-conversion-tracking">
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Conversion tracking</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground, marginBottom: 14 }]}>
            Every paid order is sent to these accounts as a Purchase from Brandthread’s server, with the order value and a hashed email. Keys are stored encrypted and never shown again.
          </Text>
          {PROVIDERS.map(provider => {
            const values = providerValues(tracking, provider);
            const connected = tracking.activeProviders.includes(provider);
            const open = openProvider === provider;
            const labels = PROVIDER_LABELS[provider];
            return (
              <View key={provider} style={[styles.providerBox, { borderColor: colors.border }]} testID={`tracking-${provider}`}>
                <TouchableOpacity
                  onPress={() => openTracking(provider)}
                  activeOpacity={0.7}
                  style={styles.providerHeader}
                  accessibilityRole="button"
                  accessibilityLabel={`${labels.name}: ${connected ? 'connected' : 'not connected'}`}
                  accessibilityState={{ expanded: open }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.langText, { color: colors.foreground }]}>{labels.name}</Text>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                      {connected ? `Connected · ${values.id}` : values.id ? 'Add the secret to connect' : 'Not connected'}
                    </Text>
                  </View>
                  <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                {open ? (
                  <View style={styles.providerForm}>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{labels.idLabel}</Text>
                    <View style={[styles.inputBox, { borderColor: colors.border }]}>
                      <TextInput
                        value={draft.id}
                        onChangeText={id => { setDraft(d => ({ ...d, id })); setDraftError(null); }}
                        placeholder={labels.idPlaceholder}
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize={provider === 'meta' ? 'none' : 'characters'}
                        autoCorrect={false}
                        style={[styles.input, { color: colors.foreground }]}
                        testID={`tracking-${provider}-id`}
                      />
                    </View>
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{labels.secretLabel}</Text>
                    <View style={[styles.inputBox, { borderColor: colors.border }]}>
                      <TextInput
                        value={draft.secret}
                        onChangeText={secret => { setDraft(d => ({ ...d, secret })); setDraftError(null); }}
                        placeholder={values.secret ? `${values.secret} (saved)` : 'Paste it here'}
                        placeholderTextColor={colors.mutedForeground}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        style={[styles.input, { color: colors.foreground }]}
                        testID={`tracking-${provider}-secret`}
                      />
                    </View>
                    {draftError ? (
                      <View style={styles.errorRow}>
                        <Feather name="alert-circle" size={13} color={colors.foreground} />
                        <Text style={[styles.errorText, { color: colors.foreground }]}>{draftError}</Text>
                      </View>
                    ) : null}
                    <View style={styles.formActions}>
                      {connected || values.id ? (
                        <Button
                          label="Disconnect"
                          variant="secondary"
                          size="small"
                          onPress={() => { void saveTracking(provider, true); }}
                          disabled={savingTracking}
                          testID={`tracking-${provider}-disconnect`}
                        />
                      ) : null}
                      <Button
                        label="Save"
                        size="small"
                        loading={savingTracking}
                        onPress={() => { void saveTracking(provider); }}
                        testID={`tracking-${provider}-save`}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Checkout language</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Buyers who check out from your store alone see checkout in this language. Carts from several stores use the buyer’s device language.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/languages' as never)}
            activeOpacity={0.7}
            style={[styles.langRow, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={`Checkout language: ${storeLanguageName(settings.storeLanguage)}`}
            accessibilityHint="Opens your store language settings"
          >
            <Text style={[styles.langText, { color: colors.foreground }]}>{storeLanguageName(settings.storeLanguage)}</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <OptionSheet
        visible={sheet === 'mode'}
        onClose={() => setSheet(null)}
        title="Checkout mode"
        options={CHECKOUT_MODE_OPTIONS.map(option => ({ id: option.id, label: option.label, description: option.description }))}
        selectedId={settings.checkoutMode}
        onSelect={id => { setSheet(null); if (id !== settings.checkoutMode) void save({ checkoutMode: id as CheckoutMode }); }}
        testID="checkout-mode-sheet"
      />
      <OptionSheet
        visible={sheet === 'product'}
        onClose={() => setSheet(null)}
        title="Product to offer"
        description={products.length === 0 ? 'Only active products with stock can be offered. Add or restock one in Products.' : 'Active products with stock'}
        options={products.map(product => ({ id: product.id, label: product.name, description: formatCents(product.priceCents) }))}
        selectedId={offer.productId ?? ''}
        onSelect={id => { setSheet(null); void saveOffer({ ...offer, productId: id, enabled: true }); }}
        testID="checkout-product-sheet"
      />
      <OptionSheet
        visible={sheet === 'discount'}
        onClose={() => setSheet(null)}
        title="Discount"
        description="Taken off the product’s price on the order confirmation, up to 50%"
        options={OFFER_DISCOUNT_STEPS.map(step => ({
          id: String(step),
          label: step === 0 ? 'No discount' : `${step}% off`,
          ...(offeredProduct ? { description: `Buyers pay ${formatCents(offerPriceCents(offeredProduct.priceCents, step))}` } : {}),
        }))}
        selectedId={String(offer.discountPercent)}
        onSelect={id => { setSheet(null); void saveOffer({ ...offer, discountPercent: Number(id) }); }}
        testID="checkout-discount-sheet"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: SP.md, paddingVertical: SP.md + 2 },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.semibold, marginBottom: SP.xs + 2 },
  sectionSubtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.md - 2, lineHeight: 17 },
  divider: { height: SP.sm + 2 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md - 2 },
  selectValue: { fontSize: FS.md, fontFamily: FONT.semibold },
  cardTitle: { fontSize: FS.md, fontFamily: FONT.semibold },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, marginTop: SP.xs },
  checkbox: { width: 18, height: 18, borderRadius: RADIUS.xs - 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, marginBottom: SP.sm + 4 },
  radioLabel: { fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.medium, marginBottom: 6 },
  rowSub: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 17, marginTop: SP.sm + 2 },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md - 2, gap: SP.sm + 2 },
  langText: { fontSize: FS.md, fontFamily: FONT.medium },
  providerBox: { borderWidth: 1, borderRadius: RADIUS.md, marginBottom: SP.sm + 2 },
  providerHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, padding: SP.md - 2 },
  providerForm: { paddingHorizontal: SP.md - 2, paddingBottom: SP.md - 2 },
  inputBox: { borderWidth: 1, borderRadius: RADIUS.md, marginBottom: SP.sm + 4 },
  input: { fontSize: FS.sm, fontFamily: FONT.regular, paddingHorizontal: SP.md - 2, paddingVertical: SP.sm + 2, minHeight: 44 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm + 2 },
  errorText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SP.sm },
});

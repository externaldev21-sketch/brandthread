/**
 * Return status: one screen for both sides of a return request.
 *
 * Opened by the return push, by Activity rows for both roles (#266: the
 * buyer's "Return request received / approved / refunded", and the
 * seller's new "<buyer> requested a return"), by the buyer's order screen
 * and request form, and by the seller's order Returns tab and Shipping
 * screen.
 *
 * Item 108 rebuilt it on real data:
 *  - It loads GET /api/returns/:id, which both the buyer and the seller may
 *    read. Who is looking comes from that row (buyerId / sellerId vs. the
 *    signed-in user). It used to load the seller-only GET /api/orders/:id
 *    with an `orderId` param that no link passed, so every buyer and every
 *    Activity tap got "Couldn't load this return".
 *  - It uses the server's statuses: pending → approved → refunded, or
 *    denied. The old screen expected requested / under_review / …, so a
 *    real pending return showed no step as current and no Approve / Decline
 *    for the seller.
 *  - Seller actions call PATCH /api/returns/:id/status. Approving refunds
 *    through the refund service, and approving again only retries a refund
 *    that didn't confirm. Declining needs a reason, which the buyer sees.
 *  - Monochrome, theme tokens (no static purple / cyan / green); inline
 *    errors (RN-web Alert is a no-op).
 *
 * References (Mobbin): the Shopee "Return/Refund Details" stepper and
 * Klarna's vertical return timeline.
 *
 * Item 52 added the seller's missing options, Shopify "Refund" style: a
 * refund amount field (partial refunds, "$X available for refund"), "Refund
 * when the carrier scans it" (approve now, refund on the first scan), and
 * "Send prepaid return label" (POST /api/return-labels/:id, which approves and
 * refunds on scan). `?decline=1` (Decline on the returns list) opens the
 * reason form directly.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { View, Text, ScrollView, StyleSheet, TextInput, Image, ActivityIndicator, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandthreadCard, BrandthreadScreen, EmptyState, FormInput, HapticSwitch } from '@/components/BrandthreadUI';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticSuccess } from '@/lib/haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useApi } from '@/hooks/useApi';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  adaptReturnRow, apiErrorMessage, itemsTotalCents, parseRefundAmount, returnHeadline, returnReasonLabel, returnSteps, statusLabel,
  type ReturnView, type ReturnViewer,
} from '@/lib/returns';

/** Last return address + package the seller used, so the next label is one tap (this device only). */
const RETURN_LABEL_DEFAULTS_KEY = '@brandthread/return-label-defaults:v1';
type LabelForm = { name: string; street1: string; city: string; state: string; zip: string; weight: string; length: string; width: string; height: string };
const EMPTY_LABEL_FORM: LabelForm = { name: '', street1: '', city: '', state: '', zip: '', weight: '', length: '', width: '', height: '' };

function positive(value: string): number | null {
  const n = Number(value.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export default function ReturnDetailScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { returnId, decline } = useLocalSearchParams<{ returnId: string; decline?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { userId } = useAuth();

  const [view, setView] = useState<ReturnView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'network' | 'not_found' | null>(null);
  const [acting, setActing] = useState<'approve' | 'deny' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDenyForm, setShowDenyForm] = useState(decline === '1');
  const [denyReason, setDenyReason] = useState('');
  // Item 52: partial refund, refund on scan, prepaid return label.
  const [refundText, setRefundText] = useState('');
  const [refundOnScan, setRefundOnScan] = useState(false);
  const [showLabelForm, setShowLabelForm] = useState(false);
  const [labelForm, setLabelForm] = useState<LabelForm>(EMPTY_LABEL_FORM);
  const [buyingLabel, setBuyingLabel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const refundTextFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!returnId) { setLoadError('not_found'); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      const row = await api.returns.get(returnId);
      setView(row ? adaptReturnRow(row) : null);
      if (!row) setLoadError('not_found');
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setLoadError(status === 404 || status === 403 ? 'not_found' : 'network');
    } finally {
      setLoading(false);
    }
  }, [api, returnId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!view || refundTextFor.current === view.id) return;
    refundTextFor.current = view.id;
    const cents = view.refundAmountCents ?? (view.orderTotalCents || itemsTotalCents(view.items));
    setRefundText(cents > 0 ? (cents / 100).toFixed(2) : '');
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showLabelForm) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(RETURN_LABEL_DEFAULTS_KEY);
        if (saved && !cancelled) setLabelForm(prev => ({ ...prev, ...JSON.parse(saved) }));
      } catch { /* first label: the seller types it */ }
    })();
    return () => { cancelled = true; };
  }, [showLabelForm]);

  const viewer: ReturnViewer = view && userId && view.sellerId === userId && view.buyerId !== userId ? 'seller' : 'buyer';


  async function updateStatus(
    status: 'approved' | 'denied',
    sellerResponse?: string,
    extra: { refundAmountCents?: number; refundOnScan?: boolean } = {},
  ) {
    if (!view) return;
    setActing(status === 'approved' ? 'approve' : 'deny');
    setActionError(null);
    try {
      const updated = await api.returns.updateStatus(view.id, { status, sellerResponse, ...extra });
      setShowDenyForm(false);
      setDenyReason('');
      if (status === 'approved') {
        hapticSuccess();
        setToast(updated?.status === 'refunded'
          ? (typeof updated.refundAmountCents === 'number' ? `Refunded ${formatCents(updated.refundAmountCents)}` : 'Refunded')
          : extra.refundOnScan ? 'Return approved' : 'Approved. Refund not confirmed yet');
      } else {
        setToast('Return declined');
      }
      await load();
    } catch (err) {
      setActionError(apiErrorMessage(err, 'Couldn’t update this return. Check your connection and try again.'));
    } finally {
      setActing(null);
    }
  }

  async function sendReturnLabel(refundAmountCents: number | undefined) {
    if (!view) return;
    const f = labelForm;
    const parcel = { weight: positive(f.weight), length: positive(f.length), width: positive(f.width), height: positive(f.height) };
    if (![f.name, f.street1, f.city, f.state, f.zip].every(v => v.trim())) {
      setActionError('Add your full return address.');
      return;
    }
    if (Object.values(parcel).some(v => v == null)) {
      setActionError('Add the package weight and size.');
      return;
    }
    setBuyingLabel(true);
    setActionError(null);
    try {
      const result = await api.returns.sendReturnLabel(view.id, {
        returnAddress: { name: f.name.trim(), street1: f.street1.trim(), city: f.city.trim(), state: f.state.trim(), zip: f.zip.trim(), country: 'US' },
        parcel: parcel as { weight: number; length: number; width: number; height: number },
        ...(refundAmountCents !== undefined ? { refundAmountCents } : {}),
      });
      try { await AsyncStorage.setItem(RETURN_LABEL_DEFAULTS_KEY, JSON.stringify(f)); } catch { /* convenience only */ }
      hapticSuccess();
      setShowLabelForm(false);
      setToast(result?.label?.carrier ? `${result.label.carrier} label sent` : 'Return label sent');
      await load();
    } catch (err) {
      setActionError(apiErrorMessage(err, 'Couldn’t create the return label. Check the address and try again.'));
    } finally {
      setBuyingLabel(false);
    }
  }

  const header = (
    <ScreenHeader
      title={view ? `Return · #${view.orderNumber}` : 'Return'}
      onBack={() => goBackOr(router)}
    />
  );

  if (loading && !view) {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <View style={s.centered}><ActivityIndicator color={theme.text} size="large" /></View>
      </BrandthreadScreen>
    );
  }

  if (!view) {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        {loadError === 'network' ? (
          <EmptyState
            icon="wifi-off"
            title="Couldn’t load this return"
            description="Check your connection and try again."
            action={{ label: 'Try again', onPress: () => { void load(); } }}
          />
        ) : (
          <EmptyState
            icon="rotate-ccw"
            title="Return not found"
            description="It may have been removed, or it belongs to another account."
            action={{ label: 'Go back', onPress: () => goBackOr(router) }}
          />
        )}
      </BrandthreadScreen>
    );
  }

  const headline = returnHeadline(view, viewer, formatCents);
  const steps = returnSteps(view, viewer);
  const itemsTotal = itemsTotalCents(view.items);
  const refundBasis = view.orderTotalCents || itemsTotal;
  const parsedRefund = parseRefundAmount(refundText, refundBasis);
  const refundError = 'error' in parsedRefund ? parsedRefund.error : null;
  const refundCents = 'cents' in parsedRefund ? parsedRefund.cents : refundBasis;
  // Only send an amount when it is a partial refund; otherwise the server refunds all that's refundable.
  const partialCents = 'cents' in parsedRefund && parsedRefund.cents < refundBasis ? parsedRefund.cents : undefined;
  const orderHref = viewer === 'seller' ? `/order-detail?id=${encodeURIComponent(view.orderId)}` : `/buyer-order-detail?id=${encodeURIComponent(view.orderId)}`;

  return (
    <BrandthreadScreen noSafeTop noSafeBottom>
      {header}
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        // Extra room for the seller's floating tab bar (SellerGlobalTabBar shows on this route).
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + (viewer === 'seller' ? 120 : SP.xxl), gap: SP.md }}
      >
        {/* Status + timeline */}
        <BrandthreadCard>
          <View style={s.statusPillRow}>
            <View style={s.statusPill}><Text style={s.statusPillText}>{statusLabel(view.status).toUpperCase()}</Text></View>
          </View>
          <Text style={s.headline} accessibilityRole="header" testID="return-headline">{headline.title}</Text>
          <Text style={s.headlineBody}>{headline.body}</Text>

          <View style={s.steps}>
            {steps.map((step, i) => (
              <View key={step.key} style={s.stepRow} testID={`return-step-${step.key}`} accessibilityState={{ selected: step.state === 'current' }}>
                <View style={s.railCol}>
                  <View style={[
                    s.dot,
                    step.state === 'done' && { backgroundColor: theme.accent, borderColor: theme.accent },
                    step.state === 'current' && { borderColor: theme.accent },
                  ]}>
                    {step.state === 'done' ? <Feather name="check" size={12} color={theme.onAccent} /> : null}
                    {step.state === 'current' ? <View style={s.dotInner} /> : null}
                  </View>
                  {i < steps.length - 1 ? <View style={[s.connector, step.state === 'done' && { backgroundColor: theme.accent }]} /> : null}
                </View>
                <View style={s.stepBody}>
                  <Text style={[s.stepLabel, step.state === 'upcoming' && { color: theme.muted }, step.state === 'current' && { fontFamily: FONT.bold }]}>
                    {step.label}
                  </Text>
                  {step.at ? <Text style={s.stepTime}>{fmtDateTime(step.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </BrandthreadCard>

        {/* Seller actions */}
        {viewer === 'seller' && view.status === 'pending' ? (
          <BrandthreadCard>
            <Text style={s.cardTitle}>Your decision</Text>
            <Text style={s.cardBody}>
              {refundOnScan
                ? `Approving keeps the order open until the carrier scans ${view.buyerName}’s parcel, then refunds ${formatCents(refundCents)}.`
                : `Approving refunds ${formatCents(refundCents)} to ${view.buyerName}’s original payment. Declining keeps the order as it is. Tell the buyer why.`}
            </Text>
            {actionError ? (
              <View style={s.inlineError} accessibilityRole="alert" testID="return-action-error">
                <Feather name="alert-circle" size={14} color={theme.text} />
                <Text style={s.inlineErrorText}>{actionError}</Text>
              </View>
            ) : null}
            {showDenyForm ? (
              <View style={s.actions}>
                <Text style={s.fieldLabel}>Reason for the buyer</Text>
                <TextInput
                  style={s.input}
                  value={denyReason}
                  onChangeText={setDenyReason}
                  placeholder="e.g. The item was worn and the tags were removed."
                  placeholderTextColor={theme.subtle}
                  multiline
                  autoFocus={decline === '1'}
                  accessibilityLabel="Reason for declining"
                  testID="return-decline-reason"
                />
                <View style={s.row}>
                  <View style={s.cell}><Button label="Cancel" variant="secondary" fullWidth onPress={() => { setShowDenyForm(false); setDenyReason(''); }} /></View>
                  <View style={s.cell}>
                    <Button
                    label="Decline return"
                    variant="primary"
                    fullWidth
                    loading={acting === 'deny'}
                    disabled={!denyReason.trim() || acting !== null}
                    onPress={() => { void updateStatus('denied', denyReason.trim()); }}
                    testID="return-decline-submit"
                  />
                  </View>
                </View>
              </View>
            ) : (
              <View style={s.actions}>
                <FormInput
                  label="Refund amount"
                  value={refundText}
                  onChange={setRefundText}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  error={refundError}
                  helper={`${formatCents(refundBasis)} available for refund`}
                />
                {showLabelForm ? (
                  <View style={s.actions}>
                    <Text style={s.fieldLabel}>Your return address</Text>
                    <FormInput label="Name" value={labelForm.name} onChange={v => setLabelForm(f => ({ ...f, name: v }))} placeholder="Store or your name" />
                    <FormInput label="Street" value={labelForm.street1} onChange={v => setLabelForm(f => ({ ...f, street1: v }))} placeholder="Street address" />
                    <View style={s.row}>
                      <FormInput label="City" value={labelForm.city} onChange={v => setLabelForm(f => ({ ...f, city: v }))} style={{ flex: 2 }} />
                      <FormInput label="State" value={labelForm.state} onChange={v => setLabelForm(f => ({ ...f, state: v }))} style={{ flex: 1 }} />
                    </View>
                    <FormInput label="ZIP" value={labelForm.zip} onChange={v => setLabelForm(f => ({ ...f, zip: v }))} keyboardType="numeric" />
                    <Text style={s.fieldLabel}>Package</Text>
                    <View style={s.row}>
                      <FormInput label="Weight (lb)" value={labelForm.weight} onChange={v => setLabelForm(f => ({ ...f, weight: v }))} keyboardType="decimal-pad" style={{ flex: 1 }} />
                      <FormInput label="L (in)" value={labelForm.length} onChange={v => setLabelForm(f => ({ ...f, length: v }))} keyboardType="decimal-pad" style={{ flex: 1 }} />
                    </View>
                    <View style={s.row}>
                      <FormInput label="W (in)" value={labelForm.width} onChange={v => setLabelForm(f => ({ ...f, width: v }))} keyboardType="decimal-pad" style={{ flex: 1 }} />
                      <FormInput label="H (in)" value={labelForm.height} onChange={v => setLabelForm(f => ({ ...f, height: v }))} keyboardType="decimal-pad" style={{ flex: 1 }} />
                    </View>
                    <Text style={s.cardBody}>{`The cheapest label is charged to your balance. ${view.buyerName} gets it on this return, and the refund of ${formatCents(refundCents)} is issued on the carrier’s first scan.`}</Text>
                    <View style={s.row}>
                      <View style={s.cell}><Button label="Cancel" variant="secondary" fullWidth disabled={buyingLabel} onPress={() => { setShowLabelForm(false); setActionError(null); }} /></View>
                      <View style={s.cell}>
                        <Button
                        label="Buy label"
                        variant="primary"
                        fullWidth
                        loading={buyingLabel}
                        disabled={buyingLabel || !!refundError}
                        onPress={() => { void sendReturnLabel(partialCents); }}
                        testID="return-label-submit"
                      />
                      </View>
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={s.switchRow}>
                      <Text style={s.switchLabel}>Refund when the carrier scans it</Text>
                      <HapticSwitch
                        value={refundOnScan}
                        onValueChange={setRefundOnScan}
                        accessibilityLabel="Refund when the carrier scans it"
                        testID="return-refund-on-scan"
                      />
                    </View>
                    <Button
                      label={refundOnScan ? 'Approve return' : `Approve and refund ${formatCents(refundCents)}`}
                      variant="primary"
                      fullWidth
                      loading={acting === 'approve'}
                      disabled={acting !== null || !!refundError}
                      onPress={() => { void updateStatus('approved', undefined, { refundAmountCents: partialCents, ...(refundOnScan ? { refundOnScan: true } : {}) }); }}
                      testID="return-approve"
                    />
                    <Button
                      label="Send prepaid return label"
                      variant="secondary"
                      icon="tag"
                      fullWidth
                      disabled={acting !== null || !!refundError}
                      onPress={() => { setActionError(null); setShowLabelForm(true); }}
                      testID="return-send-label"
                    />
                    <Button
                      label="Decline"
                      variant="secondary"
                      fullWidth
                      disabled={acting !== null}
                      onPress={() => { setActionError(null); setShowDenyForm(true); }}
                      testID="return-decline"
                    />
                  </>
                )}
              </View>
            )}
          </BrandthreadCard>
        ) : null}

        {viewer === 'seller' && view.status === 'approved' ? (
          <BrandthreadCard>
            <Text style={s.cardTitle}>Refund</Text>
            <Text style={s.cardBody}>
              {view.refundOnScan
                ? `${formatCents(view.refundAmountCents ?? refundBasis)} is refunded on the carrier’s first scan. Refund now if the buyer already sent it back another way.`
                : `The refund of ${formatCents(view.refundAmountCents ?? refundBasis)} hasn’t been confirmed yet. Retrying is safe: the buyer is only ever refunded once.`}
            </Text>
            {actionError ? (
              <View style={s.inlineError} accessibilityRole="alert" testID="return-action-error">
                <Feather name="alert-circle" size={14} color={theme.text} />
                <Text style={s.inlineErrorText}>{actionError}</Text>
              </View>
            ) : null}
            <View style={s.actions}>
              <Button
                label={view.refundOnScan ? 'Refund now' : 'Retry refund'}
                variant={view.refundOnScan ? 'secondary' : 'primary'}
                fullWidth
                loading={acting === 'approve'}
                disabled={acting !== null}
                onPress={() => { void updateStatus('approved', undefined, view.refundAmountCents != null ? { refundAmountCents: view.refundAmountCents } : {}); }}
                testID="return-approve"
              />
            </View>
          </BrandthreadCard>
        ) : null}

        {view.returnLabelUrl ? (
          <BrandthreadCard>
            <Text style={s.cardTitle}>Return label</Text>
            <Text style={s.cardBody}>{[view.returnCarrier, view.returnTrackingNumber].filter(Boolean).join(' · ') || 'Prepaid label'}</Text>
            <View style={s.actions}>
              <Button
                label="Open label"
                variant="secondary"
                icon="external-link"
                fullWidth
                onPress={() => { void Linking.openURL(view.returnLabelUrl!); }}
                testID="return-open-label"
              />
            </View>
          </BrandthreadCard>
        ) : null}

        {/* Items */}
        <BrandthreadCard>
          <Text style={s.cardTitle}>Items</Text>
          {view.items.length === 0 ? (
            <Text style={s.cardBody}>The whole order #{view.orderNumber}.</Text>
          ) : view.items.map((item, idx) => (
            <View key={item.lineItemId} style={[s.itemRow, idx > 0 && s.itemBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>{item.productName}</Text>
                <Text style={s.itemMeta}>{[item.variantTitle, `×${item.quantity}`].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={s.itemPrice}>{formatCents(item.unitPriceCents * item.quantity)}</Text>
            </View>
          ))}
        </BrandthreadCard>

        {/* Reason, notes, photos */}
        <BrandthreadCard>
          <Text style={s.cardTitle}>Reason</Text>
          <Text style={s.reason}>{returnReasonLabel(view.reason)}</Text>
          {view.notes ? <Text style={[s.cardBody, { marginTop: SP.xs }]}>{view.notes}</Text> : null}
          {view.evidenceUrls.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} style={{ marginTop: SP.sm }}>
              {view.evidenceUrls.map((uri, i) => (
                <Image key={`${uri}-${i}`} source={{ uri }} style={s.photo} accessibilityLabel={`Return photo ${i + 1}`} />
              ))}
            </ScrollView>
          ) : (
            <Text style={s.noPhotos}>No photos added</Text>
          )}
          {view.sellerResponse && view.status !== 'denied' ? (
            <View style={s.response}>
              <Text style={s.fieldLabel}>{viewer === 'seller' ? 'Your note' : `${view.sellerName} replied`}</Text>
              <Text style={s.cardBody}>{view.sellerResponse}</Text>
            </View>
          ) : null}
          <Text style={s.meta}>Requested {fmtDateTime(view.createdAt)}</Text>
        </BrandthreadCard>

        <Button
          label="View order"
          variant="secondary"
          icon="file-text"
          fullWidth
          onPress={() => router.push(orderHref as never)}
          testID="return-view-order"
        />
        <View style={s.footNote}>
          <Feather name="info" size={ICON.xs} color={theme.subtle} />
          <Text style={s.footNoteText}>
            {viewer === 'seller'
              ? 'Refunds go back to the buyer’s original payment. Your payout for this order is adjusted automatically.'
              : 'Refunds go back to your original payment method.'}
          </Text>
        </View>
      </ScrollView>
      <Snackbar visible={!!toast} message={toast ?? ''} onDismiss={() => setToast(null)} bottomOffset={insets.bottom + 104} />
    </BrandthreadScreen>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusPillRow: { flexDirection: 'row', marginBottom: SP.sm },
  statusPill: { borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 9, paddingVertical: 3 },
  statusPillText: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.4, color: theme.muted },
  headline: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4, color: theme.text },
  headlineBody: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 4, lineHeight: 20 },

  steps: { marginTop: SP.md },
  stepRow: { flexDirection: 'row' },
  railCol: { alignItems: 'center', width: 28 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
  connector: { width: 2, flex: 1, minHeight: 16, marginVertical: 2, backgroundColor: theme.border, borderRadius: 1 },
  stepBody: { flex: 1, paddingLeft: SP.sm, paddingBottom: SP.md },
  stepLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, paddingTop: 2 },
  stepTime: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },

  cardTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, letterSpacing: 0.4, textTransform: 'uppercase', color: theme.muted, marginBottom: SP.sm },
  cardBody: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, lineHeight: 20 },
  actions: { gap: SP.sm, marginTop: SP.md },
  row: { flexDirection: 'row', gap: SP.sm },
  cell: { flex: 1 },
  fieldLabel: { fontFamily: FONT.semibold, fontSize: FS.xs + 1, color: theme.muted },
  input: {
    backgroundColor: theme.cardElevated, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    padding: SP.md, minHeight: 90, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, textAlignVertical: 'top',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 44 },
  switchLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
  inlineError: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: SP.sm },
  inlineErrorText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.xs + 1, color: theme.text, lineHeight: 18 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
  itemMeta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
  itemPrice: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },

  reason: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
  photo: { width: 84, height: 84, borderRadius: RADIUS.sm, marginRight: SP.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  noPhotos: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.subtle, marginTop: SP.sm },
  response: { marginTop: SP.md, gap: 4 },
  meta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.subtle, marginTop: SP.md },

  footNote: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingHorizontal: 2 },
  footNoteText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: theme.subtle, lineHeight: 17 },
});

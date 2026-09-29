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
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { View, Text, ScrollView, StyleSheet, TextInput, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandthreadCard, BrandthreadScreen, EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useApi } from '@/hooks/useApi';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  adaptReturnRow, itemsTotalCents, returnHeadline, returnReasonLabel, returnSteps, statusLabel,
  type ReturnView, type ReturnViewer,
} from '@/lib/returns';

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export default function ReturnDetailScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { returnId } = useLocalSearchParams<{ returnId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { userId } = useAuth();

  const [view, setView] = useState<ReturnView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'network' | 'not_found' | null>(null);
  const [acting, setActing] = useState<'approve' | 'deny' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDenyForm, setShowDenyForm] = useState(false);
  const [denyReason, setDenyReason] = useState('');

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

  const viewer: ReturnViewer = view && userId && view.sellerId === userId && view.buyerId !== userId ? 'seller' : 'buyer';

  async function updateStatus(status: 'approved' | 'denied', sellerResponse?: string) {
    if (!view) return;
    setActing(status === 'approved' ? 'approve' : 'deny');
    setActionError(null);
    try {
      await api.returns.updateStatus(view.id, { status, sellerResponse });
      setShowDenyForm(false);
      setDenyReason('');
      await load();
    } catch (err) {
      const raw = (err as { body?: string } | null)?.body ?? '';
      let message = '';
      try { message = JSON.parse(raw)?.error ?? ''; } catch { message = ''; }
      setActionError(message || 'Couldn’t update this return. Check your connection and try again.');
    } finally {
      setActing(null);
    }
  }

  const header = (
    <ScreenHeader
      title={view ? `Return · #${view.orderNumber}` : 'Return'}
      subtitle={view ? (viewer === 'seller' ? view.buyerName : view.sellerName) : undefined}
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
                    step.state === 'done' && { backgroundColor: theme.text, borderColor: theme.text },
                    step.state === 'current' && { borderColor: theme.text },
                  ]}>
                    {step.state === 'done' ? <Feather name="check" size={12} color={theme.background} /> : null}
                    {step.state === 'current' ? <View style={s.dotInner} /> : null}
                  </View>
                  {i < steps.length - 1 ? <View style={[s.connector, step.state === 'done' && { backgroundColor: theme.text }]} /> : null}
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
        {viewer === 'seller' && (view.status === 'pending' || view.status === 'approved') ? (
          <BrandthreadCard>
            <Text style={s.cardTitle}>{view.status === 'pending' ? 'Your decision' : 'Refund'}</Text>
            <Text style={s.cardBody}>
              {view.status === 'pending'
                ? `Approving refunds ${formatCents(refundBasis)} to ${view.buyerName}’s original payment. Declining keeps the order as it is. Tell the buyer why.`
                : `The refund of ${formatCents(refundBasis)} hasn’t been confirmed yet. Retrying is safe: the buyer is only ever refunded once.`}
            </Text>
            {actionError ? (
              <View style={s.inlineError} accessibilityRole="alert" testID="return-action-error">
                <Feather name="alert-circle" size={14} color={theme.text} />
                <Text style={s.inlineErrorText}>{actionError}</Text>
              </View>
            ) : null}
            {!showDenyForm ? (
              <View style={s.actions}>
                <Button
                  label={view.status === 'pending' ? `Approve and refund ${formatCents(refundBasis)}` : 'Retry refund'}
                  variant="primary"
                  fullWidth
                  loading={acting === 'approve'}
                  disabled={acting !== null}
                  onPress={() => { void updateStatus('approved'); }}
                  testID="return-approve"
                />
                {view.status === 'pending' ? (
                  <Button
                    label="Decline"
                    variant="secondary"
                    fullWidth
                    disabled={acting !== null}
                    onPress={() => { setActionError(null); setShowDenyForm(true); }}
                    testID="return-decline"
                  />
                ) : null}
              </View>
            ) : (
              <View style={s.actions}>
                <Text style={s.fieldLabel}>Reason for the buyer</Text>
                <TextInput
                  style={s.input}
                  value={denyReason}
                  onChangeText={setDenyReason}
                  placeholder="e.g. The item was worn and the tags were removed."
                  placeholderTextColor={theme.subtle}
                  multiline
                  accessibilityLabel="Reason for declining"
                  testID="return-decline-reason"
                />
                <View style={s.row}>
                  <Button label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => { setShowDenyForm(false); setDenyReason(''); }} />
                  <Button
                    label="Decline return"
                    variant="primary"
                    style={{ flex: 1 }}
                    loading={acting === 'deny'}
                    disabled={!denyReason.trim() || acting !== null}
                    onPress={() => { void updateStatus('denied', denyReason.trim()); }}
                    testID="return-decline-submit"
                  />
                </View>
              </View>
            )}
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
  dotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.text },
  connector: { width: 2, flex: 1, minHeight: 16, marginVertical: 2, backgroundColor: theme.border, borderRadius: 1 },
  stepBody: { flex: 1, paddingLeft: SP.sm, paddingBottom: SP.md },
  stepLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, paddingTop: 2 },
  stepTime: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },

  cardTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, letterSpacing: 0.4, textTransform: 'uppercase', color: theme.muted, marginBottom: SP.sm },
  cardBody: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, lineHeight: 20 },
  actions: { gap: SP.sm, marginTop: SP.md },
  row: { flexDirection: 'row', gap: SP.sm },
  fieldLabel: { fontFamily: FONT.semibold, fontSize: FS.xs + 1, color: theme.muted },
  input: {
    backgroundColor: theme.cardElevated, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    padding: SP.md, minHeight: 90, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, textAlignVertical: 'top',
  },
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

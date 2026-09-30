/**
 * Brandthread Buyer Return Request
 *
 * Opened from the buyer order screen's "Request return" (delivered orders).
 * Shopee's "Request Return/Refund" flow is the model (Mobbin): the items,
 * a required reason, a description, optional photos, and the refund
 * summary; then a status screen. Etsy's help request is the model for the
 * radio lists.
 *
 * Real data path (item 108):
 *  - The order comes from GET /api/buyer/orders/:id. The buyer's existing
 *    returns come from GET /api/returns/buyer, and an open one sends them
 *    straight to its status instead of to a form the server would refuse
 *    (409).
 *  - Photos are uploaded (POST /api/returns/evidence) before
 *    POST /api/returns, so the seller can actually see them. Local device
 *    URIs are no longer sent.
 *  - The resolution is a refund to the original payment. That is the only
 *    outcome the server delivers (approving a return refunds it), so the
 *    old exchange / store-credit / replacement radios, which approving
 *    silently turned into a refund anyway, are gone.
 *  - Success opens /return-detail, the same status screen the return push
 *    and Activity rows open.
 *
 * Every state is inline: RN-web's Alert is a no-op, so errors, permission
 * denials and "already requested" are shown on the screen. Monochrome:
 * theme text / muted / border only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { createReturnRequest } from '@/services/cartService';
import { RETURN_REASON_OPTIONS, BuyerReturnReason } from '@/services/cartTypes';
import { getBuyerOrder } from '@/services/orderService';
import { BuyerOrderView } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { BrandthreadScreen, BrandthreadCard, EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { activeReturnFor, isReturnEligible, returnSubmitError } from '@/lib/returns';

const MAX_PHOTOS = 5;
const MAX_NOTES = 1000;

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeSectionStyles(theme), [theme]);
  return (
    <View style={s.root}>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      <BrandthreadCard style={{ marginTop: SP.sm }}>{children}</BrandthreadCard>
    </View>
  );
}

function makeSectionStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { marginBottom: SP.md },
    title: { fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.4, textTransform: 'uppercase', color: theme.muted },
    subtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: 2 },
  });
}

function RadioRow({ label, selected, onPress, isLast }: { label: string; selected: boolean; onPress: () => void; isLast?: boolean }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeRadioStyles(theme), [theme]);
  return (
    <TouchableOpacity
      style={[s.row, !isLast && s.rowBorder]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={[s.radio, selected && s.radioSelected]}>
        {selected && <View style={s.radioDot} />}
      </View>
      <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeRadioStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 44, paddingVertical: SP.xs },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
    radioSelected: { borderColor: theme.text },
    radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.accent },
    label: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, flex: 1 },
    labelSelected: { color: theme.text, fontFamily: FONT.semibold },
  });
}

type Phase = 'loading' | 'error' | 'ineligible' | 'existing' | 'form' | 'submitted';

export default function BuyerReturnRequestScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [phase, setPhase] = useState<Phase>('loading');
  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [existingReturnId, setExistingReturnId] = useState<string | null>(null);
  const [createdReturnId, setCreatedReturnId] = useState<string | null>(null);
  const [reason, setReason] = useState<BuyerReturnReason | ''>('');
  const [description, setDescription] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) { setPhase('error'); return; }
    setPhase('loading');
    try {
      const [loaded, existing] = await Promise.all([
        getBuyerOrder(orderId),
        api.returns.listBuyer().then(rows => activeReturnFor(Array.isArray(rows) ? rows : [], orderId)).catch(() => null),
      ]);
      if (!loaded) { setPhase('error'); return; }
      setOrder(loaded);
      if (existing?.id) { setExistingReturnId(existing.id); setPhase('existing'); return; }
      setPhase(isReturnEligible(loaded.status) ? 'form' : 'ineligible');
    } catch {
      setPhase('error');
    }
  }, [api, orderId]);

  useEffect(() => { void load(); }, [load]);

  async function pickEvidence() {
    setPhotoNotice(null);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setPhotoNotice('Allow photo access in Settings to add photos. You can still send the request without them.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: MAX_PHOTOS - evidencePhotos.length,
      });
      if (!result.canceled) {
        setEvidencePhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, MAX_PHOTOS));
      }
    } catch {
      setPhotoNotice('Couldn’t open your photos. Try again.');
    }
  }

  const reasonMissing = !reason;
  const descriptionMissing = description.trim().length === 0;

  async function handleSubmit() {
    setAttempted(true);
    if (!order || reasonMissing || descriptionMissing || submitting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createReturnRequest({
        orderId: order.id,
        orderNumber: order.orderNumber,
        sellerName: order.sellerName,
        items: order.lineItems.map((item, idx) => ({
          lineItemId: `item_${idx}`,
          productName: item.productName,
          variantTitle: item.variant,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          reason: reason as BuyerReturnReason,
        })),
        reason: reason as BuyerReturnReason,
        description: description.trim(),
        imageUris: evidencePhotos,
        preferredResolution: 'refund',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCreatedReturnId(created.id);
      setPhase('submitted');
    } catch (error) {
      const { message, alreadyExists } = returnSubmitError(error);
      if (alreadyExists) { void load(); return; }
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <ScreenHeader
      title="Request a return"
      onBack={() => goBackOr(router)}
    />
  );

  if (phase === 'loading') {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <View style={s.centered}><ActivityIndicator color={theme.text} size="large" /></View>
      </BrandthreadScreen>
    );
  }

  if (phase === 'error') {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <EmptyState
          icon="wifi-off"
          title="Couldn’t load this order"
          description="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => { void load(); } }}
        />
      </BrandthreadScreen>
    );
  }

  if (phase === 'ineligible') {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <EmptyState
          icon="package"
          title="Returns open after delivery"
          description="Once your order is delivered you can ask the seller for a return here."
          action={{ label: 'Back to order', onPress: () => goBackOr(router) }}
        />
      </BrandthreadScreen>
    );
  }

  if (phase === 'existing' && existingReturnId) {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <EmptyState
          icon="rotate-ccw"
          title="You already requested a return"
          description="There’s an open return for this order. Follow its status there."
          action={{ label: 'View return', onPress: () => router.replace(`/return-detail?returnId=${encodeURIComponent(existingReturnId)}` as never) }}
          secondaryAction={{ label: 'Back to order', onPress: () => goBackOr(router) }}
        />
      </BrandthreadScreen>
    );
  }

  if (phase === 'submitted') {
    return (
      <BrandthreadScreen noSafeTop>
        {header}
        <View style={s.successWrap} testID="return-request-submitted">
          <View style={s.successIcon}>
            <Feather name="check" size={32} color="#FFFFFF" />
          </View>
          <Text style={s.successTitle}>Return requested</Text>
          <Text style={s.successSub}>
            {order?.sellerName ?? 'The seller'} usually replies within 1–3 business days. We’ll notify you as soon as they do. Don’t ship anything until your return is approved.
          </Text>
          {createdReturnId ? (
            <Button
              label="View return status"
              variant="primary"
              fullWidth
              style={{ marginTop: SP.md }}
              onPress={() => router.replace(`/return-detail?returnId=${encodeURIComponent(createdReturnId)}` as never)}
              testID="return-view-status"
            />
          ) : null}
          <Button label="Back to order" variant="secondary" fullWidth style={{ marginTop: SP.sm }} onPress={() => goBackOr(router)} />
        </View>
      </BrandthreadScreen>
    );
  }

  const items = order?.lineItems ?? [];
  const itemsTotal = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
  const returnDeadline = order?.createdAt ? new Date(new Date(order.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : '';

  return (
    <BrandthreadScreen noSafeTop noSafeBottom>
      {header}
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + 120 }}
      >
        <Section title="Items">
          {items.map((item, idx) => (
            <View key={idx} style={[s.itemRow, idx > 0 && s.itemBorder]}>
              <View style={s.itemThumb}>
                {item.imageUri ? (
                  <Image source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : (
                  <Feather name="package" size={16} color={theme.subtle} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>{item.productName}</Text>
                <Text style={s.itemVariant}>{[item.variant, `×${item.quantity}`].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={s.itemPrice}>{formatCents(item.unitPriceCents * item.quantity)}</Text>
            </View>
          ))}
        </Section>

        <Section title="Why are you returning it?">
          {RETURN_REASON_OPTIONS.map((opt, idx) => (
            <RadioRow
              key={opt.key}
              label={opt.label}
              selected={reason === opt.key}
              onPress={() => { Haptics.selectionAsync(); setReason(opt.key); }}
              isLast={idx === RETURN_REASON_OPTIONS.length - 1}
            />
          ))}
        </Section>
        {attempted && reasonMissing ? <Text style={s.fieldError}>Choose a reason.</Text> : null}

        <Section title="Tell the seller what happened">
          <TextInput
            style={[s.textarea, attempted && descriptionMissing && { borderColor: theme.text }]}
            value={description}
            onChangeText={text => setDescription(text.slice(0, MAX_NOTES))}
            placeholder="What’s wrong with the item? Details help the seller decide faster."
            placeholderTextColor={theme.subtle}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            accessibilityLabel="Describe the problem"
            testID="return-description"
          />
          <Text style={s.counter}>{description.length}/{MAX_NOTES}</Text>
        </Section>
        {attempted && descriptionMissing ? <Text style={s.fieldError}>Describe the problem so the seller can review it.</Text> : null}

        <Section title="Photos" subtitle={`Optional, up to ${MAX_PHOTOS}. Show the problem and the label or tags.`}>
          <View style={s.photoGrid}>
            {evidencePhotos.map((uri, idx) => (
              <View key={`${uri}-${idx}`} style={s.photoCell}>
                <Image source={{ uri }} style={s.evidenceThumb} accessibilityLabel={`Photo ${idx + 1}`} />
                <TouchableOpacity
                  onPress={() => setEvidencePhotos(prev => prev.filter((_, i) => i !== idx))}
                  style={s.evidenceRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${idx + 1}`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={12} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ))}
            {evidencePhotos.length < MAX_PHOTOS ? (
              <TouchableOpacity style={s.addPhotoBtn} onPress={pickEvidence} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Add photos">
                <Feather name="camera" size={18} color={theme.text} />
                <Text style={s.addPhotoText}>Add photo</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {photoNotice ? <Text style={s.photoNotice}>{photoNotice}</Text> : null}
        </Section>

        <Section title="Refund">
          <View style={s.summaryRow}>
            <Feather name="credit-card" size={ICON.sm} color={theme.muted} />
            <View style={{ flex: 1 }}>
              <Text style={s.summaryTitle}>Refund to your original payment</Text>
              <Text style={s.summarySub}>Up to {formatCents(itemsTotal)} for these items. The seller confirms the amount.</Text>
            </View>
          </View>
          {returnDeadline ? (
            <View style={[s.summaryRow, { marginTop: SP.sm }]}>
              <Feather name="calendar" size={ICON.sm} color={theme.muted} />
              <Text style={[s.summarySub, { flex: 1, marginTop: 0 }]}>30-day return window · request by {fmtDate(returnDeadline)}</Text>
            </View>
          ) : null}
        </Section>

        <Text style={s.disclaimer}>
          The seller reviews every request. Don’t ship anything until your return is approved.
        </Text>
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
        {submitError ? (
          <View style={s.submitError} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="return-submit-error">
            <Feather name="alert-circle" size={14} color={theme.text} />
            <Text style={s.submitErrorText}>{submitError}</Text>
          </View>
        ) : null}
        <Button
          label={submitting ? (evidencePhotos.length > 0 ? 'Uploading photos…' : 'Sending…') : 'Send return request'}
          variant="primary"
          fullWidth
          loading={submitting}
          disabled={submitting}
          onPress={handleSubmit}
          testID="return-submit"
        />
      </View>
    </BrandthreadScreen>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  itemThumb: {
    width: 44, height: 55, borderRadius: RADIUS.sm, overflow: 'hidden',
    backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.border,
  },
  itemName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  itemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  itemPrice: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },

  fieldError: { fontSize: FS.xs + 1, fontFamily: FONT.medium, color: theme.text, marginTop: -SP.sm, marginBottom: SP.md },

  textarea: {
    minHeight: 110, backgroundColor: theme.cardElevated, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: theme.border, padding: SP.md,
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 20,
  },
  counter: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'right', marginTop: 6 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  photoCell: { width: 72, height: 72 },
  evidenceThumb: { width: 72, height: 72, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border },
  evidenceRemove: {
    position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },
  addPhotoBtn: {
    width: 72, height: 72, borderRadius: RADIUS.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: theme.cardElevated,
  },
  addPhotoText: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.text },
  photoNotice: { fontFamily: FONT.regular, fontSize: FS.xs + 1, color: theme.muted, marginTop: SP.sm, lineHeight: 18 },

  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  summaryTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  summarySub: { fontSize: FS.xs + 1, fontFamily: FONT.regular, color: theme.muted, marginTop: 2, lineHeight: 18 },

  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', lineHeight: 17, marginBottom: SP.lg },

  bottomBar: { paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: theme.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, gap: SP.sm },
  submitError: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  submitErrorText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.xs + 1, color: theme.text, lineHeight: 18 },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl },
  successIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: theme.cardElevated,
    borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md,
  },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, marginBottom: SP.sm, textAlign: 'center' },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 22, marginBottom: SP.sm },
});

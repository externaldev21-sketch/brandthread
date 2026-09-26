/**
 * Brandthread Buyer Return Request
 * Eligible items, reason, resolution, evidence, submit.
 *
 * Rebuilt to read every color off the active theme (useAppTheme) instead of
 * the static dark-mode-only constants the old version imported directly from
 * lib/theme — this screen previously never re-skinned across the app's 12
 * themes. Structure follows the same header/card language as
 * buyer-order-detail.tsx (BrandthreadHeader + SectionCard-style grouped
 * cards) so the buyer's order → return path reads as one continuous flow
 * rather than two different apps, and borrows the radio-list treatment for
 * reason/resolution seen on SHEIN, Etsy and Meta Quest return/refund flows.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { createReturnRequest } from '@/services/cartService';
import { RETURN_REASON_OPTIONS, BuyerReturnReason, BuyerReturnResolution } from '@/services/cartTypes';
import { getBuyerOrder } from '@/services/orderService';
import { BuyerOrderView } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';
import { BrandthreadScreen, BrandthreadHeader, BrandthreadCard, PrimaryButton } from '@/components/BrandthreadUI';

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

const RESOLUTIONS: { key: BuyerReturnResolution; label: string; description: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'refund',       label: 'Refund to original payment', description: 'Usually available within 5–10 business days', icon: 'credit-card' },
  { key: 'exchange',     label: 'Exchange for another size/color', description: 'Seller confirms availability first', icon: 'refresh-cw' },
  { key: 'store_credit', label: 'Store credit',                description: 'Available immediately once approved', icon: 'gift' },
  { key: 'replacement',  label: 'Replacement item',            description: 'Seller ships a new unit', icon: 'package' },
];

// ─── Section wrapper — mirrors buyer-order-detail's SectionCard so both
// screens in this flow read as one visual language ────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeSectionStyles(theme), [theme]);
  return (
    <View style={s.root}>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      <BrandthreadCard style={{ marginTop: subtitle ? SP.sm : SP.sm }}>{children}</BrandthreadCard>
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

// ─── Radio row — reused for both reason and resolution lists ──────────────
function RadioRow({
  label, description, icon, selected, onPress, isLast,
}: {
  label: string; description?: string; icon?: keyof typeof Feather.glyphMap;
  selected: boolean; onPress: () => void; isLast?: boolean;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeRadioStyles(theme), [theme]);
  return (
    <TouchableOpacity
      style={[s.row, !isLast && s.rowBorder]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={[s.radio, selected && s.radioSelected]}>
        {selected && <View style={s.radioDot} />}
      </View>
      {icon && <Feather name={icon} size={ICON.sm} color={selected ? theme.accent : theme.muted} />}
      <View style={{ flex: 1 }}>
        <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function makeRadioStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.border },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
    radioSelected: { borderColor: theme.accent },
    radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.accent },
    label: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, flex: 1 },
    labelSelected: { color: theme.text, fontFamily: FONT.semibold },
    description: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: 1 },
  });
}

export default function BuyerReturnRequestScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<BuyerReturnReason | ''>('');
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState<BuyerReturnResolution>('refund');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);

  async function pickEvidence() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission required', 'Allow photo library access to add evidence.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: 5,
    });
    if (!result.canceled) {
      const uris = result.assets.map(a => a.uri);
      setEvidencePhotos(prev => [...prev, ...uris].slice(0, 5));
    }
  }

  useEffect(() => {
    if (!orderId) return;
    getBuyerOrder(orderId).then(o => {
      setOrder(o ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orderId]);

  async function handleSubmit() {
    if (!reason) { Alert.alert('Select Reason', 'Please select a return reason.'); return; }
    if (!description.trim()) { Alert.alert('Add Description', 'Please describe the issue.'); return; }
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      await createReturnRequest({
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
        preferredResolution: resolution,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch {
      Alert.alert('Error', 'Could not submit your return request. Please try again.');
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Request Return" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </BrandthreadScreen>
    );
  }

  if (submitted) {
    return (
      <BrandthreadScreen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
          <View style={s.successIcon}>
            <Feather name="check" size={32} color={theme.onAccent} />
          </View>
          <Text style={s.successTitle}>Return Request Submitted</Text>
          <Text style={s.successSub}>Your request has been received. The seller will review it and respond within 1–3 business days.</Text>
          <Text style={s.successNote}>Return requests will appear here once confirmed.</Text>
          <PrimaryButton label="Back to Order" onPress={() => router.back()} style={{ width: '100%', marginTop: SP.md }} />
        </View>
      </BrandthreadScreen>
    );
  }

  const refundEstimateCents = order?.lineItems.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0) ?? 0;
  const returnDeadline = order?.createdAt ? new Date(new Date(order.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : '';
  const canSubmit = !!reason && description.trim().length > 0 && !submitting;

  return (
    <BrandthreadScreen noSafeBottom>
      <BrandthreadHeader
        title="Request Return"
        subtitle={order ? `${order.orderNumber} · ${order.sellerName}` : undefined}
        onBack={() => router.back()}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + 100 }}>
        {/* Policy banner */}
        <View style={s.policyCard}>
          <View style={s.policyRow}>
            <Feather name="refresh-ccw" size={13} color={theme.accentLight} />
            <Text style={s.policyText}>30-day return window · Return by {returnDeadline ? fmtDate(returnDeadline) : '30 days from purchase'}</Text>
          </View>
          <View style={s.policyRow}>
            <Feather name="dollar-sign" size={13} color={theme.success} />
            <Text style={s.policyText}>Estimated refund: {formatCents(refundEstimateCents)}</Text>
          </View>
          <Text style={s.policyNote}>Refunds are subject to seller review. Approved amounts may differ from estimates.</Text>
        </View>

        {/* Items */}
        {order && (
          <Section title="Eligible Items">
            {order.lineItems.map((item, idx) => (
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
                  <Text style={s.itemVariant}>{item.variant} · ×{item.quantity}</Text>
                </View>
                <Text style={s.itemPrice}>{formatCents(item.unitPriceCents * item.quantity)}</Text>
              </View>
            ))}
          </Section>
        )}

        {/* Return reason */}
        <Section title="Return Reason">
          {RETURN_REASON_OPTIONS.map((opt, idx) => (
            <RadioRow
              key={opt.key}
              label={opt.label}
              selected={reason === opt.key}
              onPress={() => setReason(opt.key)}
              isLast={idx === RETURN_REASON_OPTIONS.length - 1}
            />
          ))}
        </Section>

        {/* Description */}
        <Section title="Describe the Issue">
          <TextInput
            style={s.textarea}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened in as much detail as possible…"
            placeholderTextColor={theme.subtle}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </Section>

        {/* Evidence photos */}
        <Section title="Evidence Photos" subtitle="Add up to 5 photos showing the issue (optional).">
          {evidencePhotos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SP.sm }}>
              {evidencePhotos.map((uri, idx) => (
                <TouchableOpacity key={idx} onPress={() => setEvidencePhotos(prev => prev.filter((_, i) => i !== idx))} activeOpacity={0.8}>
                  <Image source={{ uri }} style={s.evidenceThumb} />
                  <View style={s.evidenceRemove}>
                    <Feather name="x" size={10} color={theme.onAccent} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {evidencePhotos.length < 5 && (
            <TouchableOpacity style={s.addPhotoBtn} onPress={pickEvidence} activeOpacity={0.8}>
              <Feather name="camera" size={15} color={theme.accentLight} />
              <Text style={s.addPhotoText}>Add photos</Text>
            </TouchableOpacity>
          )}
        </Section>

        {/* Preferred resolution */}
        <Section title="Preferred Resolution">
          {RESOLUTIONS.map((r, idx) => (
            <RadioRow
              key={r.key}
              label={r.label}
              description={r.description}
              icon={r.icon}
              selected={resolution === r.key}
              onPress={() => setResolution(r.key)}
              isLast={idx === RESOLUTIONS.length - 1}
            />
          ))}
        </Section>

        <Text style={s.disclaimer}>
          Submitting a return request does not guarantee approval. The seller will review your request and respond within 1–3 business days. Do not ship items before receiving return instructions.
        </Text>
      </ScrollView>

      {/* Submit bar */}
      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, SP.sm) }]}>
        <PrimaryButton label="Submit Return Request" onPress={handleSubmit} loading={submitting} disabled={!canSubmit} />
      </View>
    </BrandthreadScreen>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  policyCard: {
    backgroundColor: theme.accentDim, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: `${theme.accent}73`, padding: SP.md, marginBottom: SP.md, gap: 6,
  },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  policyText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.text, flex: 1 },
  policyNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: 4, lineHeight: 16 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  itemBorder: { borderTopWidth: 1, borderTopColor: theme.border },
  itemThumb: {
    width: 44, height: 44, borderRadius: RADIUS.sm, overflow: 'hidden',
    backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.border,
  },
  itemName: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  itemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  itemPrice: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },

  textarea: {
    minHeight: 100, backgroundColor: theme.cardElevated, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: theme.border, padding: SP.md,
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 20,
  },

  evidenceThumb: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  evidenceRemove: {
    position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center',
  },
  addPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: theme.cardElevated, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border,
    alignSelf: 'flex-start',
  },
  addPhotoText: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.accentLight },

  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', lineHeight: 17, marginBottom: SP.lg },

  bottomBar: { paddingHorizontal: SP.md, paddingTop: SP.md, backgroundColor: theme.background, borderTopWidth: 1, borderTopColor: theme.border },

  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: theme.success, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, marginBottom: SP.sm, textAlign: 'center' },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 22, marginBottom: SP.sm },
  successNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', marginBottom: SP.lg },
});

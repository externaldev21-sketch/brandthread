import { MEDIA } from '@/lib/theme';
/**
 * Brandthread Buyer Refund Request
 */
import React, { useState, useEffect } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, Image, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { createRefundRequest } from '@/services/cartService';
import { getBuyerOrder } from '@/services/orderService';
import { BuyerOrderView } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE,
  SUCCESS, ON_DARK,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, COMP,
} from '@/lib/theme';
import { EmptyState, PrimaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

const REFUND_REASONS = [
  'Order not received',
  'Item damaged',
  'Item not as described',
  'Wrong item sent',
  'Seller cancelled order',
  'Pre-order not fulfilled',
  'Other',
];

export default function BuyerRefundRequestScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = colors.accent;
  const BORDER_ACTIVE = `${theme.accent}73`;
  const s = makeStyles(theme);
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);

  async function pickEvidence() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow access to your photo library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setEvidencePhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 5));
    }
  }

  useEffect(() => {
    if (isMissingParam(orderId)) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setLoadError(false);
    getBuyerOrder(orderId).then(o => {
      if (!active) return;
      setOrder(o ?? null);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [orderId, reloadKey]);

  const totalCents = order?.payment.totalCents ?? 0;

  async function handleSubmit() {
    if (!reason) { Alert.alert('Select Reason', 'Please select a refund reason.'); return; }
    if (!description.trim()) { Alert.alert('Add Details', 'Please describe why you are requesting a refund.'); return; }
    if (!order) return;
    setSubmitting(true);
    try {
      await createRefundRequest({
        orderId: order.id,
        orderNumber: order.orderNumber,
        sellerName: order.sellerName,
        reason,
        description: description.trim(),
        evidenceUris: evidencePhotos,
        maxRefundAmount: totalCents,
      });
      haptics.success();
      setSubmitted(true);
    } catch {
      Alert.alert('Error', 'Could not submit your refund request. Please try again.');
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <ScreenHeader title="Request refund" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={PURPLE} size="large" /></View>
      </View>
    );
  }

  // Without the order there is nothing to refund, so never show the form
  // (Submit used to return silently when the order hadn't loaded).
  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <ScreenHeader title="Request Refund" />
        {loadError ? (
          <EmptyState
            icon="wifi-off"
            title="Couldn't load this order"
            description="Check your connection and try again."
            action={{ label: 'Try again', onPress: () => setReloadKey(k => k + 1) }}
          />
        ) : (
          <EmptyState
            icon="alert-circle"
            title="Order not found"
            description="This link doesn't point to one of your orders."
            action={{ label: 'Go back', onPress: () => goBackOr(router) }}
          />
        )}
      </View>
    );
  }

  if (submitted) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <ScreenHeader title="Request refund" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
          <View style={s.successIcon}><Icon name="check" size={32} color={MEDIA.foreground} /></View>
          <Text style={s.successTitle}>Refund Request Submitted</Text>
          <Text style={s.successSub}>Your request is under review. Refunds are not automatic — the seller or payment provider must confirm.</Text>
          <Text style={s.successNote}>Refund updates will appear here.</Text>
          <PrimaryButton label="Back to Order" onPress={() => goBackOr(router)} style={s.doneBtn} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScreenHeader
        title="Request refund"
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + 100 }}>
        {/* Max refund */}
        <View style={s.maxCard}>
          <Text style={s.maxLabel}>Maximum possible refund</Text>
          <Text style={s.maxAmount}>{formatCents(totalCents)}</Text>
          <Text style={s.maxNote}>Actual refund amount is subject to seller and payment provider review. Refunds are not guaranteed until confirmed.</Text>
        </View>

        {/* Order */}
        {order && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Order Items</Text>
            {order.lineItems.map((item, idx) => (
              <View key={idx} style={[s.itemRow, idx > 0 && s.itemBorder]}>
                <Icon name="package" size={14} color={MUTED} />
                <View style={{ flex: 1 }}>
                  <Text style={s.itemName}>{item.productName}</Text>
                  <Text style={s.itemVariant}>{item.variant} · ×{item.quantity}</Text>
                </View>
                <Text style={s.itemPrice}>{formatCents(item.unitPriceCents * item.quantity)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Reason */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Refund Reason</Text>
          {REFUND_REASONS.map(r => (
            <TouchableOpacity key={r} style={s.optionRow} onPress={() => { haptics.selection(); setReason(r); }} activeOpacity={0.7}>
              <View style={[s.radio, reason === r && s.radioSelected]}>
                {reason === r && <View style={s.radioDot} />}
              </View>
              <Text style={[s.optionLabel, reason === r && { color: colors.foreground }]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Details */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Details</Text>
          <TextInput
            style={s.textarea}
            value={description}
            onChangeText={setDescription}
            placeholder="Provide as much detail as possible to support your request…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>

        {/* Evidence photos */}
        <TouchableOpacity
          style={[s.evidenceNote, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderStyle: 'dashed' }]}
          onPress={pickEvidence}
          activeOpacity={0.8}
        >
          <Icon name="camera" size={16} color={PURPLE_LIGHT} />
          <Text style={[s.evidenceNoteText, { color: PURPLE_LIGHT }]}>
            Add photo evidence ({evidencePhotos.length}/5)
          </Text>
        </TouchableOpacity>
        {evidencePhotos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {evidencePhotos.map((uri, idx) => (
                <View key={idx} style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 72, height: 72 }} resizeMode="cover" />
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove photo"
                    style={{ position: 'absolute', top: 2, right: 2, backgroundColor: `${MEDIA.background}99`, borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setEvidencePhotos(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <Icon name="x" size={10} color={MEDIA.foreground} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        <Text style={s.disclaimer}>
          Submitting a refund request does not guarantee approval. Do not claim a refund is approved until the seller or payment provider confirms it.
        </Text>
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + SP.sm }]}>
        <PrimaryButton label="Submit Refund Request" onPress={handleSubmit} loading={submitting} disabled={submitting} />
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim, BORDER_ACTIVE = `${theme.accent}73`;
  return StyleSheet.create({
  card: { backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md },
  sectionTitle: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  maxCard: { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER_ACTIVE, padding: SP.md, marginBottom: SP.md },
  maxLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, marginBottom: 4 },
  maxAmount: { fontSize: FS.xxl, fontFamily: FONT.bold, color: theme.text, marginBottom: 4 },
  maxNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 16 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 6 },
  itemBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  itemName: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  itemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  itemPrice: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: PURPLE },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  textarea: { minHeight: 100, backgroundColor: theme.cardElevated, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 20 },
  evidenceNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, padding: SP.sm, marginBottom: SP.md },
  evidenceNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, flex: 1 },
  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', lineHeight: 17, marginBottom: SP.lg },
  bottomBar: { paddingHorizontal: SP.md, paddingTop: SP.md, backgroundColor: theme.background, borderTopWidth: 1, borderTopColor: BORDER },
  submitBtn: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  submitGrad: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.onAccent },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, marginBottom: SP.sm },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: SP.sm },
  successNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginBottom: SP.lg },
  doneBtn: { width: '100%', borderRadius: RADIUS.lg, overflow: 'hidden' },
  doneBtnGrad: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.onAccent },
  });
};

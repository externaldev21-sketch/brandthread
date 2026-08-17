/**
 * Brandthread Buyer Return Request
 * Eligible items, reason, resolution, evidence, submit.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { createReturnRequest } from '@/services/cartService';
import { RETURN_REASON_OPTIONS, BuyerReturnReason, BuyerReturnResolution } from '@/services/cartTypes';
import { getBuyerOrder } from '@/services/orderService';
import { BuyerOrderView } from '@/services/orderTypes';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  SUCCESS,
  RED, RED_DIM,
  GRAD_PRIMARY,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

const RESOLUTIONS: { key: BuyerReturnResolution; label: string; icon: string }[] = [
  { key: 'refund',       label: 'Refund to original payment',  icon: 'credit-card' },
  { key: 'exchange',     label: 'Exchange for another size/color', icon: 'refresh-cw' },
  { key: 'store_credit', label: 'Store credit',                icon: 'gift' },
  { key: 'replacement',  label: 'Replacement item',            icon: 'package' },
];

export default function BuyerReturnRequestScreen() {
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
      mediaTypes: ImagePicker.MediaType.IMAGE,
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
          unitPrice: item.unitPrice,
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
    return <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }

  if (submitted) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
        <View style={s.successIcon}>
          <Feather name="check" size={32} color={ON_DARK} />
        </View>
        <Text style={s.successTitle}>Return Request Submitted</Text>
        <Text style={s.successSub}>Your request has been received. The seller will review it and respond within 1–3 business days.</Text>
        <Text style={s.successNote}>Return requests will appear here once confirmed.</Text>
        <TouchableOpacity style={s.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.doneBtnGrad}>
            <Text style={s.doneBtnText}>Back to Order</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  const refundEstimate = order?.lineItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0) ?? 0;
  const returnDeadline = order?.createdAt ? new Date(new Date(order.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() : '';

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Request Return</Text>
          {order && <Text style={s.headerSub}>{order.orderNumber} · {order.sellerName}</Text>}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + 100 }}>
        {/* Policy info */}
        <View style={s.policyCard}>
          <View style={s.policyRow}><Feather name="refresh-ccw" size={13} color={PURPLE_LIGHT} /><Text style={s.policyText}>30-day return window · Return deadline: {returnDeadline ? fmtDate(returnDeadline) : '30 days from purchase'}</Text></View>
          <View style={s.policyRow}><Feather name="dollar-sign" size={13} color={SUCCESS} /><Text style={s.policyText}>Estimated refund: ${refundEstimate.toFixed(2)}</Text></View>
          <Text style={s.policyNote}>Refunds are subject to seller review. Approved amounts may differ from estimates.</Text>
        </View>

        {/* Items */}
        {order && (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Eligible Items</Text>
            {order.lineItems.map((item, idx) => (
              <View key={idx} style={[s.itemRow, idx > 0 && s.itemBorder]}>
                <Feather name="package" size={14} color={MUTED} />
                <View style={{ flex: 1 }}>
                  <Text style={s.itemName}>{item.productName}</Text>
                  <Text style={s.itemVariant}>{item.variant} · ×{item.quantity}</Text>
                </View>
                <Text style={s.itemPrice}>${(item.unitPrice * item.quantity).toFixed(2)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Return reason */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Return Reason</Text>
          {RETURN_REASON_OPTIONS.map(opt => (
            <TouchableOpacity key={opt.key} style={s.optionRow} onPress={() => { Haptics.selectionAsync(); setReason(opt.key); }} activeOpacity={0.7}>
              <View style={[s.radio, reason === opt.key && s.radioSelected]}>
                {reason === opt.key && <View style={s.radioDot} />}
              </View>
              <Text style={[s.optionLabel, reason === opt.key && { color: FG }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Description */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Describe the Issue</Text>
          <TextInput
            style={s.textarea}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened in as much detail as possible…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>

        {/* Evidence photos */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Evidence Photos</Text>
          <Text style={[s.sectionTitle, { fontFamily: FONT.regular, color: MUTED, fontSize: FS.xs, marginBottom: SP.sm }]}>
            Add up to 5 photos showing the issue (optional).
          </Text>
          {evidencePhotos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SP.sm }}>
              {evidencePhotos.map((uri, idx) => (
                <TouchableOpacity key={idx} onPress={() => setEvidencePhotos(prev => prev.filter((_, i) => i !== idx))} activeOpacity={0.8}>
                  <Image source={{ uri }} style={{ width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderColor: BORDER }} />
                  <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="x" size={10} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {evidencePhotos.length < 5 && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignSelf: 'flex-start' }}
              onPress={pickEvidence}
              activeOpacity={0.8}
            >
              <Feather name="camera" size={15} color={PURPLE_LIGHT} />
              <Text style={{ fontFamily: FONT.medium, fontSize: FS.sm, color: PURPLE_LIGHT }}>Add photos</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Preferred resolution */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Preferred Resolution</Text>
          {RESOLUTIONS.map(r => (
            <TouchableOpacity key={r.key} style={s.optionRow} onPress={() => { Haptics.selectionAsync(); setResolution(r.key); }} activeOpacity={0.7}>
              <View style={[s.radio, resolution === r.key && s.radioSelected]}>
                {resolution === r.key && <View style={s.radioDot} />}
              </View>
              <Feather name={r.icon as any} size={14} color={resolution === r.key ? PURPLE_LIGHT : MUTED} />
              <Text style={[s.optionLabel, resolution === r.key && { color: FG }]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.disclaimer}>
          Submitting a return request does not guarantee approval. The seller will review your request and respond within 1–3 business days. Do not ship items before receiving return instructions.
        </Text>
      </ScrollView>

      {/* Submit bar */}
      <View style={[s.bottomBar, { paddingBottom: insets.bottom + SP.sm }]}>
        <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} activeOpacity={0.88} disabled={submitting}>
          <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.submitGrad}>
            {submitting ? <ActivityIndicator color={ON_DARK} size="small" /> : <Text style={s.submitText}>Submit Return Request</Text>}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  headerSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md },
  sectionTitle: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  policyCard: { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER_ACTIVE, padding: SP.md, marginBottom: SP.md, gap: 6 },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  policyText: { fontSize: FS.xs, fontFamily: FONT.medium, color: FG, flex: 1 },
  policyNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 4, lineHeight: 16 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 6 },
  itemBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  itemName: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  itemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  itemPrice: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 8 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: PURPLE },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, flex: 1 },
  textarea: {
    minHeight: 100, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, padding: SP.md,
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20,
  },
  evidenceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, padding: SP.sm, marginBottom: SP.md },
  evidenceNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, flex: 1, lineHeight: 17 },
  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', lineHeight: 17, marginBottom: SP.lg },
  bottomBar: { paddingHorizontal: SP.md, paddingTop: SP.md, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  submitBtn: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  submitGrad: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: SP.sm },
  successNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginBottom: SP.lg },
  doneBtn: { width: '100%', borderRadius: RADIUS.lg, overflow: 'hidden' },
  doneBtnGrad: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK },
});

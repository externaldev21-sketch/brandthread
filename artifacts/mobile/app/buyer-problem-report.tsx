/**
 * Brandthread Buyer Problem Report
 * Issue type, description, evidence, contact seller, escalate.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, Switch, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { createProblemReport } from '@/services/cartService';
import { PROBLEM_TYPE_OPTIONS, BuyerProblemType } from '@/services/cartTypes';
import { getBuyerOrder } from '@/services/orderService';
import { BuyerOrderView } from '@/services/orderTypes';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, ON_DARK,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GRAD_PRIMARY,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';

export default function BuyerProblemReportScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [problemType, setProblemType] = useState<BuyerProblemType | ''>('');
  const [description, setDescription] = useState('');
  const [contactedSeller, setContactedSeller] = useState(false);
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
    if (!orderId) return;
    getBuyerOrder(orderId).then(o => {
      setOrder(o ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orderId]);

  async function handleSubmit() {
    if (!problemType) { Alert.alert('Select Issue Type', 'Please select what kind of problem you experienced.'); return; }
    if (!description.trim()) { Alert.alert('Add Details', 'Please describe the problem.'); return; }
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      await createProblemReport({
        orderId: order.id,
        orderNumber: order.orderNumber,
        type: problemType as BuyerProblemType,
        description: description.trim(),
        evidenceUris: [],
        contactedSeller,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch {
      Alert.alert('Error', 'Could not submit your report. Please try again.');
    }
    setSubmitting(false);
  }

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }

  if (submitted) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
        <View style={s.successIcon}><Feather name="check" size={32} color={ON_DARK} /></View>
        <Text style={s.successTitle}>Report Submitted</Text>
        <Text style={s.successSub}>Your problem report has been received. Our team will review it and reach out if needed.</Text>
        <TouchableOpacity style={s.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.doneBtnGrad}>
            <Text style={s.doneBtnText}>Back to Order</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Report a Problem</Text>
          {order && <Text style={s.headerSub}>{order.orderNumber} · {order.sellerName}</Text>}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + 100 }}>
        {/* Issue type */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>What's the issue?</Text>
          <View style={s.typeGrid}>
            {PROBLEM_TYPE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[s.typeCard, problemType === opt.key && s.typeCardSelected]}
                onPress={() => { Haptics.selectionAsync(); setProblemType(opt.key); }}
                activeOpacity={0.8}
              >
                <Feather name={opt.icon as any} size={20} color={problemType === opt.key ? PURPLE_LIGHT : MUTED} />
                <Text style={[s.typeLabel, problemType === opt.key && { color: FG }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Description */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Describe the Problem</Text>
          <TextInput
            style={s.textarea}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what happened. Include relevant dates, photos (when available), and any communication with the seller…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        {/* Evidence note */}
        {/* Evidence photos */}
        <TouchableOpacity
          style={[s.evidenceNote, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderStyle: 'dashed' }]}
          onPress={pickEvidence}
          activeOpacity={0.8}
        >
          <Feather name="camera" size={16} color={PURPLE_LIGHT} />
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
                  <TouchableOpacity
                    style={{ position: 'absolute', top: 2, right: 2, backgroundColor: '#00000099', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setEvidencePhotos(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <Feather name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Contacted seller */}
        <View style={s.card}>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Contacted the Seller</Text>
              <Text style={s.switchSub}>Have you already reached out to the seller about this issue?</Text>
            </View>
            <Switch
              value={contactedSeller}
              onValueChange={setContactedSeller}
              trackColor={{ true: PURPLE, false: BORDER }}
              thumbColor={FG}
            />
          </View>
          {!contactedSeller && (
            <TouchableOpacity
              style={s.contactBtn}
              onPress={() => router.push('/inbox' as never)}
              activeOpacity={0.8}
            >
              <Feather name="message-circle" size={14} color={PURPLE_LIGHT} />
              <Text style={s.contactBtnText}>Message Seller First</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Dispute note */}
        <View style={s.disputeNote}>
          <Feather name="info" size={13} color={ORANGE} />
          <Text style={s.disputeNoteText}>
            If the seller doesn't resolve your issue, your report may escalate to a dispute. We will contact you if further information is needed.
          </Text>
        </View>

        <Text style={s.disclaimer}>
          Submitting a problem report opens an investigation. Do not fabricate claims or evidence. Fraudulent reports may result in account action.
        </Text>
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + SP.sm }]}>
        <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} activeOpacity={0.88} disabled={submitting}>
          <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.submitGrad}>
            {submitting ? <ActivityIndicator color={ON_DARK} size="small" /> : <Text style={s.submitText}>Submit Problem Report</Text>}
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
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  typeCard: {
    width: '47%', padding: SP.sm, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED,
    alignItems: 'center', gap: 6, minHeight: 80, justifyContent: 'center',
  },
  typeCardSelected: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  typeLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center', lineHeight: 16 },
  textarea: { minHeight: 120, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  evidenceNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, padding: SP.sm, marginBottom: SP.md },
  evidenceNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, flex: 1, lineHeight: 17 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  switchLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  switchSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm, padding: SP.sm, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE, alignSelf: 'flex-start' },
  contactBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  disputeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: ORANGE_DIM, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: 'rgba(249,115,22,0.3)', padding: SP.sm, marginBottom: SP.md },
  disputeNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: ORANGE, flex: 1, lineHeight: 17 },
  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', lineHeight: 17, marginBottom: SP.lg },
  bottomBar: { paddingHorizontal: SP.md, paddingTop: SP.md, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  submitBtn: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  submitGrad: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: SP.lg },
  doneBtn: { width: '100%', borderRadius: RADIUS.lg, overflow: 'hidden' },
  doneBtnGrad: { height: COMP.buttonH, alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK },
});

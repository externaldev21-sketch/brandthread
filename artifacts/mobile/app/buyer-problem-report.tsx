/**
 * Brandthread Buyer Problem Report
 * Issue type, description, evidence, contact seller, escalate.
 */
import React, { useState, useEffect } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';

import { CachedImage as Image } from '@/components/CachedImage';

import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

import { apiErrorMessage } from '@/lib/safety';
import { ScreenHeader } from '@/components/ScreenHeader';

import { LinearGradient } from 'expo-linear-gradient';

import { haptics, haptic } from '@/lib/haptics';

import { createProblemReport } from '@/services/cartService';

import { PROBLEM_TYPE_OPTIONS, BuyerProblemType } from '@/services/cartTypes';

import { getBuyerOrder } from '@/services/orderService';

import { BuyerOrderView } from '@/services/orderTypes';

import { BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, SUCCESS, ON_DARK, RED, RED_DIM, FONT, FS, SP, RADIUS } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { HapticSwitch, PrimaryButton } from '@/components/BrandthreadUI';

import { useAuth, useUser } from '@clerk/expo';

import { useApi } from '@/lib/api';

import { collectAppDiagnostics } from '@/lib/appDiagnostics';



export default function BuyerProblemReportScreen() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const s = makeStyles(theme);
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { user } = useUser();

  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [problemType, setProblemType] = useState<BuyerProblemType | ''>('');
  const [description, setDescription] = useState('');
  const [contactedSeller, setContactedSeller] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [evidencePhotos, setEvidencePhotos] = useState<Array<{ uri: string; mimeType: string | null }>>([]);

  async function pickEvidence() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow access to your photo library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      // Uploaded through POST /api/returns/evidence, which takes JPEG, PNG or WebP photos.
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (!result.canceled) {
      setEvidencePhotos(prev => [
        ...prev,
        ...result.assets.filter(a => !prev.some(p => p.uri === a.uri)).map(a => ({ uri: a.uri, mimeType: a.mimeType ?? null })),
      ].slice(0, 5));
    }
  }

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    getBuyerOrder(orderId).then(o => {
      setOrder(o ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [orderId]);

  const isGeneralReport = !orderId;

  async function handleSubmit() {
    if (!problemType) { Alert.alert('Select Issue Type', 'Please select what kind of problem you experienced.'); return; }
    if (!description.trim()) { Alert.alert('Add Details', 'Please describe the problem.'); return; }
    if (!isGeneralReport && !order) return;
    setSubmitting(true);
    try {
      // One support ticket (POST /api/support/problem-reports) with the app/device
      // details and the photos attached. Photos are uploaded first so support
      // can see them; signed-out previews keep the local copy only.
      const evidenceUris = isSignedIn
        ? await Promise.all(evidencePhotos.map(async (photo) => (await api.returns.uploadEvidence(photo)).objectPath))
        : evidencePhotos.map((photo) => photo.uri);
      await createProblemReport({
        orderId: order?.id,
        orderNumber: order?.orderNumber,
        type: problemType as BuyerProblemType,
        description: description.trim(),
        evidenceUris,
        diagnostics: collectAppDiagnostics(),
        contactedSeller,
        contactEmail: user?.primaryEmailAddress?.emailAddress ?? undefined,
        contactName: user?.fullName || user?.username || undefined,
      });
      setSubmitted(true);
    } catch (error) {
      Alert.alert('Could not submit your report', apiErrorMessage(error, 'Please check your connection and try again.'));
    }
    setSubmitting(false);
  }

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }

  if (submitted) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
        <View style={s.successIcon}><Icon name="check" size={32} color={ON_DARK} /></View>
        <Text style={s.successTitle}>Report submitted</Text>
        <Text style={s.successSub}>{isGeneralReport ? 'Your problem report has been received. Our team will review it and reach out if needed.' : 'Your report was sent to the seller and our support team. We\'ll reach out if we need more details.'}</Text>
        <PrimaryButton label="Done" onPress={() => goBackOr(router)} style={s.doneBtn} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScreenHeader
        title="Report a problem"
        onBack={() => goBackOr(router)}
      />

      <ScrollView showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + 100 }}>
        {/* Issue type */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>What's the issue?</Text>
          <View style={s.typeGrid}>
            {PROBLEM_TYPE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[s.typeCard, problemType === opt.key && s.typeCardSelected]}
                onPress={() => { haptic('select'); setProblemType(opt.key); }}
                activeOpacity={0.8}
              >
                <Icon name={opt.icon as any} size={20} color={problemType === opt.key ? PURPLE_LIGHT : MUTED} />
                <Text style={[s.typeLabel, problemType === opt.key && { color: FG }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Description */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>Describe the problem</Text>
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
          style={[s.evidenceNote, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, borderStyle: 'dashed' }]}
          onPress={pickEvidence}
          activeOpacity={0.8}
        >
          <Icon name="camera" size={16} color={PURPLE_LIGHT} />
          <Text style={[s.evidenceNoteText, { color: PURPLE_LIGHT }]}>
            Add photo evidence ({evidencePhotos.length}/5)
          </Text>
        </TouchableOpacity>
        {evidencePhotos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SP.sm }}>
            <View style={{ flexDirection: 'row', gap: SP.sm }}>
              {evidencePhotos.map(({ uri }, idx) => (
                <View key={uri} style={{ width: 72, height: 72, borderRadius: RADIUS.sm, overflow: 'hidden', position: 'relative' }}>
                  <Image source={{ uri }} style={{ width: 72, height: 72 }} contentFit="cover" />
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove photo"
                    style={{ position: 'absolute', top: 2, right: 2, backgroundColor: '#00000099', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setEvidencePhotos(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <Icon name="x" size={10} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Contacted seller */}
        {!isGeneralReport && (
          <View style={s.card}>
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchLabel}>Contacted the seller</Text>
                <Text style={s.switchSub}>Have you already reached out to the seller about this issue?</Text>
              </View>
              <HapticSwitch
                value={contactedSeller}
                onValueChange={setContactedSeller}
              />
            </View>
            {!contactedSeller && (
              <TouchableOpacity
                style={s.contactBtn}
                onPress={() => router.push(('/buyer-conversation?participantId=' + order?.sellerId + '&type=buyer_to_seller_order') as never)}
                activeOpacity={0.8}
              >
                <Icon name="message-circle" size={14} color={PURPLE_LIGHT} />
                <Text style={s.contactBtnText}>Message seller first</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Dispute note */}
        <View style={s.disputeNote}>
          <Icon name="info" size={13} color={MUTED} />
          <Text style={s.disputeNoteText}>
            If the seller doesn't resolve your issue, your report may escalate to a dispute. We will contact you if further information is needed.
          </Text>
        </View>

        <Text style={s.disclaimer}>
          Submitting a problem report opens an investigation. Reports are reviewed by our team.
        </Text>
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + SP.sm }]}>
        <PrimaryButton label="Send report" onPress={handleSubmit} loading={submitting} disabled={submitting} />
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, marginBottom: SP.md },
  sectionTitle: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  typeCard: {
    width: '47%', padding: SP.sm, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ELEVATED,
    alignItems: 'center', gap: 6, minHeight: 80, justifyContent: 'center',
  },
  typeCardSelected: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  typeLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center', lineHeight: 14 },
  textarea: { minHeight: 120, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 18 },
  evidenceNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, padding: SP.sm, marginBottom: SP.md },
  evidenceNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, flex: 1, lineHeight: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  switchLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  switchSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm, padding: SP.sm, backgroundColor: theme.accentDim, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.accent, alignSelf: 'flex-start' },
  contactBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.accentLight },
  disputeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, padding: SP.sm, marginBottom: SP.md },
  disputeNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, flex: 1, lineHeight: 14 },
  disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', lineHeight: 14, marginBottom: SP.lg },
  bottomBar: { paddingHorizontal: SP.md, paddingTop: SP.md, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: SUCCESS, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: SP.lg },
  doneBtn: { width: '100%', borderRadius: RADIUS.lg, overflow: 'hidden' },
});

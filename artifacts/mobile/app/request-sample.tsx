import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

const BG    = '#07070F';
const CARD  = '#12121F';
const BORD  = 'rgba(255,255,255,0.07)';
const FG    = '#F4F4FF';
const MUTED = 'rgba(244,244,255,0.50)';

const PRODUCT_TYPES = ['T-Shirt', 'Hoodie', 'Sweatpants', 'Shorts', 'Jacket', 'Hat', 'Custom'];
const QUANTITIES    = ['1 sample', '2–3 samples', '5 samples', '10 samples'];

export default function RequestSampleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const mfrName = params.name ?? 'Manufacturer';

  const [productType, setProductType] = useState('T-Shirt');
  const [qty,          setQty]         = useState('1 sample');
  const [colorway,     setColorway]    = useState('');
  const [size,         setSize]        = useState('M');
  const [notes,        setNotes]       = useState('');
  const [contact,      setContact]     = useState('');
  const [sending,      setSending]     = useState(false);

  async function submit() {
    if (!contact.trim()) { Alert.alert('Missing info', 'Please enter your email or WhatsApp number.'); return; }
    setSending(true);
    await new Promise((r) => setTimeout(r, 1400));
    setSending(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      '✅ Sample Request Sent',
      `Your request has been sent to ${mfrName}. They will contact you at ${contact.trim()} within 48 hours to confirm details and shipping.`,
      [{ text: 'Done', onPress: () => router.back() }],
    );
  }

  return (
    <View style={[s.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Request Sample</Text>
          <Text style={s.headerSub}>{mfrName}</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Product type */}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Product Type</Text>
          <View style={s.chipRow}>
            {PRODUCT_TYPES.map((t) => (
              <TouchableOpacity
                key={t} style={[s.chip, productType === t && [s.chipActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setProductType(t); }}
                activeOpacity={0.75}
              >
                <Text style={[s.chipText, productType === t && [s.chipTextActive, { color: colors.primary }]]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Qty */}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Sample Quantity</Text>
          <View style={s.chipRow}>
            {QUANTITIES.map((q) => (
              <TouchableOpacity
                key={q} style={[s.chip, qty === q && [s.chipActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setQty(q); }}
                activeOpacity={0.75}
              >
                <Text style={[s.chipText, qty === q && [s.chipTextActive, { color: colors.primary }]]}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Colorway */}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Colorway</Text>
          <TextInput style={s.input} value={colorway} onChangeText={setColorway} placeholder="e.g. Black, Vintage White, Olive" placeholderTextColor={MUTED} />
        </View>

        {/* Size */}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Sample Size</Text>
          <TextInput style={s.input} value={size} onChangeText={setSize} placeholder="e.g. M, L, or unisex" placeholderTextColor={MUTED} />
        </View>

        {/* Notes */}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Specification Notes</Text>
          <TextInput
            style={[s.input, { height: 100, textAlignVertical: 'top' }]}
            value={notes} onChangeText={setNotes} multiline
            placeholder="Fabric weight, fit notes, print placement, references…"
            placeholderTextColor={MUTED}
          />
        </View>

        {/* Contact */}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Your Email or WhatsApp</Text>
          <TextInput style={s.input} value={contact} onChangeText={setContact} placeholder="you@email.com or +1 555…" placeholderTextColor={MUTED} keyboardType="email-address" autoCapitalize="none" />
          <Text style={s.fieldHint}>The manufacturer will contact you directly to confirm specs and arrange shipping.</Text>
        </View>

        {/* Escrow note */}
        <View style={[s.escrowNote, { backgroundColor: colors.accent, borderColor: colors.primary + '33' }]}>
          <Feather name="shield" size={15} color={colors.primary} />
          <Text style={s.escrowText}>
            <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Payment protection: </Text>
            Sample costs are charged only after the manufacturer confirms your request and provides a quote.
          </Text>
        </View>
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[s.submitBtn, { backgroundColor: colors.primary }, sending && { opacity: 0.7 }]} onPress={submit} activeOpacity={0.85} disabled={sending}>
          <Feather name={sending ? 'loader' : 'send'} size={16} color={colors.primaryForeground} />
          <Text style={[s.submitBtnText, { color: colors.primaryForeground }]}>{sending ? 'Sending…' : 'Send Sample Request'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: BG },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORD },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG, textAlign: 'center' },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
  fieldGroup: { gap: 8 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 16 },
  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORD },
  chipActive: {},
  chipText:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  chipTextActive: {},
  input:      { backgroundColor: CARD, borderWidth: 1, borderColor: BORD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  escrowNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },
  escrowText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1, lineHeight: 18 },
  bottom:     { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORD, backgroundColor: BG },
  submitBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 16 },
  submitBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
});

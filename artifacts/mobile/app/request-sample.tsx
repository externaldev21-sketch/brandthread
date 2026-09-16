import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { COMP } from '@/lib/theme';
import {
  getManufacturer, saveQuoteRequestDraft, submitQuoteRequest,
} from '@/services/manufacturerService';
import type { Manufacturer } from '@/services/manufacturerTypes';

const BG = '#0A0A0B';
const CARD = '#18181B';
const BORDER = 'rgba(255,255,255,0.07)';
const FG = '#F4F4FF';
const MUTED = 'rgba(244,244,255,0.50)';
const PRODUCT_TYPES = ['T-Shirt', 'Hoodie', 'Sweatpants', 'Shorts', 'Jacket', 'Hat', 'Custom'];
const QUANTITIES = [1, 3, 5, 10];

export default function RequestSampleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { manufacturerId } = useLocalSearchParams<{ manufacturerId?: string }>();
  const [manufacturer, setManufacturer] = useState<Manufacturer | null>(null);
  const [loading, setLoading] = useState(true);
  const [productType, setProductType] = useState('T-Shirt');
  const [quantity, setQuantity] = useState(1);
  const [colorway, setColorway] = useState('');
  const [size, setSize] = useState('M');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    if (!manufacturerId) {
      setLoading(false);
      return;
    }
    getManufacturer(manufacturerId)
      .then((value) => {
        if (!active) return;
        setManufacturer(value ?? null);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [manufacturerId]);

  async function submit() {
    if (!manufacturerId || !manufacturer) return;
    if (!contact.trim()) {
      Alert.alert('Missing info', 'Enter your email or WhatsApp number.');
      return;
    }
    setSending(true);
    try {
      const draft = await saveQuoteRequestDraft({
        manufacturerId,
        productName: `${productType} sample`,
        productionType: productType,
        quantity,
        sampleRequired: true,
        colorways: colorway.trim() ? [colorway.trim()] : [],
        sizes: size.trim() ? [size.trim()] : [],
        notes: [notes.trim(), `Reply contact: ${contact.trim()}`].filter(Boolean).join('\n'),
        currentStep: 5,
      });
      await submitQuoteRequest(draft.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Sample request sent',
        `Your request is now visible to ${manufacturer.name}.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert('Could not send request', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (!manufacturer) return <View style={styles.root} />;

  return (
    <View style={[styles.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint={`Returns without sending a sample request to ${manufacturer.name}`}
        >
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Request Sample</Text>
          <Text style={styles.headerSub}>{manufacturer.name}</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Product type">
          <View style={styles.chips}>
            {PRODUCT_TYPES.map((item) => <Chip key={item} label={item} active={item === productType} onPress={() => setProductType(item)} color={colors.primary} />)}
          </View>
        </Field>
        <Field label="Quantity">
          <View style={styles.chips}>
            {QUANTITIES.map((item) => <Chip key={item} label={`${item}`} active={item === quantity} onPress={() => setQuantity(item)} color={colors.primary} />)}
          </View>
        </Field>
        <Field label="Colorway"><TextInput accessibilityLabel="Colorway" accessibilityHint="Enter the requested sample color" value={colorway} onChangeText={setColorway} placeholder="e.g. Washed black" placeholderTextColor={MUTED} style={styles.input} /></Field>
        <Field label="Size"><TextInput accessibilityLabel="Size" accessibilityHint="Enter the requested sample size" value={size} onChangeText={setSize} placeholderTextColor={MUTED} style={styles.input} /></Field>
        <Field label="Reply contact"><TextInput accessibilityLabel="Reply contact" accessibilityHint="Enter an email address or WhatsApp number" value={contact} onChangeText={setContact} placeholder="Email or WhatsApp" placeholderTextColor={MUTED} style={styles.input} autoCapitalize="none" /></Field>
        <Field label="Notes"><TextInput accessibilityLabel="Sample notes" accessibilityHint="Enter optional materials, construction, or deadline details" value={notes} onChangeText={setNotes} placeholder="Materials, construction, or deadlines" placeholderTextColor={MUTED} style={[styles.input, styles.notes]} multiline /></Field>
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }, sending && { opacity: 0.65 }]}
          onPress={submit}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={sending ? 'Sending sample request' : `Send sample request to ${manufacturer.name}`}
          accessibilityHint="Submits the selected product, quantity, and contact details"
          accessibilityState={{ disabled: sending, busy: sending }}
        >
          {sending && <ActivityIndicator size="small" color={colors.primaryForeground} />}
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{sending ? 'Sending…' : 'Send Sample Request'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color: string }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && { borderColor: color, backgroundColor: `${color}22` }]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, checked: active }}
    >
      <Text style={[styles.chipText, active && { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  backButton: { width: COMP.minTouchTarget, minHeight: COMP.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: FG, fontSize: 16, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  headerSub: { color: MUTED, fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  content: { padding: 16, paddingBottom: 120, gap: 20 },
  field: { gap: 8 },
  label: { color: MUTED, fontSize: 12, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: COMP.minTouchTarget, backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' },
  chipText: { color: MUTED, fontSize: 13, fontFamily: 'Inter_500Medium' },
  input: { minHeight: COMP.minTouchTarget, backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 12, color: FG, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  notes: { minHeight: 100, textAlignVertical: 'top' },
  bottom: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
});
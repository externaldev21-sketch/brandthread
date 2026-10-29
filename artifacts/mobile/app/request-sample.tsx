import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { validEmailOrPhone } from '@/lib/contactInput';

import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';

import { EmptyState } from '@/components/BrandthreadUI';

import { useLocalSearchParams, useRouter } from 'expo-router';

import { haptics } from '@/lib/haptics';

import { useColors } from '@/hooks/useColors';

import { COMP, FONT, ICON } from '@/lib/theme';

import { getManufacturer, saveQuoteRequestDraft, submitQuoteRequest } from '@/services/manufacturerService';

import type { Manufacturer } from '@/services/manufacturerTypes';
import { radius } from '@/constants/radii';
import { showToast } from '@/lib/toast';
import { SkeletonBlock } from '@/components/ui/Skeleton';

const PRODUCT_TYPES = ['T-Shirt', 'Hoodie', 'Sweatpants', 'Shorts', 'Jacket', 'Hat', 'Custom'];
const QUANTITIES = [1, 3, 5, 10];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function RequestSampleScreen() {
  const colors = useColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { manufacturerId } = useLocalSearchParams<{ manufacturerId?: string }>();
  const [manufacturer, setManufacturer] = useState<Manufacturer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [productType, setProductType] = useState('T-Shirt');
  const [quantity, setQuantity] = useState(1);
  const [colorway, setColorway] = useState('');
  const [size, setSize] = useState('M');
  // "Other" swaps the size chips' value for a typed one (e.g. 3XL, 32x30, One size).
  const [customSize, setCustomSize] = useState(false);
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  // A failed request is not the same as a delisted manufacturer: show a
  // retry instead of "no longer listed".
  const [loadError, setLoadError] = useState(false);
  // Reuse the local draft on retry so a failed send doesn't leave a stray draft each time.
  const draftIdRef = React.useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    if (!manufacturerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    getManufacturer(manufacturerId)
      .then((value) => {
        if (!active) return;
        setManufacturer(value ?? null);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [manufacturerId, reloadKey]);

  async function submit() {
    if (!manufacturerId || !manufacturer) return;
    if (!contact.trim()) {
      Alert.alert('Missing info', 'Enter your email or WhatsApp number.');
      return;
    }
    const replyContact = validEmailOrPhone(contact);
    if (!replyContact) {
      Alert.alert('Check your contact', 'Enter a valid email address or WhatsApp number so the manufacturer can reply.');
      return;
    }
    setSending(true);
    try {
      const draft = await saveQuoteRequestDraft({
        id: draftIdRef.current,
        manufacturerId,
        productName: `${productType} sample`,
        productionType: productType,
        quantity,
        sampleRequired: true,
        colorways: colorway.trim() ? [colorway.trim()] : [],
        sizes: size.trim() ? [size.trim()] : [],
        // The submit payload has no sizes field, so the size travels in the notes.
        notes: [notes.trim(), size.trim() ? `Size: ${size.trim()}` : '', `Reply contact: ${replyContact}`].filter(Boolean).join('\n'),
        currentStep: 5,
      });
      draftIdRef.current = draft.id;
      await submitQuoteRequest(draft.id);
      showToast('Sample request sent', `Your request is now visible to ${manufacturer.name}.`);
      goBackOr(router);
    } catch (error) {
      Alert.alert('Couldn’t send request', 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="Request Sample"
          onBack={() => { goBackOr(router); }}
        />
        <View style={styles.content} accessibilityLabel="Loading sample request form" testID="request-sample-loading">
          {[5, 4].map((count, field) => (
            <View key={field} style={styles.field}>
              <SkeletonBlock width={90} height={12} radius={4} />
              <View style={styles.chips}>
                {Array.from({ length: count }, (_, i) => <SkeletonBlock key={i} width={64} height={COMP.minTouchTarget} radius={radius.md} />)}
              </View>
            </View>
          ))}
          {[0, 1, 2].map((field) => (
            <View key={`input-${field}`} style={styles.field}>
              <SkeletonBlock width={80} height={12} radius={4} />
              <SkeletonBlock width="100%" height={COMP.minTouchTarget} radius={12} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (!manufacturer && loadError) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="Request Sample"
          onBack={() => { goBackOr(router); }}
        />
        <EmptyState
          icon="wifi-off"
          title="Couldn't load this manufacturer"
          description="Check your connection and try again."
          action={{ label: 'Try again', onPress: () => setReloadKey((k) => k + 1) }}
        />
      </View>
    );
  }

  if (!manufacturer) {
    return (
      <View style={styles.root}>
        <ScreenHeader
          title="Request Sample"
          onBack={() => { goBackOr(router); }}
        />
        <EmptyState
          icon="alert-circle"
          title={manufacturerId ? 'Manufacturer unavailable' : 'No manufacturer selected'}
          description={manufacturerId
            ? "This manufacturer is no longer listed, or it's a private manufacturer you aren't connected to."
            : 'Open this screen from a manufacturer’s profile to request a sample.'}
          action={{ label: 'Back to directory', onPress: () => goBackOr(router) }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Request Sample"
        onBack={() => { goBackOr(router); }}
      />
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
        <Field label="Colorway"><TextInput returnKeyType="done" accessibilityLabel="Colorway" accessibilityHint="Enter the requested sample color" value={colorway} onChangeText={setColorway} placeholder="e.g. Washed black" placeholderTextColor={colors.mutedForeground} style={styles.input} /></Field>
        <Field label="Size">
          <View style={styles.chips}>
            {SIZES.map((item) => (
              <Chip key={item} label={item} active={!customSize && item === size} onPress={() => { setCustomSize(false); setSize(item); }} color={colors.primary} />
            ))}
            <Chip label="Other" active={customSize} onPress={() => { if (!customSize) { setCustomSize(true); setSize(''); } }} color={colors.primary} />
          </View>
          {customSize && (
            <TextInput returnKeyType="done" accessibilityLabel="Custom size" accessibilityHint="Enter the requested sample size" value={size} onChangeText={setSize} placeholder="e.g. 3XL, 32x30 or One size" placeholderTextColor={colors.mutedForeground} style={styles.input} autoFocus />
          )}
        </Field>
        <Field label="Reply contact"><TextInput returnKeyType="done" accessibilityLabel="Reply contact" accessibilityHint="Enter an email address or WhatsApp number" value={contact} onChangeText={setContact} placeholder="Email or WhatsApp" placeholderTextColor={colors.mutedForeground} style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" /></Field>
        <Field label="Notes"><TextInput accessibilityLabel="Sample notes" accessibilityHint="Enter optional materials, construction, or deadline details" value={notes} onChangeText={setNotes} placeholder="Materials, construction, or deadlines" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.notes]} multiline /></Field>
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
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{sending ? 'Sending…' : 'Send request'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>;
}

function Chip({ label, active, onPress, color }: { label: string; active: boolean; onPress: () => void; color: string }) {
  const colors = useColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
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

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 120, gap: 20 },
  field: { gap: 8 },
  label: { color: colors.mutedForeground, fontSize: 12, fontFamily: FONT.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: COMP.minTouchTarget, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' },
  chipText: { color: colors.mutedForeground, fontSize: 13, fontFamily: FONT.medium },
  input: { minHeight: COMP.minTouchTarget, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, color: colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: FONT.regular },
  notes: { minHeight: 100, textAlignVertical: 'top' },
  bottom: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontFamily: FONT.bold },
});
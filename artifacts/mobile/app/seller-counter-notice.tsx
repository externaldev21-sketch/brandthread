/**
 * DMCA counter-notice for one takedown case (from app/seller-ip-cases.tsx).
 * Collects every element 17 U.S.C. § 512(g)(3) requires: identification of
 * the removed material, the penalty-of-perjury good-faith statement, consent
 * to jurisdiction + service of process, name / address / phone, and a typed
 * electronic signature. Submits to POST /api/ip-cases/seller/:reference/counter-notice.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/BrandthreadUI';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  JURISDICTION_COPY, PERJURY_COPY, counterNoticeError, defaultRemovedMaterial,
} from '@/lib/counterNotice';
import { FONT, FS, SP } from '@/lib/theme';

export default function SellerCounterNoticeScreen() {
  const params = useLocalSearchParams<{ reference?: string; listingName?: string; listingProductId?: string }>();
  const reference = typeof params.reference === 'string' ? params.reference : '';
  const api = useApi();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [removedMaterial, setRemovedMaterial] = useState(() => defaultRemovedMaterial({
    caseReference: reference,
    listingName: typeof params.listingName === 'string' && params.listingName ? params.listingName : null,
    listingProductId: typeof params.listingProductId === 'string' && params.listingProductId ? params.listingProductId : null,
  }));
  const [explanation, setExplanation] = useState('');
  const [perjury, setPerjury] = useState(false);
  const [jurisdiction, setJurisdiction] = useState(false);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const input = {
    fullName, address, phone, email, removedMaterial, explanation,
    perjuryStatement: perjury, consentToJurisdiction: jurisdiction, signature,
  };

  async function submit() {
    const problem = counterNoticeError(input);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      await api.ipCases.counterNotice(reference, { ...input, email: email.trim() || undefined });
      setDone(true);
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message.replace(/^API \d{3}:\s*/, '') : '';
      setError(message || 'Could not send your counter-notice. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!reference) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenHeader title="Counter-notice" />
        <EmptyState icon="alert-circle" title="Case not found" description="Open the takedown from IP takedowns in Settings." />
      </View>
    );
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }} testID="counter-notice-sent">
        <ScreenHeader title="Counter-notice" />
        <EmptyState
          icon="check-circle"
          title="Counter-notice sent"
          description={`We received your counter-notice for case ${reference}. Our team will review it and email you the outcome.`}
          action={{ label: 'Done', onPress: () => goBackOr(router, '/seller-ip-cases' as never) }}
        />
      </View>
    );
  }

  const field = (
    label: string, value: string, set: (v: string) => void,
    opts: { multiline?: boolean; placeholder?: string; keyboardType?: 'phone-pad' | 'email-address'; autoCapitalize?: 'none' | 'words' } = {},
  ) => (
    <>
      <Text style={[styles.label, { color: c.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(t) => { set(t); setError(null); }}
        multiline={opts.multiline}
        placeholder={opts.placeholder}
        placeholderTextColor={c.mutedForeground}
        keyboardType={opts.keyboardType}
        autoCapitalize={opts.autoCapitalize}
        style={[styles.input, opts.multiline && styles.multiline, { color: c.foreground, borderColor: c.border }]}
        accessibilityLabel={label}
      />
    </>
  );

  const check = (checked: boolean, toggle: () => void, text: string, testID: string) => (
    <Pressable
      onPress={() => { toggle(); setError(null); }}
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      testID={testID}
    >
      <Feather name={checked ? 'check-square' : 'square'} size={20} color={c.foreground} />
      <Text style={[styles.checkText, { color: c.foreground }]}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.background }} testID="seller-counter-notice">
      <ScreenHeader title="Counter-notice" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 140 }} keyboardShouldPersistTaps="handled">
          <Text style={[styles.note, { color: c.mutedForeground }]}>
            Case {reference}. A counter-notice is a legal statement. Only file one if you believe the listing was removed by mistake or misidentification. Your name, address and phone may be shared with the person who reported it.
          </Text>

          {field('Removed listing and where it appeared', removedMaterial, setRemovedMaterial, { multiline: true })}
          {field('Why it was removed by mistake', explanation, setExplanation, {
            multiline: true, placeholder: 'For example: I designed this product myself, or I have a licence from the brand.',
          })}

          {field('Full legal name', fullName, setFullName, { autoCapitalize: 'words' })}
          {field('Postal address', address, setAddress, { multiline: true, placeholder: 'Street, city, region, postcode, country' })}
          {field('Phone', phone, setPhone, { keyboardType: 'phone-pad' })}
          {field('Email (optional)', email, setEmail, { keyboardType: 'email-address', autoCapitalize: 'none' })}

          <View style={{ height: SP.md }} />
          {check(perjury, () => setPerjury((v) => !v), PERJURY_COPY, 'counter-notice-perjury')}
          {check(jurisdiction, () => setJurisdiction((v) => !v), JURISDICTION_COPY, 'counter-notice-jurisdiction')}

          {field('Electronic signature (type your full legal name)', signature, setSignature, { autoCapitalize: 'words' })}

          {error ? <Text style={[styles.error, { color: c.destructive }]}>{error}</Text> : null}
          <View style={{ height: SP.lg }} />
          <Button label="Send counter-notice" fullWidth loading={busy} onPress={submit} testID="counter-notice-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  label: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: SP.md, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, paddingVertical: SP.sm },
  checkText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.md },
});

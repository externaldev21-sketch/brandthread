/**
 * RFQ Post — broadcast a Request for Quotation to up to 10 manufacturers at
 * once. Mirrors quote-request.tsx's conventions (no fake file upload: there
 * is no real tech-pack upload API in this codebase yet, so the "Attach files"
 * affordance is intentionally left out rather than faked — see §11a).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { FormInput, PrimaryButton, EmptyState, StatusBadge } from '@/components/BrandthreadUI';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { createRfq, getRfqTargetManufacturers, type RfqTargetManufacturer } from '@/services/manufacturerRfq';

const MAX_TARGETS = 10;

const GARMENT_TYPES = [
  'T-Shirts', 'Hoodies & Fleece', 'Denim', 'Knitwear', 'Woven Tops', 'Outerwear',
  'Activewear', 'Headwear', 'Bags & Accessories', 'Other',
];

export default function RfqPostScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { manufacturerId: preselectId } = useLocalSearchParams<{ manufacturerId?: string }>();

  const [garmentType, setGarmentType] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('500');
  const [targetPrice, setTargetPrice] = useState('');
  const [deadline, setDeadline] = useState('');

  const [manufacturers, setManufacturers] = useState<RfqTargetManufacturer[]>([]);
  const [loadingManufacturers, setLoadingManufacturers] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(preselectId ? [preselectId] : []));
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoadingManufacturers(true);
    setLoadError(false);
    getRfqTargetManufacturers()
      .then(setManufacturers)
      .catch(() => setLoadError(true))
      .finally(() => setLoadingManufacturers(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = manufacturers.filter((mfg) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return mfg.businessName.toLowerCase().includes(q) || mfg.specialty.toLowerCase().includes(q) || mfg.country.toLowerCase().includes(q);
  });

  const toggle = (id: string) => {
    Haptics.selectionAsync();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= MAX_TARGETS) {
        Alert.alert('Limit reached', `You can send an RFQ to up to ${MAX_TARGETS} manufacturers at once.`);
        return prev;
      }
      next.add(id);
      return next;
    });
  };

  async function handleSubmit() {
    if (!garmentType.trim()) { Alert.alert('Garment type required', 'Tell manufacturers what you need made.'); return; }
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) { Alert.alert('Invalid quantity', 'Enter the total quantity you need.'); return; }
    if (selected.size === 0) { Alert.alert('Pick manufacturers', 'Select at least one manufacturer to send this RFQ to.'); return; }

    setSubmitting(true);
    try {
      const rfq = await createRfq({
        garmentType: garmentType.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        quantity: qty,
        targetPriceCents: targetPrice ? parseDecimalToCents(targetPrice) : undefined,
        deadline: deadline.trim() ? new Date(deadline.trim()).toISOString() : undefined,
        manufacturerIds: [...selected],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/rfq-compare?rfqId=${rfq.id}` as never);
    } catch (e: any) {
      Alert.alert('Could not post RFQ', e?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Request for Quotation" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + SP.xl }]} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionLabel}>What are you sourcing?</Text>
        <View style={s.chipRow}>
          {GARMENT_TYPES.map((type) => (
            <TouchableOpacity key={type} style={[s.typeChip, garmentType === type && s.typeChipActive]} onPress={() => setGarmentType(type)} activeOpacity={0.8}>
              <Text style={[s.typeChipText, garmentType === type && s.typeChipTextActive]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FormInput label="Garment type" value={garmentType} onChange={setGarmentType} placeholder="e.g. Heavyweight cotton hoodie" style={s.field} />
        <FormInput label="Category (optional)" value={category} onChange={setCategory} placeholder="e.g. Streetwear" style={s.field} />
        <FormInput label="Description" value={description} onChange={setDescription} placeholder="Fabric, fit, print details…" multiline style={s.field} />

        <View style={s.row2}>
          <FormInput label="Quantity" value={quantity} onChange={setQuantity} placeholder="500" keyboardType="number-pad" style={[s.field, s.half]} />
          <FormInput label="Target price / unit" value={targetPrice} onChange={setTargetPrice} placeholder="$6.50" keyboardType="decimal-pad" style={[s.field, s.half]} />
        </View>
        <FormInput label="Deadline (optional)" value={deadline} onChange={setDeadline} placeholder="YYYY-MM-DD" style={s.field} />

        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionLabel}>Send to manufacturers</Text>
          <StatusBadge label={`${selected.size} / ${MAX_TARGETS} selected`} variant={selected.size > 0 ? 'purple' : 'neutral'} small />
        </View>

        <View style={s.searchRow}>
          <Feather name="search" size={ICON.sm} color={theme.subtle} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search manufacturers…"
            placeholderTextColor={theme.subtle}
          />
        </View>

        {loadingManufacturers ? (
          <View style={s.loadingWrap}><ActivityIndicator color={theme.accent} /></View>
        ) : loadError ? (
          <EmptyState icon="wifi-off" title="Couldn't load manufacturers" description="Check your connection and try again." action={{ label: 'Retry', onPress: load }} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="search" title="No manufacturers found" description="Try a different search term." />
        ) : (
          filtered.map((mfg) => {
            const active = selected.has(mfg.id);
            return (
              <TouchableOpacity key={mfg.id} style={[s.mfgRow, active && s.mfgRowActive]} onPress={() => toggle(mfg.id)} activeOpacity={0.8} testID={`rfq-target-${mfg.id}`}>
                <View style={[s.checkbox, active && s.checkboxActive]}>
                  {active && <Feather name="check" size={13} color={theme.onAccent} />}
                </View>
                <View style={s.mfgInfo}>
                  <View style={s.mfgNameRow}>
                    <Text style={s.mfgName} numberOfLines={1}>{mfg.businessName}</Text>
                    {mfg.isVerified && <Feather name="check-circle" size={13} color={theme.secondary} />}
                  </View>
                  <Text style={s.mfgMeta} numberOfLines={1}>
                    {[mfg.specialty, mfg.country].filter(Boolean).join(' · ')}
                    {mfg.moq ? ` · MOQ ${mfg.moq}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + SP.sm }]}>
        <PrimaryButton
          label={submitting ? 'Sending…' : `Send RFQ to ${selected.size || ''} ${selected.size === 1 ? 'manufacturer' : 'manufacturers'}`.trim()}
          onPress={handleSubmit}
          disabled={submitting || selected.size === 0}
          icon={submitting ? undefined : 'send'}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  scroll: { padding: SP.md, gap: SP.sm },
  sectionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.muted, marginTop: SP.md, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.lg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm },
  typeChip: { paddingHorizontal: SP.md, height: 34, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  typeChipActive: { backgroundColor: theme.accentDim, borderColor: theme.accent },
  typeChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  typeChipTextActive: { color: theme.accentLight, fontFamily: FONT.semibold },
  field: { marginBottom: SP.sm },
  row2: { flexDirection: 'row', gap: SP.sm },
  half: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: SP.md, height: 44, marginBottom: SP.sm },
  searchInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: theme.text },
  loadingWrap: { paddingVertical: SP.xl, alignItems: 'center' },
  mfgRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: theme.cardGlass, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.sm, marginBottom: SP.xs },
  mfgRowActive: { borderColor: theme.accent },
  checkbox: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  mfgInfo: { flex: 1 },
  mfgNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mfgName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, flexShrink: 1 },
  mfgMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.background },
});

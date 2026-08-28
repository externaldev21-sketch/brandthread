/**
 * Brandthread Seller Discounts
 * Route: /discounts
 * Lists active discount codes and allows creating new ones.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, ActivityIndicator, Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, SUCCESS_DIM, ORANGE, RED, GOLD,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BrandthreadCard, PrimaryButton, SecondaryButton,
  StatusBadge, SectionHeader, EmptyState,
} from '@/components/BrandthreadUI';

interface DiscountCode {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;             // percent (0–100) or cents
  minOrderAmount?: number;   // cents
  usageLimit?: number;
  usageCount: number;
  active: boolean;
  expiresAt?: string;
  createdAt: string;
}

function fmtValue(d: DiscountCode) {
  return d.type === 'percentage' ? `${d.value}% off` : `$${(d.value / 100).toFixed(2)} off`;
}

function fmtExpiry(iso?: string) {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  return d < new Date() ? `Expired ${d.toLocaleDateString()}` : `Expires ${d.toLocaleDateString()}`;
}

const DEMO: DiscountCode[] = [
  { id: '1', code: 'WELCOME20', type: 'percentage', value: 20, usageCount: 14, active: true, createdAt: new Date().toISOString() },
  { id: '2', code: 'SAVE10',    type: 'fixed',      value: 1000, minOrderAmount: 5000, usageLimit: 50, usageCount: 23, active: true, createdAt: new Date().toISOString() },
  { id: '3', code: 'SUMMER25',  type: 'percentage', value: 25, usageCount: 8, active: false, expiresAt: '2026-09-01T00:00:00Z', createdAt: new Date().toISOString() },
];

export default function DiscountsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN } = theme;
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const api     = useApi();

  const [discounts, setDiscounts]   = useState<DiscountCode[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [saving, setSaving]         = useState(false);

  // Form state
  const [code, setCode]               = useState('');
  const [discType, setDiscType]       = useState<'percentage' | 'fixed'>('percentage');
  const [value, setValue]             = useState('');
  const [minOrder, setMinOrder]       = useState('');
  const [usageLimit, setUsageLimitVal] = useState('');
  const [hasExpiry, setHasExpiry]     = useState(false);
  const [expiryDate, setExpiryDate]   = useState('');

  const loadDiscounts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await (api as any).discounts?.list?.() ?? null;
      setDiscounts(Array.isArray(data) ? data : DEMO);
    } catch {
      setDiscounts(DEMO);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { loadDiscounts(); }, [loadDiscounts]));

  function openNewModal() {
    setCode('');
    setDiscType('percentage');
    setValue('');
    setMinOrder('');
    setUsageLimitVal('');
    setHasExpiry(false);
    setExpiryDate('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!code.trim()) { Alert.alert('Code required', 'Enter a discount code.'); return; }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) { Alert.alert('Invalid value', 'Enter a valid discount amount.'); return; }
    if (discType === 'percentage' && numValue > 100) { Alert.alert('Invalid %', 'Percentage cannot exceed 100.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        type: discType,
        value: discType === 'percentage' ? numValue : Math.round(numValue * 100),
        minOrderAmount: minOrder ? Math.round(parseFloat(minOrder) * 100) : undefined,
        usageLimit: usageLimit ? parseInt(usageLimit, 10) : undefined,
        active: true,
        expiresAt: hasExpiry && expiryDate ? new Date(expiryDate).toISOString() : undefined,
      };
      const created = await (api as any).discounts?.create?.(payload);
      if (created) {
        setDiscounts(prev => [created, ...prev]);
      } else {
        // optimistic
        setDiscounts(prev => [{
          id: Date.now().toString(), ...payload, usageCount: 0, createdAt: new Date().toISOString(),
        } as DiscountCode, ...prev]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowModal(false);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d: DiscountCode) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = { ...d, active: !d.active };
    setDiscounts(prev => prev.map(x => x.id === d.id ? updated : x));
    try {
      await (api as any).discounts?.update?.(d.id, { active: !d.active });
    } catch {
      setDiscounts(prev => prev.map(x => x.id === d.id ? d : x)); // rollback
    }
  }

  async function handleDelete(d: DiscountCode) {
    Alert.alert('Delete discount?', `Remove code "${d.code}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDiscounts(prev => prev.filter(x => x.id !== d.id));
          try { await (api as any).discounts?.delete?.(d.id); }
          catch { loadDiscounts(); }
        },
      },
    ]);
  }

  const active   = discounts.filter(d => d.active);
  const inactive = discounts.filter(d => !d.active);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Discounts</Text>
        <TouchableOpacity style={s.addBtn} onPress={openNewModal}>
          <Feather name="plus" size={20} color={PURPLE_LIGHT} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={PURPLE} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 80 }}>

          {discounts.length === 0 && (
            <EmptyState
              icon="tag"
              title="No discount codes yet"
              body="Create codes to offer buyers a percentage or fixed amount off their order."
              action={{ label: 'Create code', onPress: openNewModal }}
            />
          )}

          {active.length > 0 && (
            <>
              <SectionHeader title="Active" />
              {active.map(d => <DiscountCard key={d.id} d={d} onToggle={toggleActive} onDelete={handleDelete} />)}
            </>
          )}

          {inactive.length > 0 && (
            <>
              <SectionHeader title="Inactive / Expired" />
              {inactive.map(d => <DiscountCard key={d.id} d={d} onToggle={toggleActive} onDelete={handleDelete} />)}
            </>
          )}
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + SP.lg }]}
        onPress={openNewModal}
        activeOpacity={0.85}
      >
        <Feather name="plus" size={24} color="#fff" />
        <Text style={s.fabText}>New Code</Text>
      </TouchableOpacity>

      {/* Create Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={[s.modal, { paddingTop: 20 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>New Discount Code</Text>
            <TouchableOpacity onPress={() => setShowModal(false)} style={s.modalClose}>
              <Feather name="x" size={18} color={FG} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: SP.md, gap: SP.md }}>
            {/* Code */}
            <View>
              <Text style={s.label}>Discount Code <Text style={{ color: PURPLE_LIGHT }}>*</Text></Text>
              <TextInput
                style={s.input}
                value={code}
                onChangeText={t => setCode(t.toUpperCase())}
                placeholder="e.g. SAVE20"
                placeholderTextColor={MUTED}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            {/* Type */}
            <View>
              <Text style={s.label}>Type</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['percentage', 'fixed'] as const).map(t => (
                  <TouchableOpacity key={t} style={[s.typeBtn, discType === t && s.typeBtnActive]} onPress={() => setDiscType(t)}>
                    <Text style={[s.typeBtnText, discType === t && { color: PURPLE_LIGHT }]}>
                      {t === 'percentage' ? '% Percentage' : '$ Fixed amount'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Value */}
            <View>
              <Text style={s.label}>{discType === 'percentage' ? 'Percentage off' : 'Amount off ($)'} <Text style={{ color: PURPLE_LIGHT }}>*</Text></Text>
              <TextInput
                style={s.input}
                value={value}
                onChangeText={setValue}
                placeholder={discType === 'percentage' ? '20' : '10.00'}
                placeholderTextColor={MUTED}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Min order */}
            <View>
              <Text style={s.label}>Minimum order ($) <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional)</Text></Text>
              <TextInput
                style={s.input}
                value={minOrder}
                onChangeText={setMinOrder}
                placeholder="50.00"
                placeholderTextColor={MUTED}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Usage limit */}
            <View>
              <Text style={s.label}>Usage limit <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional, leave blank for unlimited)</Text></Text>
              <TextInput
                style={s.input}
                value={usageLimit}
                onChangeText={setUsageLimitVal}
                placeholder="100"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
              />
            </View>

            {/* Expiry toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.label}>Set expiry date</Text>
              <Switch
                value={hasExpiry}
                onValueChange={setHasExpiry}
                trackColor={{ false: BORDER, true: PURPLE }}
                thumbColor="#fff"
              />
            </View>
            {hasExpiry && (
              <TextInput
                style={s.input}
                value={expiryDate}
                onChangeText={setExpiryDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={MUTED}
                autoCorrect={false}
              />
            )}

            <PrimaryButton
              label={saving ? 'Saving…' : 'Create Code'}
              onPress={handleSave}
              disabled={saving}
              style={{ marginTop: SP.sm }}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function DiscountCard({ d, onToggle, onDelete }: {
  d: DiscountCode;
  onToggle: (d: DiscountCode) => void;
  onDelete: (d: DiscountCode) => void;
}) {
  const isExpired = d.expiresAt ? new Date(d.expiresAt) < new Date() : false;
  const pctUsed = d.usageLimit ? Math.round((d.usageCount / d.usageLimit) * 100) : null;

  return (
    <BrandthreadCard style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={s.codeText}>{d.code}</Text>
          <Text style={s.valueText}>{fmtValue(d)}</Text>
          {d.minOrderAmount && (
            <Text style={s.metaText}>Min. order ${(d.minOrderAmount / 100).toFixed(2)}</Text>
          )}
          <Text style={[s.metaText, isExpired && { color: RED }]}>{fmtExpiry(d.expiresAt)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <Switch
            value={d.active}
            onValueChange={() => onToggle(d)}
            trackColor={{ false: BORDER, true: PURPLE }}
            thumbColor="#fff"
          />
          <TouchableOpacity onPress={() => onDelete(d)}>
            <Feather name="trash-2" size={16} color={RED} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER }}>
        <View style={s.statPill}>
          <Feather name="users" size={11} color={MUTED} />
          <Text style={s.statText}>{d.usageCount} uses</Text>
        </View>
        {d.usageLimit && (
          <View style={s.statPill}>
            <Feather name="sliders" size={11} color={MUTED} />
            <Text style={s.statText}>Limit {d.usageLimit}</Text>
          </View>
        )}
        {pctUsed !== null && (
          <View style={{ flex: 1, height: 3, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(pctUsed, 100)}%`, height: '100%', backgroundColor: pctUsed >= 90 ? RED : pctUsed >= 60 ? ORANGE : SUCCESS }} />
          </View>
        )}
      </View>
    </BrandthreadCard>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle:{ fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  backBtn:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addBtn:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  card:     { marginBottom: SP.sm },
  codeText: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, letterSpacing: 1.5, marginBottom: 2 },
  valueText:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT, marginBottom: 2 },
  metaText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, paddingHorizontal: 6, paddingVertical: 3 },
  statText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  fab:      { position: 'absolute', right: SP.md, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PURPLE, borderRadius: 24, paddingHorizontal: SP.md, paddingVertical: 14 },
  fabText:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: '#fff' },

  modal:       { flex: 1, backgroundColor: BG },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  modalTitle:  { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  modalClose:  { width: 36, height: 36, backgroundColor: CARD_ELEVATED, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  label:       { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:       { backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  typeBtn:     { flex: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  typeBtnActive:{ borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  typeBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
});

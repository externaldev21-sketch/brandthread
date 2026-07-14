import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { getPolicies, upsertPolicy, generatePolicyDraft } from '@/services/storeService';
import { StorePolicy, PolicyType } from '@/services/storeTypes';

const POLICY_TYPES: { type: PolicyType; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { type: 'shipping',   label: 'Shipping Policy',   icon: 'truck' },
  { type: 'return',     label: 'Return Policy',      icon: 'rotate-ccw' },
  { type: 'refund',     label: 'Refund Policy',      icon: 'dollar-sign' },
  { type: 'privacy',    label: 'Privacy Policy',     icon: 'shield' },
  { type: 'terms',      label: 'Terms of Service',   icon: 'file-text' },
  { type: 'pre_order',  label: 'Pre-order Policy',   icon: 'calendar' },
];

export default function StorePoliciesScreen() {
  const router = useRouter();
  const [policies, setPolicies] = useState<StorePolicy[]>([]);
  const [selectedType, setSelectedType] = useState<PolicyType | null>(null);
  const [content, setContent] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const p = await getPolicies();
    setPolicies(p);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const openEdit = (type: PolicyType) => {
    const existing = policies.find(p => p.type === type);
    setSelectedType(type);
    setContent(existing?.content ?? '');
    setAiGenerated(existing?.aiGenerated ?? false);
  };

  const closeEdit = () => {
    setSelectedType(null);
    setContent('');
    setAiGenerated(false);
  };

  const handleGenerate = async (type: PolicyType) => {
    setGenerating(true);
    try {
      const draft = generatePolicyDraft(type, 'Your Store');
      setSelectedType(type);
      setContent(draft);
      setAiGenerated(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedType) return;
    setSaving(true);
    try {
      await upsertPolicy(selectedType, content, aiGenerated);
      await load();
      closeEdit();
      Alert.alert('Saved', 'Policy saved successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save policy.');
    } finally {
      setSaving(false);
    }
  };

  const policyStatus = (type: PolicyType): { label: string; variant: 'success' | 'warning' | 'neutral' } => {
    const p = policies.find(x => x.type === type);
    if (!p) return { label: 'Not created', variant: 'neutral' };
    if (p.aiGenerated && !p.reviewedBySeller) return { label: 'AI draft — needs review', variant: 'warning' };
    return { label: 'Published', variant: 'success' };
  };

  const selectedLabel = POLICY_TYPES.find(pt => pt.type === selectedType)?.label ?? '';

  return (
    <View style={ps.root}>
      {/* Header */}
      <View style={ps.header}>
        <TouchableOpacity onPress={() => router.back()} style={ps.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={ps.headerTitle}>Policies</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ps.scroll}>
        <Text style={ps.subtitle}>Required policies build buyer trust and protect your business.</Text>

        {/* Policy List */}
        {POLICY_TYPES.map(pt => {
          const status = policyStatus(pt.type);
          const existing = policies.find(p => p.type === pt.type);
          return (
            <BrandthreadCard key={pt.type} style={ps.policyCard}>
              <View style={ps.policyRow}>
                <View style={[ps.iconBox, { backgroundColor: PURPLE_DIM }]}>
                  <Feather name={pt.icon} size={ICON.md} color={PURPLE_LIGHT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ps.policyLabel}>{pt.label}</Text>
                  {existing && (
                    <Text style={ps.policyDate}>Updated {new Date(existing.updatedAt).toLocaleDateString()}</Text>
                  )}
                  <View style={ps.badgeRow}>
                    <StatusBadge
                      label={status.label}
                      variant={status.variant}
                      small
                    />
                    {existing?.reviewedBySeller && (
                      <StatusBadge label="Reviewed" variant="success" small />
                    )}
                  </View>
                </View>
              </View>
              <View style={ps.policyActions}>
                <SecondaryButton
                  label="Edit"
                  small
                  onPress={() => openEdit(pt.type)}
                  icon="edit-2"
                  style={{ flex: 1 }}
                />
                <SecondaryButton
                  label={generating && selectedType === pt.type ? 'Generating...' : 'Generate with AI'}
                  small
                  onPress={() => handleGenerate(pt.type)}
                  icon="zap"
                  accent={CYAN}
                  style={{ flex: 1 }}
                />
              </View>
            </BrandthreadCard>
          );
        })}

        {/* Edit Panel */}
        {selectedType && (
          <BrandthreadCard style={ps.editPanel}>
            <View style={ps.editHeader}>
              <Text style={ps.editTitle}>{selectedLabel}</Text>
              <TouchableOpacity onPress={closeEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={ICON.md} color={MUTED} />
              </TouchableOpacity>
            </View>

            {/* Warning banner */}
            <View style={[ps.banner, { borderColor: ORANGE, backgroundColor: ORANGE_DIM }]}>
              <Feather name="alert-triangle" size={ICON.sm} color={ORANGE} />
              <Text style={[ps.bannerText, { color: ORANGE }]}>
                This draft is not legal advice. Please review with a qualified professional before publishing.
              </Text>
            </View>

            {/* AI banner */}
            {aiGenerated && (
              <View style={[ps.banner, { borderColor: PURPLE, backgroundColor: PURPLE_DIM }]}>
                <Feather name="zap" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={[ps.bannerText, { color: PURPLE_LIGHT }]}>
                  AI-generated draft. Review carefully before saving.
                </Text>
              </View>
            )}

            <TextInput
              style={ps.contentInput}
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={12}
              placeholder="Policy content..."
              placeholderTextColor={SUBTLE}
              textAlignVertical="top"
            />

            <View style={ps.editActions}>
              {!aiGenerated && (
                <SecondaryButton
                  label={generating ? 'Generating...' : 'Generate with AI'}
                  onPress={() => handleGenerate(selectedType)}
                  icon="zap"
                  accent={CYAN}
                  style={{ flex: 1 }}
                />
              )}
              <PrimaryButton
                label={saving ? 'Saving...' : 'Save Policy'}
                onPress={handleSave}
                loading={saving}
                style={{ flex: 1 }}
              />
            </View>
          </BrandthreadCard>
        )}
      </ScrollView>
    </View>
  );
}

const ps = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md },
  policyCard: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  policyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md },
  iconBox: { width: 40, height: 40, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  policyLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  policyDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm, flexWrap: 'wrap' },
  policyActions: { flexDirection: 'row', gap: SP.sm },
  editPanel: { marginHorizontal: SP.md, marginTop: SP.sm, gap: SP.md },
  editHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    borderWidth: 1, borderRadius: RADIUS.sm, padding: SP.sm,
  },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  contentInput: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    padding: SP.md, minHeight: 200,
  },
  editActions: { flexDirection: 'row', gap: SP.sm },
});

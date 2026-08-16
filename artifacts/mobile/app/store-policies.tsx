/**
 * Brandthread — Store Policies
 * Wired to real backend: GET/PUT /api/seller/settings/policies
 * Falls back to storeService (AsyncStorage) if API unavailable.
 */
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
import { generatePolicyDraft } from '@/services/storeService';
import { useApi } from '@/lib/api';

export type PolicyType = 'shipping' | 'return' | 'refund' | 'privacy' | 'terms' | 'pre_order';

interface StorePolicy { type: PolicyType; content: string; updatedAt?: string; aiGenerated?: boolean; }

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
  const api = useApi();
  const [policies, setPolicies] = useState<StorePolicy[]>([]);
  const [selectedType, setSelectedType] = useState<PolicyType | null>(null);
  const [content, setContent] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      // Try real API first
      const data = await (api.seller as any).getPolicies() as any;
      setPolicies(Array.isArray(data.policies) ? data.policies : []);
    } catch {
      // Fallback to storeService (AsyncStorage)
      try {
        const { getPolicies } = await import('@/services/storeService');
        const p = await getPolicies();
        setPolicies(p);
      } catch {
        setPolicies([]);
      }
    } finally {
      setLoading(false);
    }
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
      // Try AI via backend
      try {
        const resp = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Write a concise, professional ${type.replace('_', '-')} policy for a fashion brand. Return only the policy text, no extra commentary.`,
          }),
        });
        if (resp.ok) {
          const j = await resp.json();
          const aiText = j.response ?? j.message ?? j.content ?? '';
          if (aiText.trim()) {
            setSelectedType(type);
            setContent(aiText.trim());
            setAiGenerated(true);
            return;
          }
        }
      } catch {}
      // Local fallback template
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
      const now = new Date().toISOString();
      const updated: StorePolicy[] = [
        ...policies.filter(p => p.type !== selectedType),
        { type: selectedType, content, aiGenerated, updatedAt: now },
      ];
      // Try real API
      try {
        await (api.seller as any).savePolicies(updated);
        setPolicies(updated);
      } catch {
        // Fallback to storeService
        const { upsertPolicy } = await import('@/services/storeService');
        await upsertPolicy(selectedType, content, aiGenerated);
        setPolicies(updated);
      }
      closeEdit();
      Alert.alert('Saved', 'Policy saved successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save policy.');
    } finally {
      setSaving(false);
    }
  };

  if (selectedType) {
    const policyMeta = POLICY_TYPES.find(p => p.type === selectedType)!;
    return (
      <View style={[s.root, { backgroundColor: BG }]}>
        <View style={[s.header, { borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={closeEdit} style={s.backBtn}><Feather name="x" size={21} color={FG} /></TouchableOpacity>
          <Text style={[s.headerTitle, { color: FG }]}>{policyMeta.label}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} style={[s.saveBtn, { backgroundColor: PURPLE, opacity: saving ? 0.6 : 1 }]}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>

        <View style={[s.aiBar, { backgroundColor: `${PURPLE}12`, borderBottomColor: BORDER }]}>
          <TouchableOpacity
            onPress={() => handleGenerate(selectedType)}
            disabled={generating}
            activeOpacity={0.7}
            style={[s.aiBtn, { backgroundColor: `${PURPLE}20`, borderColor: `${PURPLE}40` }]}
          >
            {generating ? (
              <><ActivityIndicator size="small" color={PURPLE} /><Text style={[s.aiBtnText, { color: PURPLE }]}>Generating…</Text></>
            ) : (
              <><Feather name="zap" size={14} color={PURPLE} /><Text style={[s.aiBtnText, { color: PURPLE }]}>Generate with AI</Text></>
            )}
          </TouchableOpacity>
          {aiGenerated && (
            <View style={[s.aiBadge, { backgroundColor: `${CYAN}20`, borderColor: `${CYAN}40` }]}>
              <Feather name="zap" size={12} color={CYAN} />
              <Text style={[s.aiBadgeText, { color: CYAN }]}>AI generated</Text>
            </View>
          )}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SP.md }}>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder={`Write your ${policyMeta.label.toLowerCase()} here…`}
            placeholderTextColor={SUBTLE}
            multiline
            style={[s.editor, { backgroundColor: CARD, borderColor: BORDER, color: FG }]}
            autoFocus
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: BG }]}>
      <View style={[s.header, { borderBottomColor: BORDER }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Feather name="arrow-left" size={21} color={FG} /></TouchableOpacity>
        <Text style={[s.headerTitle, { color: FG }]}>Store policies</Text>
        <View style={{ width: 70 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={PURPLE} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <Text style={[s.intro, { color: MUTED }]}>
            Add policies that explain how you handle shipping, returns, privacy, and more. Buyers can view these before and after purchase.
          </Text>

          <View style={[s.listCard, { backgroundColor: CARD, borderColor: BORDER }]}>
            {POLICY_TYPES.map((pt, i) => {
              const existing = policies.find(p => p.type === pt.type);
              const hasContent = !!existing?.content?.trim();
              return (
                <TouchableOpacity
                  key={pt.type}
                  onPress={() => openEdit(pt.type)}
                  activeOpacity={0.7}
                  style={[s.policyRow, i !== POLICY_TYPES.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER }]}
                >
                  <View style={[s.policyIcon, { backgroundColor: `${PURPLE}15` }]}>
                    <Feather name={pt.icon} size={17} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.policyLabel, { color: FG }]}>{pt.label}</Text>
                    {hasContent ? (
                      <Text style={[s.policySub, { color: MUTED }]} numberOfLines={1}>{existing!.content.slice(0, 60)}…</Text>
                    ) : (
                      <Text style={[s.policySub, { color: SUBTLE }]}>Not added yet</Text>
                    )}
                  </View>
                  <View style={s.policyRight}>
                    {hasContent && (
                      <View style={[s.statusDot, { backgroundColor: SUCCESS }]} />
                    )}
                    <Feather name="chevron-right" size={17} color={SUBTLE} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[s.tipCard, { backgroundColor: `${PURPLE}10`, borderColor: `${PURPLE}25` }]}>
            <Feather name="zap" size={15} color={PURPLE} style={{ marginTop: 1 }} />
            <Text style={[s.tipText, { color: MUTED }]}>
              Tap any policy and use <Text style={{ color: PURPLE, fontFamily: FONT.semibold }}>Generate with AI</Text> to create a first draft in seconds.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FS.base, fontFamily: FONT.bold },
  saveBtn: { borderRadius: RADIUS.sm, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
  aiBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SP.md, paddingVertical: 10, borderBottomWidth: 1 },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  aiBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  aiBadgeText: { fontSize: 11, fontFamily: FONT.semibold },
  editor: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, minHeight: 320, fontSize: FS.base, fontFamily: FONT.regular, lineHeight: 24, textAlignVertical: 'top' },
  intro: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20, marginBottom: 18 },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden', marginBottom: SP.lg },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  policyIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  policyLabel: { fontSize: 14, fontFamily: FONT.semibold },
  policySub: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  policyRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  tipCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: RADIUS.lg, borderWidth: 1, padding: 14 },
  tipText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
});

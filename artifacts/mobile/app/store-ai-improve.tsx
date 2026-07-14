import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, GOLD, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  FilterChip, StatusBadge, EmptyState,
} from '@/components/BrandthreadUI';
import {
  getStorefront, generateAISuggestions, applyAISuggestion, dismissAISuggestion,
} from '@/services/storeService';
import { Storefront, StoreAISuggestion } from '@/services/storeTypes';

type Category = StoreAISuggestion['category'] | 'all';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'layout', label: 'Layout' },
  { value: 'branding', label: 'Branding' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'product', label: 'Product' },
  { value: 'copy', label: 'Copy' },
  { value: 'navigation', label: 'Navigation' },
  { value: 'accessibility', label: 'Accessibility' },
  { value: 'performance', label: 'Performance' },
];

function categoryVariant(cat: StoreAISuggestion['category']): 'purple' | 'info' | 'success' | 'warning' | 'neutral' {
  if (cat === 'layout') return 'purple';
  if (cat === 'branding') return 'info';
  if (cat === 'conversion') return 'success';
  if (cat === 'mobile') return 'info';
  if (cat === 'product') return 'warning';
  if (cat === 'copy') return 'neutral';
  if (cat === 'navigation') return 'neutral';
  if (cat === 'accessibility') return 'info';
  if (cat === 'performance') return 'warning';
  return 'neutral';
}

export default function StoreAiImproveScreen() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<StoreAISuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category>('all');
  const [showDismissed, setShowDismissed] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const s = await getStorefront();
      setSuggestions(s.aiSuggestions);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await generateAISuggestions();
      await load();
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    handleRefresh();
  }, []));

  const handleApply = (sug: StoreAISuggestion) => {
    Alert.alert(
      'Apply this change?',
      sug.recommendation,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply', onPress: async () => {
            await applyAISuggestion(sug.id);
            await load();
          },
        },
      ],
    );
  };

  const handleDismiss = async (sug: StoreAISuggestion) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await dismissAISuggestion(sug.id);
    await load();
  };

  const handleRestore = async (sug: StoreAISuggestion) => {
    const s = await getStorefront();
    const found = s.aiSuggestions.find(x => x.id === sug.id);
    if (found) {
      found.dismissed = false;
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem('bt:store:v1', JSON.stringify(s));
    }
    await load();
  };

  const active = suggestions.filter(s => !s.dismissed && !s.applied);
  const applied = suggestions.filter(s => s.applied);
  const dismissed = suggestions.filter(s => s.dismissed);

  const filtered = active.filter(s => activeCategory === 'all' || s.category === activeCategory);

  return (
    <View style={ai.root}>
      <View style={ai.header}>
        <TouchableOpacity onPress={() => router.back()} style={ai.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={ai.headerTitle}>Improve Store</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ai.scroll}>
        <Text style={ai.subtitle}>AI-powered suggestions to improve your storefront.</Text>

        <SecondaryButton
          label={loading ? 'Refreshing...' : 'Refresh Suggestions'}
          onPress={handleRefresh}
          icon="refresh-cw"
          style={ai.refreshBtn}
        />

        {/* Category Chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ai.chipScroll} contentContainerStyle={ai.chipRow}>
          {CATEGORIES.map(cat => (
            <FilterChip
              key={cat.value}
              label={cat.label}
              active={activeCategory === cat.value}
              onPress={() => setActiveCategory(cat.value)}
            />
          ))}
        </ScrollView>

        {/* Active Suggestions */}
        {filtered.length === 0 && !loading ? (
          <EmptyState
            icon="check-circle"
            title="No suggestions right now"
            description="Your store looks good! Check back after making changes."
            action={{ label: 'Refresh', onPress: handleRefresh, icon: 'refresh-cw' }}
            style={ai.emptyState}
          />
        ) : (
          filtered.map(sug => (
            <GradientCard key={sug.id} colors={GRAD_CARD_GLOW} style={ai.sugCard} glow>
              <View style={ai.sugHeader}>
                <StatusBadge label={sug.category} variant={categoryVariant(sug.category)} small />
              </View>
              <Text style={ai.sugTitle}>{sug.title}</Text>
              <Text style={ai.sugFieldLabel}>Problem:</Text>
              <Text style={ai.sugFieldValue}>{sug.problem}</Text>
              <Text style={ai.sugFieldLabel}>Recommendation:</Text>
              <Text style={ai.sugFieldValue}>{sug.recommendation}</Text>
              {sug.previewChange && (
                <>
                  <Text style={ai.sugFieldLabel}>Preview:</Text>
                  <Text style={ai.sugPreview}>{sug.previewChange}</Text>
                </>
              )}
              <View style={ai.sugActions}>
                {sug.previewChange && (
                  <TouchableOpacity
                    style={ai.previewBtn}
                    onPress={() => Alert.alert('Preview', sug.previewChange ?? '')}
                  >
                    <Feather name="eye" size={ICON.xs} color={MUTED} />
                    <Text style={ai.previewBtnText}>Preview</Text>
                  </TouchableOpacity>
                )}
                <SecondaryButton label="Dismiss" small accent={MUTED} onPress={() => handleDismiss(sug)} style={{ flex: 1 }} />
                <PrimaryButton label="Apply" small onPress={() => handleApply(sug)} style={{ flex: 1 }} />
              </View>
            </GradientCard>
          ))
        )}

        {/* Applied */}
        {applied.length > 0 && (
          <>
            <Text style={ai.sectionLabel}>Applied Changes</Text>
            {applied.map(sug => (
              <BrandthreadCard key={sug.id} style={ai.appliedCard}>
                <View style={ai.appliedRow}>
                  <Feather name="check-circle" size={ICON.sm} color={SUCCESS} />
                  <Text style={ai.appliedTitle} numberOfLines={1}>{sug.title}</Text>
                  <StatusBadge label={sug.category} variant={categoryVariant(sug.category)} small />
                </View>
              </BrandthreadCard>
            ))}
          </>
        )}

        {/* Dismissed toggle */}
        {dismissed.length > 0 && (
          <>
            <TouchableOpacity style={ai.dismissedToggle} onPress={() => setShowDismissed(v => !v)}>
              <Text style={ai.dismissedToggleText}>{showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed.length})</Text>
              <Feather name={showDismissed ? 'chevron-up' : 'chevron-down'} size={ICON.xs} color={MUTED} />
            </TouchableOpacity>
            {showDismissed && dismissed.map(sug => (
              <BrandthreadCard key={sug.id} style={[ai.sugCard, ai.dismissedCard]}>
                <Text style={[ai.sugTitle, { color: MUTED }]}>{sug.title}</Text>
                <SecondaryButton label="Restore" small accent={PURPLE_LIGHT} onPress={() => handleRestore(sug)} />
              </BrandthreadCard>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const ai = StyleSheet.create({
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
  refreshBtn: { marginHorizontal: SP.md, marginBottom: SP.md },
  chipScroll: { marginBottom: SP.md },
  chipRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md },
  emptyState: { paddingTop: SP.xl },
  sugCard: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.sm },
  sugHeader: { flexDirection: 'row', alignItems: 'center' },
  sugTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  sugFieldLabel: { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  sugFieldValue: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 18 },
  sugPreview: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, fontStyle: 'italic', lineHeight: 18 },
  sugActions: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm },
  previewBtnText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  sectionLabel: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginHorizontal: SP.md, marginTop: SP.md, marginBottom: SP.sm },
  appliedCard: { marginHorizontal: SP.md, marginBottom: SP.sm },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  appliedTitle: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  dismissedToggle: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', padding: SP.md },
  dismissedToggleText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  dismissedCard: { opacity: 0.5 },
});

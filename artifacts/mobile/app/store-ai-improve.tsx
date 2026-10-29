import { haptic } from '@/lib/haptics';
import React, { useState, useCallback, useRef } from 'react';
import { useColors } from '@/hooks/useColors';

import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';

import { useRouter, useFocusEffect } from 'expo-router';

import { Icon } from '@/components/ui/Icon';

import { Feather } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';

import { GRAD_CARD_GLOW, FONT, FS, SP, ICON } from '@/lib/theme';

import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, FilterChip, StatusBadge, EmptyState } from '@/components/BrandthreadUI';

import { getStorefront, generateAISuggestions, applyAISuggestion, dismissAISuggestion, storefrontStorageKey, AISuggestionsUnavailableError } from '@/services/storeService';
import { Storefront, StoreAISuggestion } from '@/services/storeTypes';

import { ChipRow } from '@/components/ui/ChipRow';

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
  const colors = useColors();
  const {
    primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN,
    foreground: FG, mutedForeground: MUTED, subtle: SUBTLE, success: SUCCESS,
  } = colors;
  const ai = React.useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<StoreAISuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  // Real AI only: when the server has no AI configured we say so instead of
  // showing canned tips. `loadError` is any other failure (network, 5xx).
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async (): Promise<StoreAISuggestion[]> => {
    const s = await getStorefront({ refreshRemote: false });
    setSuggestions(s.aiSuggestions);
    return s.aiSuggestions;
  };

  // Each refresh is a paid AI generation; the button stays tappable while one runs.
  const refreshing = useRef(false);
  const handleRefresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      await generateAISuggestions();
      setUnavailable(null);
    } catch (e) {
      if (e instanceof AISuggestionsUnavailableError) setUnavailable(e.message);
      else setLoadError(e instanceof Error ? e.message : "Couldn't get suggestions right now.");
    } finally {
      await load().catch(() => {});
      setLoading(false);
      refreshing.current = false;
    }
  };

  useFocusEffect(useCallback(() => {
    // Only call the AI when there is nothing open to review.
    load()
      .then(list => {
        if (list.some(s => !s.dismissed && !s.applied)) setLoading(false);
        else void handleRefresh();
      })
      .catch(() => { void handleRefresh(); });
  }, []));

  const runApply = async (sug: StoreAISuggestion) => {
    try {
      const result = await applyAISuggestion(sug.id);
      if (result.navigateTo) {
        router.push(result.navigateTo as never);
        return;
      }
      haptic('save');
      await load();
    } catch (e) {
      Alert.alert("Couldn't apply", e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleApply = (sug: StoreAISuggestion) => {
    if (sug.action?.type === 'open_screen') {
      void runApply(sug);
      return;
    }
    Alert.alert(
      'Apply this change?',
      sug.previewChange ? `${sug.recommendation}\n\n${sug.previewChange}` : sug.recommendation,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply', onPress: () => { void runApply(sug); } },
      ],
    );
  };

  const handleDismiss = async (sug: StoreAISuggestion) => {
    await dismissAISuggestion(sug.id);
    await load();
  };

  const handleRestore = async (sug: StoreAISuggestion) => {
    const s = await getStorefront({ refreshRemote: false });
    const found = s.aiSuggestions.find(x => x.id === sug.id);
    if (found) {
      found.dismissed = false;
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem(await storefrontStorageKey(), JSON.stringify(s));
    }
    await load();
  };

  const active = suggestions.filter(s => !s.dismissed && !s.applied);
  const applied = suggestions.filter(s => s.applied);
  const dismissed = suggestions.filter(s => s.dismissed);

  const filtered = active.filter(s => activeCategory === 'all' || s.category === activeCategory);

  return (
    <View style={ai.root}>
      <ScreenHeader title="Improve Store" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ai.scroll}>
        <SecondaryButton
          label={loading ? 'Refreshing...' : 'Refresh Suggestions'}
          onPress={handleRefresh}
          icon="refresh-cw"
          style={ai.refreshBtn}
        />

        {/* Category Chips */}
        <ChipRow style={ai.chipScroll} contentContainerStyle={ai.chipRow} selectedIndex={CATEGORIES.findIndex(cat => cat.value === activeCategory)} hapticOnSelect={false}>
          {CATEGORIES.map(cat => (
            <FilterChip
              key={cat.value}
              label={cat.label}
              active={activeCategory === cat.value}
              onPress={() => setActiveCategory(cat.value)}
            />
          ))}
        </ChipRow>

        {/* Active Suggestions */}
        {filtered.length === 0 && loading ? (
          <ActivityIndicator color={MUTED} style={ai.loader} />
        ) : unavailable && filtered.length === 0 ? (
          <EmptyState
            icon="cloud-off"
            title="AI suggestions unavailable"
            description={unavailable}
            style={ai.emptyState}
          />
        ) : loadError && filtered.length === 0 && !loading ? (
          <EmptyState
            icon="alert-circle"
            title="Couldn't load suggestions"
            description={loadError}
            action={{ label: 'Try again', onPress: handleRefresh, icon: 'refresh-cw' }}
            style={ai.emptyState}
          />
        ) : filtered.length === 0 && !loading ? (
          <EmptyState
            icon="check-circle"
            title="No suggestions right now"
            description="Your store looks good. Check back after making changes."
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
                    <Icon name="eye" size={ICON.xs} color={MUTED} />
                    <Text style={ai.previewBtnText}>Preview</Text>
                  </TouchableOpacity>
                )}
                <SecondaryButton label="Dismiss" small accent={MUTED} onPress={() => handleDismiss(sug)} style={{ flex: 1 }} />
                <PrimaryButton label={sug.action?.type === 'open_screen' ? 'Open' : 'Apply'} small onPress={() => handleApply(sug)} style={{ flex: 1 }} />
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
                  <Icon name="check-circle" size={ICON.sm} color={SUCCESS} />
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
              <Icon name={showDismissed ? 'chevron-up' : 'chevron-down'} size={ICON.xs} color={MUTED} />
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

const makeStyles = (colors: ReturnType<typeof useColors>) => {
  const { foreground: FG, mutedForeground: MUTED, subtle: SUBTLE } = colors;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md },
  refreshBtn: { marginHorizontal: SP.md, marginBottom: SP.md },
  chipScroll: { marginBottom: SP.md },
  chipRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md },
  emptyState: { paddingTop: SP.xl },
  loader: { paddingTop: SP.xl },
  sugCard: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.sm },
  sugHeader: { flexDirection: 'row', alignItems: 'center' },
  sugTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  sugFieldLabel: { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED },
  sugFieldValue: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 18 },
  sugPreview: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, fontStyle: 'italic', lineHeight: 18 },
  sugActions: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm },
  previewBtnText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  sectionLabel: { fontSize: FS.sm, fontFamily: FONT.bold, color: MUTED, marginHorizontal: SP.md, marginTop: SP.md, marginBottom: SP.sm },
  appliedCard: { marginHorizontal: SP.md, marginBottom: SP.sm },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  appliedTitle: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  dismissedToggle: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', padding: SP.md },
  dismissedToggleText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  dismissedCard: { opacity: 0.5 },
  });
};

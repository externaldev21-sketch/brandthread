/**
 * SizeRecommendationBadge — "Your size: M" / "Recommended: M" with a reason
 * line, or a single "Find my size" row (routes to My sizes) when the product
 * has a size chart but the buyer has nothing saved. Renders nothing otherwise.
 * It never selects a size — the chip is only marked (see RecommendedTag).
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useBuyerPreferences } from '@/hooks/useBuyerPreferences';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { buildSizeBadgeModel, type SizeBadgeModel, type SizeBadgeProduct } from '@/lib/sizeBadge';
import type { BuyerSizePreferences } from '@/lib/sizeRecommendation';

/** Seeded saved sizes, only in the &demo=1 preview. */
const DEMO_PREFERENCES: BuyerSizePreferences = { sizes: { tops: 'M', outerwear: 'M', bottoms: 'M', shoes: '9' } };

export function useSizeBadgeModel(product: SizeBadgeProduct | null | undefined): SizeBadgeModel | null {
  const { preferences, status } = useBuyerPreferences();
  return useMemo(() => {
    const prefs = status === 'signed-out' && isPreviewDemoMode() ? DEMO_PREFERENCES : preferences;
    return buildSizeBadgeModel(product, prefs);
  }, [product, preferences, status]);
}

export function SizeRecommendationBadge({
  model, onBeforeNavigate,
}: {
  model: SizeBadgeModel | null;
  /** Called before routing to My sizes (e.g. to close a Modal sheet first). */
  onBeforeNavigate?: () => void;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const st = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, marginBottom: SP.sm },
    textCol: { flex: 1 },
    title: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
    reason: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
    find: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 44, marginBottom: SP.sm,
      paddingHorizontal: SP.md, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border,
    },
    findText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  }), [theme]);
  if (!model) return null;

  if (model.kind === 'find') {
    return (
      <TouchableOpacity
        style={st.find}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Find my size"
        testID="size-find-my-size"
        onPress={() => { onBeforeNavigate?.(); router.push('/buyer-my-sizes' as never); }}
      >
        <Feather name="search" size={14} color={theme.text} />
        <Text style={st.findText}>Find my size</Text>
        <Feather name="chevron-right" size={16} color={theme.muted} />
      </TouchableOpacity>
    );
  }
  return (
    <View style={st.row} testID="size-recommendation" accessible accessibilityLabel={`${model.title}. ${model.reason}`}>
      <Feather name="check-circle" size={16} color={theme.text} />
      <View style={st.textCol}>
        <Text style={st.title}>{model.title}</Text>
        <Text style={st.reason}>{model.reason}</Text>
      </View>
    </View>
  );
}

/** Micro-label shown under the marked size chip. */
export function RecommendedTag() {
  const { theme } = useAppTheme();
  return (
    <Text style={{ fontSize: 10, fontFamily: FONT.medium, color: theme.muted, marginTop: 3, textAlign: 'center' }}>
      Recommended
    </Text>
  );
}

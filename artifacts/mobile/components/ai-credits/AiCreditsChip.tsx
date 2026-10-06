import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useAiCredits } from '@/hooks/useAiCredits';
import type { AiCreditsOverview } from '@/lib/aiCredits';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';

/**
 * Small balance chip for AI tool screens. Opens the AI credits screen.
 * Renders nothing for Pro (unlimited), when signed out, or before the balance is known.
 */
export function AiCreditsChip({ overview: given }: { overview?: AiCreditsOverview | null } = {}) {
  const fetched = useAiCredits().overview;
  const overview = given === undefined ? fetched : given;
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (!overview || overview.unlimited || overview.balance == null) return null;
  const label = `${overview.balance.toLocaleString('en-US')} credits`;
  return (
    <PressableScale
      onPress={() => router.push('/ai-credits' as never)}
      accessibilityRole="button"
      accessibilityLabel={`AI credits, ${label}`}
      style={styles.chip}
    >
      <View style={styles.row}>
        <Feather name="zap" size={14} color={theme.text} />
        <Text style={[styles.text, TABULAR_NUMS]} numberOfLines={1}>{label}</Text>
      </View>
    </PressableScale>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', minHeight: 32, paddingHorizontal: 12, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
});

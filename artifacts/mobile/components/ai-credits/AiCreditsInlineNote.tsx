import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useAiCredits } from '@/hooks/useAiCredits';
import { useCreditPackPurchase } from '@/hooks/useCreditPackPurchase';
import { Button } from '@/components/ui/Button';
import { creditsNoteState, formatPackPrice, topUpPack, topUpRoute, type AiCreditsOverview } from '@/lib/aiCredits';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';

/**
 * One subtle inline note for AI tool screens, never a pop-up.
 *  - at or below 20% of the allowance: "N credits left"
 *  - at 0: a one-tap "Top up $4.99" (the cheapest pack, Starter/Growth only)
 *    above the "Top up or upgrade" row (packs for Starter/Growth, plans otherwise)
 * Renders nothing for Pro, when signed out, or while the balance is healthy.
 */
export function AiCreditsInlineNote({ overview: given }: { overview?: AiCreditsOverview | null } = {}) {
  const credits = useAiCredits();
  const fetched = credits.overview;
  const purchase = useCreditPackPurchase();
  const overview = given === undefined ? fetched : given;
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const state = creditsNoteState(overview);
  if (!overview || state === 'none') return null;

  if (state === 'low') {
    return (
      <View style={styles.low} accessibilityRole="text">
        <Text style={[styles.lowText, TABULAR_NUMS]}>{(overview.balance ?? 0).toLocaleString('en-US')} credits left</Text>
      </View>
    );
  }
  const target = topUpRoute(overview);
  const pack = purchase.canBuy(overview) ? topUpPack(overview) : null;
  const row = (
    <PressableScale
      onPress={() => router.push(target as never)}
      accessibilityRole="button"
      accessibilityLabel="Top up or upgrade"
      style={styles.empty}
    >
      <View style={styles.emptyRow}>
        <Text style={styles.emptyLabel}>Top up or upgrade</Text>
        <Icon name="chevron-right" size={18} color={theme.text} />
      </View>
    </PressableScale>
  );
  if (!pack) return row;
  const price = formatPackPrice(pack.amountCents);
  return (
    <View style={styles.stack}>
      <Button
        label={`Top up ${price}`}
        onPress={() => {
          void purchase.buyPack(pack, overview.balance ?? 0).then((r) => { if (r === 'purchased') void credits.refresh(); });
        }}
        loading={purchase.buyingId === pack.id}
        accessibilityLabel={`Top up ${pack.credits.toLocaleString('en-US')} credits for ${price}`}
        fullWidth
        testID="ai-credits-note-top-up"
      />
      {row}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  low: { paddingVertical: SP.xs },
  stack: { gap: SP.sm },
  lowText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  empty: {
    minHeight: 52, paddingHorizontal: 16, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.card, justifyContent: 'center',
  },
  emptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emptyLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
});

/**
 * One seller plan card, used by the onboarding plan step and Settings → Plan.
 * Dev's order: name and price, the active-product count as the headline,
 * then the key differences. Every line comes from the shared plan config
 * (lib/planTiers.ts); nothing is hard-coded here.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { radius } from '@/constants/radii';
import { keyDifferences, productHeadline, type PlanTier } from '@/lib/planTiers';

export function PlanTierCard({
  tier, below, selected, onSelect, priceLabel, badge, testID, footer,
}: {
  tier: PlanTier;
  /** The tier under this one, so the card names only what this tier adds. */
  below: PlanTier | null;
  selected: boolean;
  onSelect?: () => void;
  /** "$49", or null while the store price loads. */
  priceLabel: string | null;
  /** "Recommended" / "Current plan". */
  badge?: string | null;
  testID?: string;
  /** Under the lines, e.g. a "Switch to Growth" button. Without onSelect the card isn't selectable. */
  footer?: React.ReactNode;
}) {
  const palette = useColors();
  const lines = keyDifferences(tier, below);
  const headline = productHeadline(tier.limits);
  const selectable = !!onSelect;
  return (
    <Pressable
      testID={testID}
      onPress={onSelect}
      disabled={!selectable}
      accessibilityRole={selectable ? 'radio' : undefined}
      accessibilityState={selectable ? { selected } : undefined}
      accessibilityLabel={`${tier.name}${priceLabel ? `, ${priceLabel} a month` : ''}. ${headline}. ${lines.join('. ')}`}
      style={[styles.card, { borderColor: selected ? palette.foreground : 'transparent' }]}
    >
      <View style={styles.top}>
        {selectable ? (
          <View style={[styles.radio, { borderColor: selected ? palette.foreground : palette.mutedForeground }]}>
            {selected ? <View style={[styles.radioDot, { backgroundColor: palette.foreground }]} /> : null}
          </View>
        ) : null}
        <View style={styles.nameBlock}>
          <Text style={[styles.name, { color: palette.foreground }]}>{tier.name}</Text>
          {badge ? <Text style={[styles.badge, { color: palette.mutedForeground }]}>{badge}</Text> : null}
        </View>
        {priceLabel ? (
          <Text style={[styles.price, { color: palette.foreground }]}>
            {priceLabel}<Text style={[styles.per, { color: palette.mutedForeground }]}>/mo</Text>
          </Text>
        ) : (
          <ActivityIndicator size="small" color={palette.mutedForeground} />
        )}
      </View>

      <Text testID={testID ? `${testID}-headline` : undefined} style={[styles.headline, { color: palette.foreground }]}>
        {headline}
      </Text>

      {lines.length > 0 ? (
        <View style={styles.lines}>
          {lines.map((line) => (
            <View key={line} style={styles.line}>
              <Icon name="check" size={17} color={palette.mutedForeground} />
              <Text style={[styles.lineText, { color: palette.mutedForeground }]}>{line}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {footer}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SPACING.md,
    borderRadius: radius.md,
    backgroundColor: FILL_ELEVATED,
    borderWidth: 1,
    gap: SPACING.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  nameBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: SPACING.xs },
  name: { ...TEXT.headline },
  badge: { ...TEXT.caption, fontFamily: FONT.medium },
  price: { ...TEXT.money },
  per: { ...TEXT.footnote },
  headline: { ...TEXT.title2 },
  lines: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.xs },
  lineText: { ...TEXT.subhead, flex: 1 },
});

/**
 * Shown when a seller taps Publish at their plan's active-product cap:
 * "You've listed 10 of 10 products on Starter. Upgrade to Growth to list up
 * to 50." The product can still be saved as a draft. The server enforces the
 * cap; this sheet only explains it, with numbers from the shared plan config.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { productCapCopy, type PlanTier } from '@/lib/planTiers';
import type { SellerPlanId } from '@/lib/sellerBilling';

export function ProductCapSheet({
  visible, onClose, tiers, currentPlanId, used, onUpgrade, onSaveDraft,
}: {
  visible: boolean;
  onClose: () => void;
  tiers: PlanTier[];
  currentPlanId: SellerPlanId;
  /** Active products the server counted. */
  used: number;
  onUpgrade: (planId: SellerPlanId) => void;
  onSaveDraft?: () => void;
}) {
  const palette = useColors();
  const copy = productCapCopy(tiers, currentPlanId, used);
  if (!copy) return null;
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="product-cap-sheet">
      <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{copy.title}</Text>
      <Text testID="product-cap-sheet-body" style={[styles.body, { color: palette.mutedForeground }]}>{copy.body}</Text>
      <View style={styles.actions}>
        {copy.next ? (
          <Button label={`Upgrade to ${copy.next.name}`} onPress={() => onUpgrade(copy.next!.id)} fullWidth testID="product-cap-upgrade" />
        ) : null}
        {onSaveDraft ? (
          <Button label="Save as draft" variant="secondary" onPress={onSaveDraft} fullWidth testID="product-cap-save-draft" />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...TEXT.headline },
  body: { ...TEXT.subhead, marginTop: SPACING.xs },
  actions: { gap: SPACING.sm, marginTop: SPACING.lg },
});

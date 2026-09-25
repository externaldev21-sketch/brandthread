/**
 * Brandthread Design System — SuccessSheet (Motion Phase 2)
 *
 * A generic "it worked" confirmation sheet: SuccessCheck + title + optional
 * subtitle + up to two actions, built on the shared BottomSheet primitive
 * (which already handles the web-shell width cap, safe-area padding and
 * keyboard-aware scrolling). For any success moment that previously showed a
 * plain OS Alert ("Product published!", "Verification approved", …) instead
 * of a designed confirmation — layout modeled on the buy-now flow's
 * OrderSuccessSheet, which keeps its own richer bespoke layout (order/
 * shipping details, a maps card) rather than being rebuilt on top of this.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { Button, ButtonProps } from '@/components/ui/Button';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export interface SuccessSheetAction {
  label: string;
  onPress: () => void;
  variant?: ButtonProps['variant'];
}

export interface SuccessSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  primaryAction: SuccessSheetAction;
  secondaryAction?: SuccessSheetAction;
  testID?: string;
}

export function SuccessSheet({
  visible, onClose, title, subtitle, primaryAction, secondaryAction, testID,
}: SuccessSheetProps) {
  const { theme } = useAppTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.content}>
        <SuccessCheck />
        <Text style={[TYPE_SCALE.title2, styles.title, { color: theme.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[TYPE_SCALE.body, styles.subtitle, { color: theme.muted }]}>{subtitle}</Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={primaryAction.label}
            onPress={primaryAction.onPress}
            variant={primaryAction.variant ?? 'primary'}
            fullWidth
          />
          {secondaryAction ? (
            <Button
              label={secondaryAction.label}
              onPress={secondaryAction.onPress}
              variant={secondaryAction.variant ?? 'secondary'}
              fullWidth
              style={styles.secondaryBtn}
            />
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm, gap: SPACING.xs },
  title: { textAlign: 'center', marginTop: SPACING.md },
  subtitle: { textAlign: 'center' },
  actions: { width: '100%', marginTop: SPACING.md, gap: SPACING.sm },
  secondaryBtn: { marginTop: 0 },
});

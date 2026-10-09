/**
 * Full-height order sheet chrome — Shopify iOS "Fulfill item" / "Refund":
 * Cancel on the left, a centred title with the order number under it, the
 * form in one scroll, the confirm button(s) at the end of it. Used by the
 * order detail's fulfil and refund sheets (and batch ship).
 */
import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Button } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { a11yModalProps } from '@/lib/a11y/modal';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT, SP } from '@/lib/theme';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';

/** Inputs and sheets are solid #1C1C1E (Dev's palette rule). */
export const SHEET_FIELD_BG = '#1C1C1E';

export function FullSheet({
  visible, title, subtitle, onCancel, right, children, footer, testID, overlay,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onCancel: () => void;
  /** Optional trailing header control (e.g. batch "Skip"). */
  right?: React.ReactNode;
  children: React.ReactNode;
  /** Confirm button(s), rendered at the end of the scroll like the reference. */
  footer?: React.ReactNode;
  testID?: string;
  /** Rendered above everything inside the modal (barcode scanner, pickers). */
  overlay?: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const top = useHeaderTopInset();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} testID={testID}>
      <View {...a11yModalProps()} style={[styles.root, { backgroundColor: theme.background, paddingTop: top }]}>
        <View style={styles.header}>
          <View style={styles.side}>
            <Button label="Cancel" variant="tertiary" size="compact" onPress={onCancel} style={styles.sideBtn} testID={testID ? `${testID}-cancel` : undefined} />
          </View>
          <View style={styles.titleBlock}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>{title}</Text>
            {subtitle ? <Text style={[TYPE_SCALE.footnote, { color: theme.muted }]} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>{subtitle}</Text> : null}
          </View>
          <View style={[styles.side, { alignItems: 'flex-end' }]}>{right}</View>
        </View>
        <KeyboardAwareScrollViewCompat
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
          showsVerticalScrollIndicator={false}
        >
          {children}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </KeyboardAwareScrollViewCompat>
        {overlay}
      </View>
    </Modal>
  );
}

/** A titled block of the sheet, separated from the next by a thick band (Shopify grouping). */
export function SheetSection({ title, children, last }: { title?: string; children: React.ReactNode; last?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.section, !last && { borderBottomWidth: 8, borderBottomColor: SHEET_FIELD_BG }]}>
      {title ? <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: SP.sm }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.sm, paddingBottom: SP.sm, minHeight: 52 },
  side: { width: 88 },
  sideBtn: { alignSelf: 'flex-start', paddingHorizontal: SP.sm },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, lineHeight: 22, fontFamily: FONT.semibold },
  section: { paddingHorizontal: SP.md, paddingVertical: SP.md },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
});

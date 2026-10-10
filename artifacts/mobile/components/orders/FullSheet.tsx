/**
 * Full-height order sheet chrome — Shopify iOS "Fulfill item" / "Refund":
 * Cancel on the left, a centred title with the order number under it, the
 * form in one scroll, the confirm button(s) at the end of it. Used by the
 * order detail's fulfil and refund sheets (and batch ship).
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Button, Icon, ICON_SIZE } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { a11yModalProps } from '@/lib/a11y/modal';
import { TYPE_SCALE } from '@/constants/typography';
import { FILL_ELEVATED, FONT, SP, TEXT } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';

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

/** A titled block of the sheet, separated from the next by a full-width hairline (BRANDTHREAD_DESIGN.md: lists, not cards). */
export function SheetSection({ title, children, last }: { title?: string; children: React.ReactNode; last?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.section, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
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
  section: { paddingHorizontal: SP.md, paddingVertical: SP.lg },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
  picker: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 52, paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: radius.md, backgroundColor: FILL_ELEVATED, marginBottom: SP.sm },
});

/**
 * A picker that looks like the shared `Input` (same fill, label inside the
 * field, no resting border) with a chevron: "Shipping carrier", "Reason".
 */
export function SheetPickerField({ label, value, placeholder, onPress, testID }: {
  label: string;
  value: string | null | undefined;
  placeholder: string;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value || 'not selected'}`}
      style={styles.picker}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <Text style={[TEXT.caption, { fontFamily: FONT.medium, color: theme.muted }]}>{label}</Text>
        <Text style={[TEXT.body, { color: value ? theme.text : theme.muted }]}>{value || placeholder}</Text>
      </View>
      <Icon name="chevron-right" size={ICON_SIZE.md} color={theme.muted} />
    </Pressable>
  );
}

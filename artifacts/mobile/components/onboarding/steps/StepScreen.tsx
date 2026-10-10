/**
 * One onboarding question per screen, laid out like Instagram's sign-up
 * (https://mobbin.com/flows/4a6da069-d7db-4720-94e6-db74d80428c0):
 * big left-aligned bold question, one short grey line, ONE input, the
 * full-width primary button directly under it, an optional outline button for
 * the other method, and an optional text link pinned at the bottom
 * ("I already have an account"). `docked` sits at the very bottom above the
 * keyboard (email domain chips, the birthday wheel).
 *
 * The back chevron lives in the onboarding header (app/onboarding.tsx), so
 * every step's title sits in the same place.
 */
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Button } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';

export interface StepAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

export function StepScreen({
  title,
  subtitle,
  children,
  error,
  primary,
  secondary,
  extraSecondary,
  footerLink,
  docked,
  pinActions = false,
  testID,
}: {
  title: string;
  /** One short grey line; may contain inline links. */
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  error?: string | null;
  primary?: StepAction;
  secondary?: StepAction;
  /** A second outline button (Apple and Google on the email step). */
  extraSecondary?: StepAction;
  footerLink?: StepAction;
  docked?: React.ReactNode;
  /** Long lists (brands, styles): keep the buttons pinned at the bottom instead of under the content. */
  pinActions?: boolean;
  testID?: string;
}) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const actions = (
    <>
      {primary ? (
        <Button
          label={primary.label}
          onPress={primary.onPress}
          disabled={primary.disabled}
          loading={primary.loading}
          testID={primary.testID}
          fullWidth
          style={[styles.primary, (primary.disabled || primary.loading) && styles.disabledFill]}
        />
      ) : null}
      {secondary ? (
        <Button
          label={secondary.label}
          onPress={secondary.onPress}
          disabled={secondary.disabled}
          loading={secondary.loading}
          testID={secondary.testID}
          variant="secondary"
          fullWidth
          style={styles.secondary}
        />
      ) : null}
      {extraSecondary ? (
        <Button
          label={extraSecondary.label}
          onPress={extraSecondary.onPress}
          disabled={extraSecondary.disabled}
          loading={extraSecondary.loading}
          testID={extraSecondary.testID}
          variant="secondary"
          fullWidth
          style={styles.secondary}
        />
      ) : null}
    </>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <ScrollView
        testID={testID}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>{subtitle}</Text> : null}
        {children ? <View style={styles.body}>{children}</View> : null}
        {error ? (
          <Text testID="onboarding-step-error" accessibilityLiveRegion="polite" style={[styles.error, { color: palette.destructive }]}>{error}</Text>
        ) : null}
        {pinActions ? null : actions}
      </ScrollView>
      {pinActions ? (
        <View style={[styles.pinned, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>{actions}</View>
      ) : null}
      {footerLink ? (
        <Pressable
          onPress={footerLink.onPress}
          accessibilityRole="link"
          testID={footerLink.testID}
          hitSlop={8}
          style={styles.footerLink}
        >
          <Text style={[styles.footerLinkText, { color: palette.foreground }]}>{footerLink.label}</Text>
        </Pressable>
      ) : null}
      {docked}
    </KeyboardAvoidingView>
  );
}

/** Small inline text link for a subtitle ("Why do I need to provide my birthday?"). */
export function InlineLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const palette = useColors();
  return (
    <Text
      onPress={onPress}
      accessibilityRole="link"
      testID={testID}
      suppressHighlighting
      style={{ color: palette.foreground, fontFamily: FONT.semibold }}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingTop: SPACING.sm, paddingBottom: SPACING.xl },
  title: { ...TEXT.title1 },
  subtitle: { ...TEXT.subhead, marginTop: SPACING.sm },
  body: { marginTop: SPACING.lg },
  error: { ...TEXT.footnote, marginTop: SPACING.sm },
  primary: { marginTop: SPACING.md },
  secondary: { marginTop: SPACING.sm },
  pinned: { paddingTop: SPACING.xs },
  // The shared Button's disabled fill is the (now black) card color, which
  // disappears on a black screen; keep it visible as Instagram does.
  disabledFill: { backgroundColor: FILL_ELEVATED },
  footerLink: { alignSelf: 'center', paddingVertical: SPACING.md },
  footerLinkText: { ...TEXT.subhead, fontFamily: FONT.semibold },
});

/**
 * Shared frame for the store identity setup steps: bare-back ScreenHeader, a
 * bold step heading, scrolling fields, and one full-width black CTA pinned to
 * the bottom safe area (Depop "Start selling" / Shopify setup step layout).
 */
import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';

interface Props {
  header: React.ReactNode;
  heading: string;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  ctaLoading?: boolean;
  children: React.ReactNode;
}

export function StoreSetupScreen({ header, heading, ctaLabel, onCta, ctaDisabled, ctaLoading, children }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.heading, { color: theme.text }]} accessibilityRole="header">{heading}</Text>
        {children}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <Button label={ctaLabel} onPress={onCta} disabled={ctaDisabled} loading={ctaLoading} fullWidth testID="store-setup-cta" />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.lg, gap: SP.lg },
  heading: { ...TYPE_SCALE.title2, fontFamily: FONT.bold },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm },
});

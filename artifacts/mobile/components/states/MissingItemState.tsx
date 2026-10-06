import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';

/**
 * Full-screen "this item isn't available" state for detail screens opened
 * without (or with an unknown) id — e.g. a stale deep link. Same shape as
 * app/+not-found.tsx: the shared header (bare back arrow + title), a centred
 * icon, one title line, an optional one-line message, and a single "Go back"
 * action. Never a spinner or a network "Retry" for something that can't load.
 */
export function MissingItemState({
  headerTitle,
  title,
  message,
  icon = 'search',
  actionLabel = 'Go back',
  onAction,
  showHeader = true,
}: {
  headerTitle: string;
  title: string;
  message?: string;
  icon?: keyof typeof Feather.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
  /** false when the screen already renders its own ScreenHeader above this. */
  showHeader?: boolean;
}) {
  const { theme } = useAppTheme();
  const colors = useColors();
  const router = useRouter();
  const goBack = onAction ?? (() => goBackOr(router));
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID="missing-item-state">
      {showHeader && <ScreenHeader title={headerTitle} />}
      <View style={styles.body}>
        <View style={[styles.iconCircle, { borderColor: theme.accent + '40' }]}>
          <Feather name={icon} size={26} color={colors.mutedForeground} />
        </View>
        <Text style={[TYPE_SCALE.title2, styles.title, { color: colors.foreground }]}>{title}</Text>
        {message ? (
          <Text style={[TYPE_SCALE.body, styles.message, { color: colors.mutedForeground }]}>{message}</Text>
        ) : null}
        <Button label={actionLabel} onPress={goBack} variant="primary" style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.sm, paddingBottom: 120 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xxs },
  title: { fontFamily: FONT.semibold, textAlign: 'center' },
  message: { textAlign: 'center', marginTop: SPACING.xxs, maxWidth: 320 },
  button: { marginTop: SPACING.md, minWidth: 180 },
});

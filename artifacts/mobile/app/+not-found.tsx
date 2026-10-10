import React from 'react';
import { Redirect, Stack, useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { resolveLegacyRoute, type LegacyParams } from '@/lib/navigation/legacyRoutes';

/**
 * Screens that were merged or removed (see lib/navigation/legacyRoutes) no
 * longer have a file, so their old paths land here. Send them to the new
 * home instead of showing "doesn't exist".
 */
function useLegacyRedirect(): string | null {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const hit = resolveLegacyRoute(`${window.location.pathname}${window.location.search}`);
    if (hit) return hit;
  }
  const flat: LegacyParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'not-found' || v === undefined) continue;
    flat[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return resolveLegacyRoute(pathname ?? '', flat);
}

export default function NotFoundScreen() {
  const legacyTarget = useLegacyRedirect();
  if (legacyTarget) return <Redirect href={legacyTarget as never} />;
  return <NotFoundContent />;
}

function NotFoundContent() {
  const { theme } = useAppTheme();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const goHome = () => {
    if (router.canGoBack()) {
      goBackOr(router);
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Not found', headerShown: false }} />
      <ScreenHeader title="Not found" onBack={goHome} />
      <View style={[styles.container, { paddingBottom: insets.bottom + SPACING.xl }]}>
        <View style={[styles.iconCircle, { borderColor: theme.accent + '40' }]}>
          <Feather name="compass" size={26} color={colors.mutedForeground} />
        </View>
        <Text style={[TYPE_SCALE.title2, { fontFamily: FONT.semibold, color: colors.foreground, textAlign: 'center' }]}>
          This screen doesn&apos;t exist
        </Text>
        <Text style={[TYPE_SCALE.body, { color: colors.mutedForeground, textAlign: 'center', marginTop: SPACING.xxs }]}>
          The page you were looking for may have moved or isn&apos;t available anymore.
        </Text>
        <Button
          label="Go home"
          onPress={goHome}
          variant="primary"
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xxs,
  },
  button: {
    marginTop: SPACING.md,
    minWidth: 180,
  },
});

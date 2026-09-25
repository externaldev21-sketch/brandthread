import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

export default function NotFoundScreen() {
  const { theme } = useAppTheme();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const goHome = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + SPACING.xxl, paddingBottom: insets.bottom + SPACING.xl }]}>
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
    </>
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

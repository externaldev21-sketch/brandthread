import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, rightElement }: ScreenHeaderProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web'
    ? SP.xxl + SP.md + SP.xs
    : insets.top + SP.sm;

  return (
    <View style={[styles.container, { paddingTop: topPad, borderBottomColor: colors.border }]}>
      <PressableScale
        onPress={() => router.back()}
        style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={`Go back from ${title}`}
        accessibilityHint={`Returns from ${title}`}
      >
        <Feather name="arrow-left" size={ICON.md} color={colors.foreground} />
      </PressableScale>

      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {subtitle && (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
        )}
      </View>

      <View style={styles.rightSlot}>
        {rightElement ?? <View style={{ width: COMP.iconBtn }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: COMP.headerH,
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    borderBottomWidth: 1,
    gap: SP.sm,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    marginTop: SP.xs,
  },
  rightSlot: {
    width: COMP.iconBtn,
    alignItems: 'flex-end',
  },
});

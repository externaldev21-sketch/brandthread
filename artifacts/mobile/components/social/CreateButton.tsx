import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

type Props = {
  onPress: () => void;
  label?: string;
  compact?: boolean;
  testID?: string;
};

/**
 * The "create post" entry point for a profile: a glass pill matching the
 * tab bar's blurred-glass surface (see components/tab-bar/TabBarParts.tsx).
 * Self-contained so either profile layout (old or the redesigned one) can
 * drop it in without pulling in profile-screen internals.
 */
export default function CreateButton({ onPress, label = 'Create', compact, testID = 'social-create-button' }: Props) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme, compact), [theme, compact]);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <BlurView
        intensity={60}
        tint="systemThinMaterialDark"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, styles.tint]} />
      <Feather name="plus" size={compact ? 16 : 18} color={theme.text} />
      {!compact && <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

const makeStyles = (theme: AppThemePreset, compact?: boolean) => StyleSheet.create({
  wrap: {
    height: compact ? 34 : 40,
    paddingHorizontal: compact ? SP.sm : SP.md,
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  tint: { backgroundColor: `${theme.surface}66` },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  label: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
});

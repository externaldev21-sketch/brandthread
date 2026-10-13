/**
 * The owner's post ••• sheet (Instagram: post ••• → grouped rows with a
 * leading line icon and a sentence-case label, e.g. "Pin to your profile").
 * Built on the app's BottomSheet; currently one row — pin / unpin.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { hapticLight } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export function PostOwnerSheet({ visible, onClose, pinned, onTogglePin }: {
  visible: boolean;
  onClose: () => void;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const label = pinned ? 'Unpin from profile' : 'Pin to your profile';
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="post-owner-sheet">
      <View style={s.group}>
        <Pressable
          onPress={() => { hapticLight(); onClose(); onTogglePin(); }}
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID="post-owner-sheet-pin"
        >
          <MaterialCommunityIcons name={pinned ? 'pin-off-outline' : 'pin-outline'} size={24} color={theme.text} />
          <Text style={s.label}>{label}</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    group: {
      marginHorizontal: SPACING.md, marginBottom: SPACING.sm, borderRadius: RADII.chip,
      backgroundColor: theme.cardElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 52, paddingHorizontal: SPACING.md },
    rowPressed: { backgroundColor: theme.borderSubtle },
    label: { color: theme.text, fontFamily: FONT.regular, fontSize: 16 },
  });
}

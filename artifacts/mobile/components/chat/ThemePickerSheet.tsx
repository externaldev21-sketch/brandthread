/**
 * Chat details > Theme — bottom sheet grid of theme tiles. Mirrors the
 * chat-details-then-picker sequence in Instagram's "Changing theme" flow
 * (mobbin.com/flows/7bcc8b1f-13b7-4656-bb0f-fd5a4fa75108); the picker itself
 * renders as a grid of tiles per the brief (Instagram's own comparable
 * screens in Mobbin's index show a scrollable radio-button list instead —
 * noted here since the flow's exact grid screen wasn't in Mobbin's index for
 * this account, and the grid-tile layout was explicitly specified).
 */
import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { Sheet } from '@/components/ui/BottomSheet';
import { CONVERSATION_THEMES } from '@/lib/conversationThemes';
import { hapticSelection } from '@/lib/haptics';

export function ThemePickerSheet({
  visible, theme, currentThemeId, bottomInset, onClose, onPickTheme, onPickDefault,
}: {
  visible: boolean;
  theme: AppThemePreset;
  currentThemeId: string | null;
  bottomInset: number;
  onClose: () => void;
  onPickTheme: (themeId: string) => void;
  onPickDefault: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Theme" testID="theme-picker-sheet">

        <FlatList
          data={CONVERSATION_THEMES}
          keyExtractor={(t) => t.id}
          numColumns={4}
          scrollEnabled={false}
          contentContainerStyle={{ paddingTop: SP.sm }}
          ListHeaderComponent={(
            <View style={s.tileCell}>
            <PressableScale rippleEnabled={false}
              style={s.tileWrap}
              onPress={() => { hapticSelection(); onPickDefault(); }}
              testID="theme-tile-default"
              accessibilityRole="button"
              accessibilityLabel="Default theme"
              accessibilityState={{ selected: !currentThemeId }}
            >
              <View style={[s.tile, { backgroundColor: theme.background, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]}>
                {!currentThemeId && <Icon name="check" size={ICON_SIZE} color={theme.text} />}
              </View>
              <Text style={[s.tileLabel, { color: theme.muted }]} numberOfLines={2}>Default</Text>
            </PressableScale>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={s.tileCell}>
            <PressableScale rippleEnabled={false}
              style={s.tileWrap}
              onPress={() => { hapticSelection(); onPickTheme(item.id); }}
              testID={`theme-tile-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityState={{ selected: currentThemeId === item.id }}
            >
              <View style={[s.tile, { backgroundColor: item.swatch }]}>
                {currentThemeId === item.id && <Icon name="check" size={ICON_SIZE} color={item.sentText} />}
              </View>
              <Text style={[s.tileLabel, { color: theme.muted }]} numberOfLines={2}>{item.name}</Text>
            </PressableScale>
            </View>
          )}
        />
    </Sheet>
  );
}

const ICON_SIZE = 18;

const s = StyleSheet.create({
  tileCell: { width: '25%' },
  tileWrap: { alignItems: 'center', gap: 6, marginBottom: SP.md },
  tile: { width: 56, height: 56, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 11, fontFamily: FONT.medium, textAlign: 'center', lineHeight: 14 },
});

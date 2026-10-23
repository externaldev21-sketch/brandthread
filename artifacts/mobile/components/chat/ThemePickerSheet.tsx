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
import { View, Text, StyleSheet, Modal, FlatList, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { SheetRise } from '@/components/motion/SheetRise';
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close theme picker" />
      <SheetRise style={[s.sheet, { backgroundColor: theme.surface, paddingBottom: bottomInset + SP.md }]}>
        <View style={[s.handle, { backgroundColor: theme.border }]} />
        <Text style={[s.title, { color: theme.text }]}>Theme</Text>

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
                accessibilityRole="button"
                accessibilityLabel="Default theme"
                accessibilityState={{ selected: !currentThemeId }}
                testID="theme-tile-default"
              >
                <View style={[s.tile, { backgroundColor: theme.background, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]}>
                  {!currentThemeId && <Feather name="check" size={ICON_SIZE} color={theme.text} />}
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
                accessibilityRole="button"
                accessibilityLabel={`${item.name} theme`}
                accessibilityState={{ selected: currentThemeId === item.id }}
                testID={`theme-tile-${item.id}`}
              >
                <View style={[s.tile, { backgroundColor: item.swatch }]}>
                  {currentThemeId === item.id && <Feather name="check" size={ICON_SIZE} color={item.sentText} />}
                </View>
                <Text style={[s.tileLabel, { color: theme.muted }]} numberOfLines={2}>{item.name}</Text>
              </PressableScale>
            </View>
          )}
        />
      </SheetRise>
    </Modal>
  );
}

const ICON_SIZE = 18;

const s = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#00000066' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SP.md, paddingTop: SP.sm },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  title: { fontFamily: FONT.semibold, fontSize: FS.md, textAlign: 'center', marginBottom: SP.sm },
  // PressableScale puts `style` on its inner view, so the 25% column width
  // lives on a plain wrapper — on the button itself it resolved against the
  // shrink-wrapped pressable and squeezed labels to one letter per line.
  tileCell: { width: '25%' },
  tileWrap: { alignItems: 'center', gap: 6, marginBottom: SP.md },
  tile: { width: 56, height: 56, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: FS.xs, fontFamily: FONT.medium, textAlign: 'center', lineHeight: 14 },
});

/**
 * Brandthread Design System — MenuSheet.
 *
 * A "more options" menu in a bottom sheet, copied 1:1 from Instagram's
 * "More options" sheet (profile and post "…" menus): rows grouped into
 * rounded blocks on the raised sheet surface, each row a leading icon and a
 * sentence-case label, hairline separators inside a block, destructive rows
 * (Report, Block, Delete) in the theme's error colour. Built on the shared
 * `<Sheet>` chrome, so it opens, flicks away and buzzes like every other
 * sheet.
 *
 * Tapping a row closes the sheet and runs the row's action. The sheet mounts
 * on first open, so a menu in every feed cell is free until it is used.
 *
 * Usage:
 *   <MenuSheet
 *     visible={open}
 *     onClose={() => setOpen(false)}
 *     sections={[[shareRow, copyLinkRow], [reportRow, blockRow]]}
 *   />
 */
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Sheet } from '@/components/ui/BottomSheet';
import { radius } from '@/constants/radii';
import { FONT } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';

export interface MenuSheetItem {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Keep the sheet open after the action (e.g. a toggle). Defaults to closing. */
  keepOpen?: boolean;
}

export interface MenuSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Optional title row. Instagram's own "More options" sheets have none. */
  title?: string;
  /** One rounded block per section. */
  sections?: MenuSheetItem[][];
  /** Shorthand for a single block. */
  items?: MenuSheetItem[];
  /** Rendered above the blocks (e.g. the comment a menu is about). */
  header?: React.ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}

export function MenuSheet({
  visible, onClose, title, sections, items, header, testID = 'menu-sheet', accessibilityLabel,
}: MenuSheetProps) {
  // Mounted on first open, then kept so the close can animate. Menus that
  // live in every feed cell cost nothing until someone opens one.
  const opened = useRef(visible);
  const pendingAction = useRef<(() => void) | null>(null);
  if (visible) opened.current = true;
  if (!opened.current) return null;
  const menuSections = (sections ?? (items ? [items] : [])).map(section =>
    section.map(item => item.keepOpen ? item : {
      ...item,
      onPress: () => {
        pendingAction.current = item.onPress;
        onClose();
      },
      keepOpen: true,
    }),
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onDismissed={() => {
        const action = pendingAction.current;
        pendingAction.current = null;
        // Navigation can freeze the originating tab. Let the modal's
        // hidden state commit before leaving so its portal cannot trap taps.
        action?.();
      }}
      title={title}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? title ?? 'More options'}
    >
      {header}
      <MenuBlocks sections={menuSections} onClose={onClose} testID={testID} />
    </Sheet>
  );
}

/**
 * The grouped rows on their own, for a sheet that has more than a menu in it
 * (e.g. a menu step that turns into a confirm step). `onClose` runs before a
 * row's action unless the row is `keepOpen`.
 */
export function MenuBlocks({ sections, onClose, testID = 'menu-sheet' }: {
  sections: MenuSheetItem[][];
  onClose: () => void;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const blocks = sections.filter(s => s.length > 0);
  const groupBg = `${theme.text}0F`;
  const pressedBg = `${theme.text}14`;
  return (
    <View style={styles.blocks} testID={`${testID}-body`}>
      {blocks.map((block, b) => (
        <View key={b} style={[styles.block, { backgroundColor: groupBg }]}>
          {b > 0 ? <View testID={`${testID}-separator-${block[0].key}`} style={[styles.separator, { backgroundColor: theme.border, marginLeft: 0 }]} /> : null}
          {block.map((item, i) => {
            const color = item.destructive ? theme.error : theme.text;
            return (
              <React.Fragment key={item.key}>
                {i > 0 ? <View style={[styles.separator, { backgroundColor: theme.border }]} /> : null}
                <Pressable
                  onPress={() => {
                    hapticLight();
                    if (!item.keepOpen) onClose();
                    item.onPress();
                  }}
                  disabled={item.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: !!item.disabled }}
                  testID={`${testID}-${item.key}`}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: pressedBg },
                    item.disabled && styles.disabled,
                  ]}
                >
                  <Feather name={item.icon} size={22} color={color} />
                  <Text style={[styles.label, { color }]} numberOfLines={1}>{item.label}</Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const ICON_COLUMN = 16 + 22 + 14;

const styles = StyleSheet.create({
  blocks: { gap: 12, paddingTop: 4 },
  block: { borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16 },
  label: { flex: 1, fontFamily: FONT.medium, fontSize: 16, lineHeight: 21 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: ICON_COLUMN },
  disabled: { opacity: 0.4 },
});

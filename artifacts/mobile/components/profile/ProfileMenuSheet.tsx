/**
 * The "..." menu of a profile, as one bottom sheet for every profile screen.
 * A visitor's menu is Share profile / Report / Block; the owner's is
 * Share profile / View as visitor (plus owner shortcuts). The rows are passed
 * in by the caller from `profileCapabilities`, so this component has no
 * opinion about who may see what.
 *
 * Renders the shared `MenuSheet` (Instagram's "More options" sheet): no
 * title row, everyday rows in one rounded block, destructive rows (Report,
 * Block) in their own block below. `title` names the sheet for screen
 * readers.
 */
import React from 'react';
import { Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { IconName } from '@/components/ui/Icon';
import type { MenuAnchor } from '@/lib/contextMenu';
import { MenuSheet, type MenuSheetItem } from '@/components/ui/MenuSheet';

export interface ProfileMenuItem {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Starts a new group: a full-width separator above this row. */
  separatorBefore?: boolean;
}

export function ProfileMenuSheet({
  visible, title, items, onClose, anchor = null, testID = 'profile-menu-sheet', appearance = 'default',
}: {
  visible: boolean;
  title?: string;
  items: ProfileMenuItem[];
  onClose: () => void;
  /** Where the ⋯ button was tapped (see `anchorFromEvent`). */
  anchor?: MenuAnchor | null;
  testID?: string;
  appearance?: 'default' | 'list';
}) {
  const { theme } = useAppTheme();
  const everyday = items.filter(i => !i.destructive);
  const destructive: MenuSheetItem[] = items.filter(i => i.destructive);
  // The first row flagged `separatorBefore` starts a second everyday block.
  const extrasStart = everyday.findIndex((i, index) => index > 0 && i.separatorBefore);
  const sections = extrasStart < 0
    ? [everyday, destructive]
    : [everyday.slice(0, extrasStart), everyday.slice(extrasStart), destructive];
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      header={
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close profile options"
          testID={`${testID}-close`}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignSelf: 'flex-start',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={24} color={theme.text} />
        </Pressable>
      }
      sections={sections}
      accessibilityLabel={title ? `${title} options` : 'Profile options'}
      testID={testID}
    />
  );
}

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
import type { Feather } from '@expo/vector-icons';
import { MenuSheet, type MenuSheetItem } from '@/components/ui/MenuSheet';

export interface ProfileMenuItem {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export function ProfileMenuSheet({
  visible, title, items, onClose, testID = 'profile-menu-sheet',
}: {
  visible: boolean;
  title?: string;
  items: ProfileMenuItem[];
  onClose: () => void;
  testID?: string;
}) {
  const everyday: MenuSheetItem[] = items.filter(i => !i.destructive);
  const destructive: MenuSheetItem[] = items.filter(i => i.destructive);
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      sections={[everyday, destructive]}
      accessibilityLabel={title ? `${title} options` : 'Profile options'}
      testID={testID}
    />
  );
}

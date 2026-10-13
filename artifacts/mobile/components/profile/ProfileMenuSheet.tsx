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
  const everyday: MenuSheetItem[] = items.filter(i => !i.destructive);
  const destructive: MenuSheetItem[] = items.filter(i => i.destructive);
  const extrasStart = everyday.findIndex(i => i.key === 'find-friends');
  const sections = extrasStart < 0
    ? [everyday, destructive]
    : [everyday.slice(0, extrasStart), everyday.slice(extrasStart), destructive];
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      sections={sections}
      accessibilityLabel={title ? `${title} options` : 'Profile options'}
      testID={testID}
    />
  );
}

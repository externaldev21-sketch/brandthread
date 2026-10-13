/**
 * The buyer's own-profile ••• menu (Instagram's profile action sheet):
 * Edit profile · Notifications · Share profile first, in that order, then
 * the menu's existing extras (View as visitor) below a separator. Pure, so
 * the order and grouping are unit-tested.
 */
import type { ProfileMenuItem } from './ProfileMenuSheet';

export function buyerOwnMenuItems({
  onEditProfile, onNotifications, onShareProfile, onViewAsVisitor,
}: {
  onEditProfile: () => void;
  onNotifications: () => void;
  /** null when sharing isn't available for this account. */
  onShareProfile: (() => void) | null;
  onViewAsVisitor: (() => void) | null;
}): ProfileMenuItem[] {
  const items: ProfileMenuItem[] = [
    { key: 'edit-profile', icon: 'edit-3', label: 'Edit profile', onPress: onEditProfile },
    { key: 'notifications', icon: 'bell', label: 'Notifications', onPress: onNotifications },
  ];
  if (onShareProfile) items.push({ key: 'share', icon: 'share-2', label: 'Share profile', onPress: onShareProfile });
  if (onViewAsVisitor) items.push({ key: 'view-as-visitor', icon: 'eye', label: 'View as visitor', onPress: onViewAsVisitor, separatorBefore: true });
  return items;
}

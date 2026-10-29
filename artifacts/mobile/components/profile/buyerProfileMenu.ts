/**
 * The buyer's own-profile ••• menu: Notifications and View as visitor, then
 * the caller's extras (Orders · Closet · Tagged posts). Edit profile, Share
 * profile and Find friends are NOT here — each has exactly one home, the
 * button row under the bio (Instagram's own-profile pattern). Pure, so the
 * order is unit-tested.
 */
import type { ProfileMenuItem } from './ProfileMenuSheet';

export function buyerOwnMenuItems({
  onNotifications, onViewAsVisitor,
}: {
  onNotifications: () => void;
  onViewAsVisitor: (() => void) | null;
}): ProfileMenuItem[] {
  const items: ProfileMenuItem[] = [
    { key: 'notifications', icon: 'bell', label: 'Notifications', onPress: onNotifications },
  ];
  if (onViewAsVisitor) items.push({ key: 'view-as-visitor', icon: 'eye', label: 'View as visitor', onPress: onViewAsVisitor });
  return items;
}

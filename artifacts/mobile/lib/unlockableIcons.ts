/**
 * App icons earned with brand membership levels: reaching Insider with any
 * brand unlocks Brushed silver, Inner Circle unlocks Chrome. The server checks
 * the same rule before saving the choice (api-server routes/auth.ts).
 */
import type { MembershipLevel } from '@/lib/api';
import type { UnlockableIconId } from '@/contexts/AppIconContext';
import { LEVEL_LABEL, levelRank } from '@/lib/membershipLevels';

export const UNLOCKABLE_ICONS: Array<{ id: UnlockableIconId; name: string; requires: Exclude<MembershipLevel, 'member'> }> = [
  { id: 'brushed-silver', name: 'Brushed silver', requires: 'insider' },
  { id: 'chrome', name: 'Chrome', requires: 'inner_circle' },
];

export function unlockableIconName(id: UnlockableIconId): string {
  return UNLOCKABLE_ICONS.find((i) => i.id === id)?.name ?? id;
}

/** The highest level reached with any brand. */
export function bestLevel(levels: Array<MembershipLevel | null | undefined>): MembershipLevel | null {
  return levels.reduce<MembershipLevel | null>((best, l) => (levelRank(l) > levelRank(best) ? (l ?? null) : best), null);
}

export function isIconUnlocked(id: UnlockableIconId, best: MembershipLevel | null): boolean {
  const icon = UNLOCKABLE_ICONS.find((i) => i.id === id);
  return !!icon && levelRank(best) >= levelRank(icon.requires);
}

/** The caption under a locked icon: the level that unlocks it. */
export function lockedCaption(id: UnlockableIconId): string {
  const icon = UNLOCKABLE_ICONS.find((i) => i.id === id);
  return icon ? LEVEL_LABEL[icon.requires] : '';
}

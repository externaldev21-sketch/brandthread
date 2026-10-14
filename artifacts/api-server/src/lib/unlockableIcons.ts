/**
 * App icons earned with brand membership levels (app: lib/unlockableIcons.ts).
 * Brushed silver needs Insider with any brand; Chrome needs Inner Circle.
 * Checked when the choice is saved, so a client can't pick a locked icon.
 * An icon already chosen stays if spend later drops (refund); it's never yanked.
 */
import { membershipsFor, type MembershipLevel } from "./brandMembership";

export const UNLOCKABLE_ICON_IDS = ["brushed-silver", "chrome"] as const;
export type UnlockableIconId = typeof UNLOCKABLE_ICON_IDS[number];

const REQUIRES: Record<UnlockableIconId, MembershipLevel> = { "brushed-silver": "insider", chrome: "inner_circle" };
const RANK: Record<MembershipLevel, number> = { member: 0, insider: 1, inner_circle: 2 };

export function isUnlockableIcon(id: string): id is UnlockableIconId {
  return (UNLOCKABLE_ICON_IDS as readonly string[]).includes(id);
}

export async function canUseAppIcon(userId: string, iconId: string): Promise<boolean> {
  if (!isUnlockableIcon(iconId)) return true;
  const best = Math.max(-1, ...(await membershipsFor(userId)).map((m) => (m.level ? RANK[m.level] : -1)));
  return best >= RANK[REQUIRES[iconId]];
}

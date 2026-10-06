/**
 * Own-profile avatar geometry (pure, no React Native imports, unit-testable).
 *
 * Three concentric circles, outermost first:
 *
 *   story ring  — 2pt accent stroke, only visible while the owner has an
 *                 active story (transparent otherwise, so the layout never
 *                 shifts when a story starts/expires);
 *   halo        — a background-coloured separator (border + padding) that
 *                 keeps the avatar visually apart from the ring/video;
 *   avatar      — the photo / initials disc itself.
 *
 * React Native (and RN-web) size boxes border-box: a view's width includes
 * its border and padding. Each outer box is therefore sized to exactly
 * `inner + 2 * (border + padding)`, so its content box equals the inner
 * circle's diameter and the circles share one centre — the previous buyer
 * header styled a 94pt ring with 3pt border + 3pt padding (82pt of room)
 * around an 88pt avatar, which pushed the avatar 6pt off-centre.
 */

/** Instagram's own-profile avatar is ~72pt on a 390pt phone and does not scale with width. */
export const PROFILE_AVATAR_SIZE = 72;
/** The seller's own Profile tab (video header): Dev asked for a noticeably
 *  bigger picture there (+22% over the shared 72pt default). */
export const PROFILE_VIDEO_HEADER_AVATAR_SIZE = 88;
/** Background-coloured separator stroke around the avatar. */
export const AVATAR_HALO_BORDER = 2;
/** Background-coloured gap between the separator stroke and the avatar. */
export const AVATAR_HALO_PADDING = 2;
/** Outermost accent stroke shown while the owner has an unexpired story. */
export const STORY_RING_WIDTH = 2;

export interface AvatarGeometry {
  /** The photo/initials disc. */
  avatar: number;
  /** Halo box (border + padding around the avatar). */
  halo: number;
  /** Story-ring box (outermost). */
  outer: number;
  haloBorder: number;
  haloPadding: number;
  storyRing: number;
}

export function avatarGeometry(
  avatar: number = PROFILE_AVATAR_SIZE,
  haloBorder: number = AVATAR_HALO_BORDER,
  haloPadding: number = AVATAR_HALO_PADDING,
  storyRing: number = STORY_RING_WIDTH,
): AvatarGeometry {
  const halo = avatar + 2 * (haloBorder + haloPadding);
  const outer = halo + 2 * storyRing;
  return { avatar, halo, outer, haloBorder, haloPadding, storyRing };
}

/** Content-box size of a border-box view (what its child actually gets). */
export function contentBox(size: number, border: number, padding = 0): number {
  return size - 2 * (border + padding);
}

/** Centre offset between an inner circle and the box it sits in (0 = concentric). */
export function centreOffset(outerSize: number, border: number, padding: number, innerSize: number): number {
  const room = contentBox(outerSize, border, padding);
  // A child larger than the content box overflows to the bottom/right from
  // the content box's top-left corner, so its centre drifts by half the excess.
  return (innerSize - room) / 2;
}

/**
 * Ids of the owner's stories that haven't expired yet — the same rule the
 * seller profile has always used for its accent ring
 * (`api.social.myStories()` rows filtered by `expiresAt > now`).
 */
export function activeStoryIds(rows: unknown, now: number = Date.now()): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row: any) => {
      if (!row || typeof row.id !== 'string') return false;
      const expires = typeof row.expiresAt === 'number' ? row.expiresAt : Date.parse(String(row.expiresAt));
      return Number.isFinite(expires) && expires > now;
    })
    .map((row: any) => row.id as string);
}

/**
 * Shared neutral avatar-color palette (monochrome sweep).
 *
 * Every place in the app that needs a fallback background color for an
 * avatar — "I don't have a real color for this person, pick one" — used to
 * reach for a hardcoded `#8B5CF6` (purple) independently. That's what made
 * the live buyer preview show purple avatars even though the rest of the
 * app is monochrome. This is the one shared place those fallbacks come
 * from now.
 *
 * Kept dependency-free (no theme/UI imports) so it can be used from the
 * service layer (services/socialService.ts) as well as screens, without
 * a service reaching into a UI theme module.
 */

/** Neutral greys, darkest to lightest, all legible with white initials on top. */
export const AVATAR_NEUTRAL_PALETTE = ['#2A2A2E', '#333338', '#3D3D42', '#71717A'] as const;

/** The single fallback used for "my own" avatar color (one specific
 *  person — the signed-in user — doesn't need per-person variety). */
export const MY_AVATAR_COLOR: string = AVATAR_NEUTRAL_PALETTE[2];

/** The single fallback used wherever a one-off default is simplest (no
 *  seed conveniently at hand). Same value as MY_AVATAR_COLOR by design —
 *  one consistent neutral, not a second competing default. */
export const DEFAULT_AVATAR_COLOR: string = AVATAR_NEUTRAL_PALETTE[2];

/**
 * Deterministically picks a color from the neutral palette for a given
 * person, so the same person always gets the same grey (stable across
 * renders/reloads) while different people still get a little visual
 * variety instead of one flat wall of identical circles.
 */
export function pickAvatarColor(seed: string | undefined | null): string {
  if (!seed) return DEFAULT_AVATAR_COLOR;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_NEUTRAL_PALETTE.length;
  return AVATAR_NEUTRAL_PALETTE[index];
}

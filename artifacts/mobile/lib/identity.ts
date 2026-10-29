/**
 * The ONE place a signed-in account's own name, @handle and photo are worked
 * out from the canonical profile fields onboarding writes (users.brand_name,
 * users.username, users.name / display_name, users.profile_image_url).
 *
 * Screens used to print whatever was nearest — Clerk's first name, Clerk's
 * username, a "My Brand" / "Your Brandthread store" placeholder — so a seller
 * could see their business name on Profile, their personal name in Settings
 * and a blank handle in Live. Every "who am I" surface reads these rules
 * (through hooks/useMyIdentity) instead, so onboarding's answers show
 * everywhere.
 */

export interface IdentityFields {
  brandName?: string | null;
  displayName?: string | null;
  name?: string | null;
  username?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** "@maya", or null when the account has no username yet. */
export function atHandle(username: string | null | undefined): string | null {
  const u = clean(username).replace(/^@+/, '');
  return u ? `@${u}` : null;
}

/** The person's own name: display name, then legal name. */
export function personName(fields: IdentityFields): string | null {
  return clean(fields.displayName) || clean(fields.name) || null;
}

/** First word of the person's name, for greetings. */
export function firstNameOf(fields: IdentityFields): string | null {
  return personName(fields)?.split(' ')[0] ?? null;
}

/**
 * A seller's public name: the business name from onboarding, then the
 * person's name, then @username — never a placeholder while a real field exists.
 */
export function sellerDisplayName(fields: IdentityFields): string | null {
  return clean(fields.brandName) || personName(fields) || atHandle(fields.username);
}

/** A buyer's public name: their name from onboarding, then @username. */
export function buyerDisplayName(fields: IdentityFields): string | null {
  return personName(fields) || atHandle(fields.username);
}

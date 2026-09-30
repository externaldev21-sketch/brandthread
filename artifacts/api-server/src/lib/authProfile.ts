type ClerkEmailAddress = {
  id?: string | null;
  emailAddress?: string | null;
};

type ClerkUserEmailShape = {
  primaryEmailAddressId?: string | null;
  emailAddresses?: readonly ClerkEmailAddress[];
};

// Lowercased so the DB's case-insensitive unique index on lower(email)
// (migration 109) always sees the same casing this app itself wrote —
// 'Ava@X.com' and 'ava@x.com' must resolve to the same account.
export function getClerkEmailAddress(user: ClerkUserEmailShape): string {
  const addresses = user.emailAddresses ?? [];
  const primary = addresses.find((address) => address.id === user.primaryEmailAddressId);
  return (primary?.emailAddress ?? addresses[0]?.emailAddress ?? "").trim().toLowerCase();
}

export function preserveExistingEmail(nextEmail: string, existingEmail: string): string {
  return nextEmail.trim().toLowerCase() || existingEmail;
}

export function normalizeProfileName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  return name || undefined;
}
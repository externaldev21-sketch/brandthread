type ClerkEmailAddress = {
  id?: string | null;
  emailAddress?: string | null;
};

type ClerkUserEmailShape = {
  primaryEmailAddressId?: string | null;
  emailAddresses?: readonly ClerkEmailAddress[];
};

export function getClerkEmailAddress(user: ClerkUserEmailShape): string {
  const addresses = user.emailAddresses ?? [];
  const primary = addresses.find((address) => address.id === user.primaryEmailAddressId);
  return (primary?.emailAddress ?? addresses[0]?.emailAddress ?? "").trim();
}

export function preserveExistingEmail(nextEmail: string, existingEmail: string): string {
  return nextEmail.trim() || existingEmail;
}

export function normalizeProfileName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  return name || undefined;
}
import { clerkClient } from "@clerk/express";
import { isLinkedProfileEmail } from "./linkedProfileEmail";
import { getClerkEmailAddress } from "./authProfile";

/**
 * A linked profile (second profile under one login) carries a placeholder
 * email that receives nothing. Every outgoing email goes through here so
 * mail for that profile (orders, payouts, codes) lands in the login's inbox.
 * The login's address is read from Clerk, which stays current even after the
 * login's own profile was deleted.
 */
export async function deliveryAddressFor(to: string): Promise<string> {
  if (!isLinkedProfileEmail(to)) return to;
  try {
    const { resolveDeliveryAddress } = await import("./accountProfiles");
    return await resolveDeliveryAddress(to, async (loginClerkId) => {
      const login = await clerkClient.users.getUser(loginClerkId);
      return getClerkEmailAddress(login) || null;
    });
  } catch {
    return to;
  }
}

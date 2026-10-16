import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";

/**
 * True for a platform admin: users.role = 'admin', not suspended or deleted —
 * the same rule as requireAdmin (routes/admin/guard.ts), for code that needs a
 * yes/no rather than a middleware. Fails closed on any lookup error.
 */
export async function isPlatformAdmin(clerkId: string | null | undefined): Promise<boolean> {
  if (!clerkId) return false;
  try {
    const [account] = await db
      .select({ role: users.role, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    return !!account && account.role === "admin" && !account.suspendedAt && !account.deletedAt;
  } catch {
    return false;
  }
}

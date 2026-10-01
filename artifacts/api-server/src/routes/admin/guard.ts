import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";

/**
 * Platform-admin gate for every /api/admin route: a signed-in user whose
 * users.role is 'admin' (the same role the moderation queue uses). Admin
 * access is granted only by setting that role directly in the database —
 * there is deliberately no endpoint that can promote a user. Fails closed:
 * if the role can't be verified the request is refused.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const clerkId = (req as any).clerkUserId as string | undefined;
  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const [account] = await db
      .select({ role: users.role, email: users.email, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    if (!account || account.role !== "admin" || account.suspendedAt || account.deletedAt) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    (req as any).adminEmail = account.email;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Admin access lookup failed");
    res.status(503).json({ error: "Unable to verify admin access" });
    return;
  }
}

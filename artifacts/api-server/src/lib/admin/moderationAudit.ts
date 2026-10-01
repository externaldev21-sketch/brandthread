import type { NextFunction, Request, Response } from "express";
import { actorOf, recordAdminAction } from "./audit";
import { logger } from "../logger";

/**
 * Mounted in front of the trust & safety router (/api/moderation). The admin
 * dashboard's moderation queue calls that router directly (documented in
 * docs/admin-dashboard.md); this records every successful mutation a
 * moderator makes through it in the admin audit log, without the moderation
 * router needing to know the audit log exists. Reads are not logged.
 */
export function auditModerationActions(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") { next(); return; }
  res.on("finish", () => {
    if (res.statusCode >= 300 || !(req as any).clerkUserId) return;
    const path = req.path;
    const resolve = /^\/reports\/([^/]+)\/resolve$/.exec(path);
    const reinstate = /^\/users\/([^/]+)\/reinstate$/.exec(path);
    if (!resolve && !reinstate) return;
    const action = (req.body as { action?: unknown } | undefined)?.action;
    void recordAdminAction(actorOf(req), resolve
      ? {
          action: "moderation.resolve", targetType: "report", targetId: resolve[1],
          summary: `Resolved a report: ${typeof action === "string" ? action : "unknown action"}`,
          metadata: { action: typeof action === "string" ? action : null },
        }
      : { action: "user.reinstate", targetType: "user", targetId: reinstate![1], summary: "Lifted the suspension (moderation queue)" },
    ).catch((err) => logger.error({ err, path }, "Failed to audit moderation action"));
  });
  next();
}

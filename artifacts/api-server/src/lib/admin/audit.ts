/**
 * Admin audit trail. Every state-changing admin action calls recordAdminAction
 * (ideally inside the same transaction as the change). The table is append-only
 * — a database trigger rejects UPDATE and DELETE.
 */
import type { Request } from "express";
import { db, adminAuditLog } from "@workspace/db";

export type AdminActor = { clerkId: string; email: string | null };

type Executor = Pick<typeof db, "insert">;

export interface AdminActionInput {
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export function actorOf(req: Request): AdminActor {
  return {
    clerkId: (req as any).clerkUserId as string,
    email: ((req as any).adminEmail as string | undefined) ?? null,
  };
}

export async function recordAdminAction(
  actor: AdminActor,
  input: AdminActionInput,
  executor: Executor = db,
): Promise<void> {
  await executor.insert(adminAuditLog).values({
    actorClerkId: actor.clerkId,
    actorEmail: actor.email,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary.slice(0, 500),
    metadata: input.metadata ?? {},
  });
}

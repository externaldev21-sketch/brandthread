import crypto from "node:crypto";

/** A confirmation link is valid for one hour and works once. */
export const DELETION_REQUEST_TTL_MS = 60 * 60_000;
/** Do not send another email for the same address inside this window. */
export const DELETION_REQUEST_RESEND_COOLDOWN_MS = 2 * 60_000;

export function generateDeletionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashDeletionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isWellFormedDeletionToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

export function deletionConfirmLink(origin: string, token: string): string {
  return `${origin}/account-deletion?token=${token}`;
}

export type CapturedResponse = { status: number; body: Record<string, unknown> };

/**
 * Runs an express handler against a minimal request/response and captures the
 * result. Used to execute the existing account-deletion handler for an
 * already-verified owner without duplicating its logic.
 */
export async function runHandlerCapturing(
  handler: (req: any, res: any) => Promise<unknown> | unknown,
  req: Record<string, unknown>,
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { status: 200, body: {} };
  const res = {
    status(code: number) { captured.status = code; return res; },
    json(body: Record<string, unknown>) { captured.body = body; return res; },
  };
  await handler(req, res);
  return captured;
}

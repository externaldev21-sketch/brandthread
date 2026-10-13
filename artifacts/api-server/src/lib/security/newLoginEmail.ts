/** The new-login email (feature 74), sent alongside the push and Activity row. */
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { renderBrandthreadEmail, sendBrandthreadEmail } from "../brandthreadEmail";
import type { AlertContent } from "./signInAlerts";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function sendNewLoginEmail(userId: string, sessionId: string, content: AlertContent): Promise<boolean> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, userId)).limit(1);
  if (!user?.email) return false;
  const html = renderBrandthreadEmail({
    preheader: content.body,
    eyebrow: "Security",
    title: "New login to your account",
    bodyHtml: `<p style="margin-top:0;">${escape(content.body)}</p><p style="margin-bottom:0;color:#666666;">If it was you, there's nothing to do.</p>`,
    cta: { label: "Review login activity", url: "https://brandthread.app/login-activity" },
  });
  return sendBrandthreadEmail({
    to: user.email,
    subject: "New login to your Brandthread account",
    html,
    idempotencyKey: `new-login/${sessionId}`,
  });
}

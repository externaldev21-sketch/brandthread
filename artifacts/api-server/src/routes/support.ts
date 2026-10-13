/**
 * In-app support tickets — sellers/buyers submit help requests stored in DB.
 * POST /api/support/tickets      (requireAuth)
 * GET  /api/support/tickets      (requireAuth — user's own tickets)
 *
 * POST accepts an optional `diagnostics` object (app version/build, OS,
 * device) that "Report a problem" attaches; see lib/supportDiagnostics.ts.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { sanitizeSupportDiagnostics } from "../lib/supportDiagnostics";

const router = Router();

// ─── Startup migration ────────────────────────────────────────────────────────
(async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
        clerk_id    TEXT    NOT NULL,
        email       TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        subject     TEXT    NOT NULL,
        body        TEXT    NOT NULL,
        category    TEXT    NOT NULL DEFAULT 'general',
        status      TEXT    NOT NULL DEFAULT 'open',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Mirrors lib/db/migrations/261_support_ticket_diagnostics.sql.
    await db.execute(sql`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS diagnostics JSONB`);
  } catch (err) {
    logger.error({ err }, "Support tickets migration failed");
  }
})();

// ─── POST /api/support/tickets ────────────────────────────────────────────────
router.post("/tickets", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { subject, body, category, email, name, diagnostics } = req.body as {
    subject?: string;
    body?: string;
    category?: string;
    email?: string;
    name?: string;
    diagnostics?: unknown;
  };

  if (!subject?.trim() || !body?.trim() || !email?.trim() || !name?.trim()) {
    res.status(400).json({ error: "subject, body, email, and name are required" });
    return;
  }

  const cat = ["general", "billing", "account", "bug", "feature"].includes(category ?? "")
    ? (category ?? "general")
    : "general";
  const diag = sanitizeSupportDiagnostics(diagnostics);

  const result = await db.execute(sql`
    INSERT INTO support_tickets (clerk_id, email, name, subject, body, category, diagnostics)
    VALUES (${clerkId}, ${email.trim()}, ${name.trim()}, ${subject.trim()}, ${body.trim()}, ${cat}, ${diag ? JSON.stringify(diag) : null}::jsonb)
    RETURNING *
  `);
  res.status(201).json(result.rows[0] ?? {});
});

// ─── GET /api/support/tickets ─────────────────────────────────────────────────
router.get("/tickets", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const result = await db.execute(sql`
    SELECT * FROM support_tickets
    WHERE clerk_id = ${clerkId}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  res.json(result.rows);
});

export default router;

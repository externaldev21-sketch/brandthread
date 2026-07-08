import { Router } from "express";
import { db, klaviyoIntegrations } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { fetchKlaviyoAccount, fetchKlaviyoSubscriberSummary, KlaviyoError } from "../lib/klaviyo";

const router = Router();
router.use(requireAuth);

function serialize(row: typeof klaviyoIntegrations.$inferSelect) {
  return {
    connected: true,
    companyName: row.companyName,
    emailSubscriberCount: row.emailSubscriberCount,
    smsSubscriberCount: row.smsSubscriberCount,
    listCount: row.listCount,
    lastSyncedAt: row.lastSyncedAt,
    // Never return the raw API key to the client.
  };
}

// GET /api/integrations/klaviyo
router.get("/klaviyo", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(klaviyoIntegrations).where(eq(klaviyoIntegrations.ownerId, ownerId)).limit(1);
  if (!row) { res.json({ connected: false }); return; }
  res.json(serialize(row));
});

// POST /api/integrations/klaviyo/connect  { apiKey }
router.post("/klaviyo/connect", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { apiKey } = req.body ?? {};
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 6) {
    res.status(400).json({ error: "A valid Klaviyo Private API Key is required" });
    return;
  }

  try {
    const account = await fetchKlaviyoAccount(apiKey.trim());
    const summary = await fetchKlaviyoSubscriberSummary(apiKey.trim());

    const [row] = await db
      .insert(klaviyoIntegrations)
      .values({
        ownerId,
        apiKey: apiKey.trim(),
        accountId: account.accountId,
        companyName: account.companyName,
        emailSubscriberCount: summary.emailSubscriberCount,
        smsSubscriberCount: summary.smsSubscriberCount,
        listCount: summary.listCount,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: klaviyoIntegrations.ownerId,
        set: {
          apiKey: apiKey.trim(),
          accountId: account.accountId,
          companyName: account.companyName,
          emailSubscriberCount: summary.emailSubscriberCount,
          smsSubscriberCount: summary.smsSubscriberCount,
          listCount: summary.listCount,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    res.status(201).json(serialize(row));
  } catch (err) {
    if (err instanceof KlaviyoError) {
      res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: "Could not reach Klaviyo. Please try again." });
  }
});

// POST /api/integrations/klaviyo/sync — re-pull subscriber counts from Klaviyo
router.post("/klaviyo/sync", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [existing] = await db.select().from(klaviyoIntegrations).where(eq(klaviyoIntegrations.ownerId, ownerId)).limit(1);
  if (!existing) { res.status(404).json({ error: "Klaviyo is not connected" }); return; }

  try {
    const summary = await fetchKlaviyoSubscriberSummary(existing.apiKey);
    const [row] = await db
      .update(klaviyoIntegrations)
      .set({
        emailSubscriberCount: summary.emailSubscriberCount,
        smsSubscriberCount: summary.smsSubscriberCount,
        listCount: summary.listCount,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(klaviyoIntegrations.ownerId, ownerId))
      .returning();
    res.json(serialize(row));
  } catch (err) {
    if (err instanceof KlaviyoError) {
      res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: "Could not reach Klaviyo. Please try again." });
  }
});

// DELETE /api/integrations/klaviyo
router.delete("/klaviyo", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  await db.delete(klaviyoIntegrations).where(eq(klaviyoIntegrations.ownerId, ownerId));
  res.status(204).send();
});

export default router;

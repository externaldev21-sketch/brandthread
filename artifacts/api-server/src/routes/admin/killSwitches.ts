/**
 * Admin → Kill switches (lib/killSwitches.ts).
 *
 * GET  /api/admin/kill-switches             state of Live / Payments / AI
 * POST /api/admin/kill-switches/:key {enabled, reason}   pause or resume one
 *
 * Every change is written to the admin audit log in the same transaction.
 */
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { KILL_SWITCHES, KILL_SWITCH_KEYS, killSwitchStates, resetKillSwitchCache, type KillSwitchKey } from "../../lib/killSwitches";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { bodyString } from "./util";

const router = Router();

async function list() {
  resetKillSwitchCache();
  const states = await killSwitchStates();
  const rows = await db.execute(sql`SELECT key, updated_at, updated_by FROM feature_flags WHERE key IN ${KILL_SWITCH_KEYS}`);
  const meta = new Map(((rows as any).rows as { key: string; updated_at: Date; updated_by: string | null }[]).map((r) => [r.key, r]));
  return KILL_SWITCH_KEYS.map((key) => ({
    key, label: KILL_SWITCHES[key].label, enabled: states[key],
    updatedAt: meta.get(key)?.updated_at ? new Date(meta.get(key)!.updated_at).toISOString() : null,
  }));
}

router.get("/kill-switches", async (req, res) => {
  try {
    return res.json({ switches: await list() });
  } catch (err) {
    req.log.error({ err }, "Admin kill switches failed");
    return res.status(500).json({ error: "Could not load kill switches." });
  }
});

router.post("/kill-switches/:key", async (req, res) => {
  const key = String(req.params.key) as KillSwitchKey;
  if (!KILL_SWITCH_KEYS.includes(key)) return res.status(404).json({ error: "Unknown switch." });
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "Say whether to turn it on or off." });
  const reason = bodyString(req.body, "reason", 500);
  if (!enabled && !reason) return res.status(400).json({ error: "Add a reason for pausing." });
  const actor = actorOf(req);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
        VALUES (${key}, ${enabled}, '', ${actor.clerkId}, now())
        ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await recordAdminAction(actor, {
        action: enabled ? "kill_switch.resume" : "kill_switch.pause",
        targetType: "feature_flag", targetId: key,
        summary: `${enabled ? "Resumed" : "Paused"} ${KILL_SWITCHES[key].label}${reason ? `: ${reason}` : ""}`,
        metadata: { enabled, ...(reason ? { reason } : {}) },
      }, tx);
    });
    return res.json({ switches: await list() });
  } catch (err) {
    req.log.error({ err }, "Admin kill switch update failed");
    return res.status(500).json({ error: "Could not change the switch." });
  }
});

export default router;

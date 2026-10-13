/**
 * POST /api/app/installs — the app reports its install once on first launch,
 * and again after signing in so the install is linked to the account. Feeds the
 * admin install → sign-up → first purchase funnel (lib/admin/launchMetrics.ts).
 *
 * Works signed out. Stores a random id the app generated, the platform and the
 * app version — no device identifiers, IP or user agent. The first account
 * that signs in on an install keeps the attribution; later sign-ins (account
 * switching) don't move it.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { rateLimit } from "../middlewares/rateLimit";

const router = Router();

const InstallBody = z.object({
  installId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  platform: z.enum(["ios", "android", "web"]).catch("ios"),
  appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/).optional().catch(undefined),
});

function signedInUser(req: Parameters<typeof getAuth>[0]): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

router.post("/", rateLimit("mutation"), async (req, res) => {
  const parsed = InstallBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid install." });
  const { installId, platform, appVersion } = parsed.data;
  const clerkId = signedInUser(req);
  try {
    await db.execute(sql`
      INSERT INTO app_installs (install_id, platform, app_version, clerk_id, signed_in_at)
      VALUES (${installId.toLowerCase()}, ${platform}, ${appVersion ?? null}, ${clerkId}, ${clerkId ? new Date() : null})
      ON CONFLICT (install_id) DO UPDATE SET
        app_version  = COALESCE(EXCLUDED.app_version, app_installs.app_version),
        clerk_id     = COALESCE(app_installs.clerk_id, EXCLUDED.clerk_id),
        signed_in_at = COALESCE(app_installs.signed_in_at, EXCLUDED.signed_in_at)`);
    return res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "App install record failed");
    return res.status(500).json({ error: "Could not record the install." });
  }
});

export default router;

import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";

type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  description: string;
  updated_at: Date;
};

const router = Router();
const KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,63}$/;

router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query<FeatureFlagRow>(
      `SELECT key, enabled, description, updated_at
       FROM feature_flags
       ORDER BY key`,
    );
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json({
      flags: Object.fromEntries(result.rows.map((row) => [row.key, row.enabled])),
      updatedAt: result.rows.reduce<Date | null>(
        (latest, row) => (!latest || row.updated_at > latest ? row.updated_at : latest),
        null,
      ),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:key", requireAuth, requireModerator, async (req, res, next) => {
  const rawKey = req.params.key;
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  const enabled = req.body?.enabled;
  if (!KEY_PATTERN.test(key) || typeof enabled !== "boolean") {
    res.status(400).json({
      code: "INVALID_FEATURE_FLAG",
      message: "Provide a valid feature key and a boolean enabled value.",
    });
    return;
  }

  try {
    const result = await pool.query<FeatureFlagRow>(
      `INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
       VALUES ($1, $2, COALESCE($3, ''), $4, now())
       ON CONFLICT (key) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           description = CASE
             WHEN EXCLUDED.description = '' THEN feature_flags.description
             ELSE EXCLUDED.description
           END,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
       RETURNING key, enabled, description, updated_at`,
      [
        key,
        enabled,
        typeof req.body?.description === "string" ? req.body.description.slice(0, 240) : "",
        (req as any).clerkUserId,
      ],
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

export default router;
/**
 * "Day 1" badges (lib/dayOne.ts).
 *
 *   GET /api/day-one/:userId   the brands this person is Day 1 for (public,
 *                              like the badge itself; empty across a block)
 */
import { Router } from "express";
import { blockRelation, optionalViewerId } from "../lib/safety";
import { dayOneBrandsFor } from "../lib/dayOne";

const router = Router();

router.get("/:userId", async (req, res) => {
  const userId = String(req.params.userId ?? "").trim();
  if (!userId || userId.length > 128) { res.status(404).json({ error: "Not found" }); return; }
  const viewerId = optionalViewerId(req);
  if (viewerId && viewerId !== userId && (await blockRelation(viewerId, userId)) !== "none") {
    res.json({ brands: [] });
    return;
  }
  res.json({ brands: await dayOneBrandsFor(userId) });
});

export default router;

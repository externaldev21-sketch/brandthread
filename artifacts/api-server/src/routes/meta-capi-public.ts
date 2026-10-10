/**
 * POST /api/public/meta/conversion-events  (BT-325)
 *
 * The buyer's app (signed in or a guest on the web) relays a pixel event here;
 * it is credited to the seller who owns the product (lib/metaCapiRelay.ts).
 * No session needed, rate-limited, small JSON only.
 */
import express, { Router } from "express";
import { rateLimit } from "../middlewares/rateLimit";
import { optionalViewerId } from "../lib/safety";
import { relayConversionEvent } from "../lib/metaCapiRelay";

const router = Router();

router.post("/conversion-events", rateLimit("public-read"), express.json({ limit: "8kb" }), async (req, res) => {
  try {
    const result = await relayConversionEvent(req.body ?? {}, {
      viewerId: optionalViewerId(req),
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (err) {
    req.log?.error?.({ err }, "Meta conversion relay failed");
    return res.json({ ok: true }); // best effort: never fail the buyer's page
  }
});

export default router;

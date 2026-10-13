/**
 * GET /api/link-preview?url=… → { preview: LinkPreview | null }
 * Signed-in only (DM link cards, polish #163). See lib/linkPreview.ts for the
 * SSRF guards. A URL we won't fetch, or a page with no title, is a null
 * preview (200), never an error the chat has to handle.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { getLinkPreview, safePreviewUrl } from "../lib/linkPreview";

const router = Router();

router.get("/", requireAuth, rateLimit("authenticated-read"), async (req, res) => {
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  if (!safePreviewUrl(raw)) return res.json({ preview: null });
  const preview = await getLinkPreview(raw);
  res.setHeader("Cache-Control", "private, max-age=3600");
  return res.json({ preview });
});

export default router;

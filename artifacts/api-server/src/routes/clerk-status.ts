/**
 * GET /api/public/clerk-status — lets the app's development build show a
 * "Clerk key invalid" banner. Outside production only: in production it is a
 * 404 so nothing about server configuration is exposed.
 */
import { Router } from "express";
import { isClerkKeyInvalid } from "../lib/clerkKeyStatus";

const router = Router();

router.get("/clerk-status", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ clerkKeyInvalid: isClerkKeyInvalid() });
});

export default router;

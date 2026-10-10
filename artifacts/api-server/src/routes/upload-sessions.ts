/**
 * Resumable chunked upload sessions shared by every upload route.
 * See lib/uploadSessions.ts for the protocol.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { createUploadSessionRouter } from "../lib/uploadSessions";

const router = Router();
router.use(requireAuth, createUploadSessionRouter());

export default router;

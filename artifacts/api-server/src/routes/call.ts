/**
 * 1:1 Agora call tokens — voice and video calls scoped to a DM conversation.
 *
 * POST /api/call/token
 *   Body: { conversationId: string, mode?: 'voice' | 'video' }
 *   Returns: { appId, token, channelName, uid, mode }
 *
 * The channel name is deterministic (call_{conversationId}) so both
 * participants independently derive the same channel and join it.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { conversationParticipants } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();
router.use(requireAuth);

// ─── Helpers (shared with live.ts pattern) ────────────────────────────────────

function generateToken(
  appId: string,
  appCert: string,
  channelName: string,
  uid: number,
  role: number,
): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
    const expireTs = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCert,
      channelName,
      uid,
      role === 1 ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
      expireTs,
    );
  } catch {
    return ""; // no-cert dev mode — Agora console must have auth disabled
  }
}

function uidFromClerkId(clerkId: string): number {
  let h = 0;
  for (let i = 0; i < clerkId.length; i++) {
    h = (Math.imul(31, h) + clerkId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 999999 + 1;
}

// ─── POST /api/call/token ─────────────────────────────────────────────────────

router.post("/token", async (req, res) => {
  const callerId = (req as any).clerkUserId as string;
  const { conversationId, mode = "video" } = req.body ?? {};

  if (!conversationId) {
    return res.status(400).json({ error: "conversationId is required" });
  }

  // Verify the requester is actually a participant in this conversation
  const participants = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));

  const isMember = participants.some((p) => p.userId === callerId);
  if (!isMember) {
    return res.status(403).json({ error: "Not a participant in this conversation" });
  }

  const appId   = process.env.AGORA_APP_ID ?? "";
  const appCert = process.env.AGORA_APP_CERTIFICATE ?? "";

  if (!appId) {
    return res.status(503).json({ error: "AGORA_APP_ID not configured" });
  }

  // Channel name is deterministic from the conversation ID so both users
  // end up in the same Agora channel without any coordination message.
  const channelName = `call_${conversationId}`;
  const uid         = uidFromClerkId(callerId);
  const token       = generateToken(appId, appCert, channelName, uid, 1 /* PUBLISHER */);

  return res.json({ appId, token, channelName, uid, mode });
});

export default router;

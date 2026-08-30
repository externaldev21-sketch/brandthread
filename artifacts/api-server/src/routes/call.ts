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
import { conversationParticipants, manufacturerActivityEvents, manufacturers, manufacturerThreads } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { publishNotification } from "./notifications-feed";

const router = Router();
router.use(requireAuth);

// ─── Helpers (shared with live.ts pattern) ────────────────────────────────────

export const CALL_TOKEN_TTL_SECONDS = 15 * 60;

function generateToken(
  appId: string,
  appCert: string,
  channelName: string,
  uid: number,
  role: number,
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
  const expireTs = Math.floor(Date.now() / 1000) + CALL_TOKEN_TTL_SECONDS;
  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCert,
    channelName,
    uid,
    role === 1 ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    expireTs,
  );
}

function uidFromClerkId(clerkId: string): number {
  let h = 0;
  for (let i = 0; i < clerkId.length; i++) {
    h = (Math.imul(31, h) + clerkId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 999999 + 1;
}

export function isAuthorizedManufacturerThreadParticipant(
  callerId: string,
  thread: { buyerClerkId: string; manufacturerClerkId: string | null } | null | undefined,
): boolean {
  return !!thread && (thread.buyerClerkId === callerId || thread.manufacturerClerkId === callerId);
}

export function isValidCallClientEventId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

// ─── POST /api/call/token ─────────────────────────────────────────────────────

router.post("/token", async (req, res) => {
  const callerId = (req as any).clerkUserId as string;
  const { conversationId, threadId = conversationId, mode = "video" } = req.body ?? {};

  if (!threadId) {
    return res.status(400).json({ error: "threadId is required" });
  }
  if (mode !== "voice" && mode !== "video") {
    return res.status(400).json({ error: "mode must be voice or video" });
  }

  // Manufacturer conversations use a two-sided thread model rather than the
  // social-DM participant table. Both sides are checked from authoritative rows.
  const [thread] = await db.select({
    id: manufacturerThreads.id,
    manufacturerId: manufacturerThreads.manufacturerId,
    buyerClerkId: manufacturerThreads.buyerClerkId,
    manufacturerClerkId: manufacturers.clerkId,
  }).from(manufacturerThreads)
    .innerJoin(manufacturers, eq(manufacturerThreads.manufacturerId, manufacturers.id))
    .where(eq(manufacturerThreads.id, threadId))
    .limit(1);
  let channelPrefix = "mfr";
  if (!isAuthorizedManufacturerThreadParticipant(callerId, thread)) {
    const [ordinaryParticipant] = await db.select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(and(
        eq(conversationParticipants.conversationId, threadId),
        eq(conversationParticipants.userId, callerId),
      ))
      .limit(1);
    if (!ordinaryParticipant) {
      return res.status(403).json({ error: "Not a participant in this conversation" });
    }
    channelPrefix = "call";
  }

  const appId   = process.env.AGORA_APP_ID ?? "";
  const appCert = process.env.AGORA_APP_CERTIFICATE ?? "";

  if (!appId || !appCert) {
    return res.status(503).json({
      error: "Calling is unavailable because secure call credentials are not configured",
      code: "CALLING_NOT_CONFIGURED",
    });
  }

  // Channel name is deterministic from the conversation ID so both users
  // end up in the same Agora channel without any coordination message.
  const channelName = channelPrefix === "mfr"
    ? `mfr_${threadId.replaceAll("-", "")}`
    : `call_${threadId}`;
  const uid         = uidFromClerkId(callerId);
  const token       = generateToken(appId, appCert, channelName, uid, 1 /* PUBLISHER */);
  const expiresAt = new Date(Date.now() + CALL_TOKEN_TTL_SECONDS * 1000);
  if (thread) {
    await db.insert(manufacturerActivityEvents).values({
      manufacturerId: thread.manufacturerId,
      threadId: thread.id,
      actorClerkId: callerId,
      category: "call",
      type: "credential_issued",
      metadata: { mode, expiresAt: expiresAt.toISOString() },
    });
  }

  return res.json({ appId, token, channelName, uid, mode, expiresAt: expiresAt.toISOString() });
});

router.post("/events", async (req, res) => {
  const callerId = (req as any).clerkUserId as string;
  const { threadId, type, mode = "video", clientEventId } = req.body ?? {};
  const allowedTypes = new Set(["started", "ended", "declined", "failed"]);
  if (!threadId || !allowedTypes.has(type) || (mode !== "voice" && mode !== "video") || !isValidCallClientEventId(clientEventId)) {
    return res.status(400).json({ error: "threadId, valid type/mode, and an 8–128 character clientEventId are required" });
  }
  const [thread] = await db.select({
    id: manufacturerThreads.id,
    manufacturerId: manufacturerThreads.manufacturerId,
    buyerClerkId: manufacturerThreads.buyerClerkId,
    manufacturerClerkId: manufacturers.clerkId,
  }).from(manufacturerThreads)
    .innerJoin(manufacturers, eq(manufacturerThreads.manufacturerId, manufacturers.id))
    .where(and(eq(manufacturerThreads.id, threadId)))
    .limit(1);
  if (!isAuthorizedManufacturerThreadParticipant(callerId, thread)) {
    return res.status(403).json({ error: "Not a participant in this conversation" });
  }
  const providerEventId = `call:${threadId}:${callerId}:${clientEventId}`;
  const [recorded] = await db.insert(manufacturerActivityEvents).values({
    manufacturerId: thread.manufacturerId,
    threadId,
    actorClerkId: callerId,
    category: "call",
    type: `call_${type}`,
    providerEventId,
    metadata: { mode, clientEventId },
  }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
    .returning({ id: manufacturerActivityEvents.id });
  if (!recorded) {
    return res.json({ recorded: true, duplicate: true });
  }
  const recipientIsManufacturer = callerId === thread.buyerClerkId;
  const recipientId = recipientIsManufacturer ? thread.manufacturerClerkId : thread.buyerClerkId;
  if (recipientId && (type === "started" || type === "declined" || type === "failed")) {
    await publishNotification({
      userId: recipientId,
      category: "message",
      type: `manufacturer_call_${type}`,
      title: type === "started" ? `Incoming ${mode} call` : `${mode} call ${type}`,
      body: "Open the manufacturer conversation for call details.",
      targetId: threadId,
      targetType: "manufacturer_thread",
      cta: recipientIsManufacturer
        ? `/manufacturers/messages/${threadId}`
        : `/manufacturer-messages?threadId=${threadId}`,
    }).catch((error) => req.log.error({ err: error, threadId }, "Call notification failed"));
  }
  return res.status(201).json({ recorded: true, duplicate: false });
});

export default router;

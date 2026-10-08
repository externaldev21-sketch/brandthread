/**
 * 1:1 Agora call tokens — voice and video calls scoped to a DM conversation.
 *
 * POST /api/call/token
 *   Body: { conversationId: string, mode?: 'voice' | 'video' }
 *   Returns: { appId, token, channelName, uid, mode }
 * POST /api/call/token/renew
 *   Body: { threadId: string, mode?: 'voice' | 'video', clientRenewalId: string }
 *   Returns: { appId, token, channelName, uid, mode, expiresAt }
 *
 * 1:1 DM calls with a real ringing/accept/decline/end lifecycle
 * (table dm_calls, realtime over /ws/calls — see src/ws/callHub.ts):
 *   POST /api/call/dm/calls                       { conversationId, mode } → 201 { call, rtc }
 *   POST /api/call/dm/calls/:id/accept            → { call, rtc }
 *   POST /api/call/dm/calls/:id/decline           → { call }
 *   POST /api/call/dm/calls/:id/end               → { call }
 *   POST /api/call/dm/calls/:id/token             → { rtc }
 *   POST /api/call/dm/calls/:id/rating            { rating: 'good'|'not_good' } → { ok: true }
 *   GET  /api/call/dm/calls/:id                   → { call }
 *   GET  /api/call/dm/incoming                    → { call | null }
 *   GET  /api/call/dm/conversations/:id/calls     → { calls }
 *
 * Who may call whom is lib/callPolicy.ts (block either way → 403 BLOCKED,
 * pending message request → 403 CALL_REQUEST_NOT_ACCEPTED / CALL_REQUEST_PENDING).
 * A muted chat still rings: the "calls" push bypasses chat mute and the
 * native VoIP ring (lib/voipPush.ts) is sent alongside it.
 *
 * The legacy /token channel name is deterministic (call_{conversationId});
 * DM calls use a per-call channel (dmcall_{callId without dashes}).
 */
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { conversationParticipants, manufacturerActivityEvents, manufacturers, manufacturerThreads } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { publishNotification } from "./notifications-feed";
import { logger } from "../lib/logger";
import { isUniqueViolation } from "../lib/dbErrors";
import { sendCallEvent } from "../ws/callHub";
import { evaluateCallPolicy } from "../lib/callPolicy";
import { onUserBlocked } from "../lib/blockEvents";
import { sendCallVoipPush, type CallVoipPayload } from "../lib/voipPush";
import {
  LIVE_CALL_STATUSES,
  RING_TIMEOUT_SECONDS,
  channelNameForCall,
  isAcceptedCallAbandoned,
  isDmCallMode,
  isRingExpired,
  isTerminalCallStatus,
  nextCallStatus,
  roleOf,
  serializeCall,
  type DmCallPeerSource,
  type DmCallRole,
  type DmCallRow,
  type DmCallStatus,
} from "../lib/dmCalls";
import {
  getAvatarUrls,
  getCall,
  getCallParticipants,
  getConversationForCall,
  getLiveCallsForUser,
  getRingingCallsForCallee,
  insertCall,
  isBlockedEitherWay,
  listConversationCalls,
  setCallQualityRating,
  transitionCall,
} from "../lib/dmCallsStore";

const router = Router();
router.use(requireAuth);

// ─── Helpers (shared with live.ts pattern) ────────────────────────────────────

export const CALL_TOKEN_TTL_SECONDS = 15 * 60;
export const CALL_TOKEN_RENEWAL_LEAD_SECONDS = 60;

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

type ManufacturerCallThread = {
  id: string;
  manufacturerId: string;
  buyerClerkId: string;
  manufacturerClerkId: string | null;
};

async function getManufacturerCallThread(threadId: string): Promise<ManufacturerCallThread | undefined> {
  const [thread] = await db.select({
    id: manufacturerThreads.id,
    manufacturerId: manufacturerThreads.manufacturerId,
    buyerClerkId: manufacturerThreads.buyerClerkId,
    manufacturerClerkId: manufacturers.clerkId,
  }).from(manufacturerThreads)
    .innerJoin(manufacturers, eq(manufacturerThreads.manufacturerId, manufacturers.id))
    .where(eq(manufacturerThreads.id, threadId))
    .limit(1);
  return thread;
}

async function recordRenewalEvent(
  thread: ManufacturerCallThread,
  callerId: string,
  type: "credential_renewal_attempt" | "credential_renewed" | "credential_renewal_failed" | "credential_renewal_denied",
  providerEventId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const [recorded] = await db.insert(manufacturerActivityEvents).values({
    manufacturerId: thread.manufacturerId,
    threadId: thread.id,
    actorClerkId: callerId,
    category: "call",
    type,
    providerEventId,
    metadata,
  }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId })
    .returning({ id: manufacturerActivityEvents.id });
  return !!recorded;
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

export function isCallingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AGORA_APP_ID?.trim() && env.AGORA_APP_CERTIFICATE?.trim());
}

// ─── GET /api/call/availability ───────────────────────────────────────────────
// Lets clients show a "calls coming soon" state instead of buttons that fail.
// Setting AGORA_APP_ID and AGORA_APP_CERTIFICATE switches calling on with no
// client release.
router.get("/availability", (_req, res) => {
  res.json({ configured: isCallingConfigured(), provider: "agora" });
});

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

// ─── POST /api/call/token/renew ───────────────────────────────────────────────
//
// Renewal is intentionally manufacturer-thread-only. Unlike the initial token
// endpoint's legacy DM fallback, a renewal must prove that the caller is still
// one of the two participants on the same authoritative thread.
router.post("/token/renew", async (req, res) => {
  const callerId = (req as any).clerkUserId as string;
  const {
    threadId,
    mode = "video",
    clientRenewalId,
  } = req.body ?? {};

  if (
    typeof threadId !== "string"
    || (mode !== "voice" && mode !== "video")
    || !isValidCallClientEventId(clientRenewalId)
  ) {
    return res.status(400).json({
      error: "threadId, valid mode, and an 8–128 character clientRenewalId are required",
    });
  }

  const thread = await getManufacturerCallThread(threadId);
  if (!thread) {
    return res.status(403).json({ error: "Not a participant in this conversation" });
  }

  const renewalKey = `call:renewal:${threadId}:${callerId}:${clientRenewalId}`;
  const recordedAttempt = await recordRenewalEvent(
    thread,
    callerId,
    "credential_renewal_attempt",
    `${renewalKey}:attempt`,
    { mode, clientRenewalId },
  );
  if (!isAuthorizedManufacturerThreadParticipant(callerId, thread)) {
    await recordRenewalEvent(
      thread,
      callerId,
      "credential_renewal_denied",
      `${renewalKey}:outcome`,
      { mode, clientRenewalId, outcome: "denied", reason: "PARTICIPANT_ACCESS_REVOKED" },
    );
    return res.status(403).json({ error: "Not a participant in this conversation" });
  }

  const appId = process.env.AGORA_APP_ID ?? "";
  const appCert = process.env.AGORA_APP_CERTIFICATE ?? "";
  if (!appId || !appCert) {
    await recordRenewalEvent(
      thread,
      callerId,
      "credential_renewal_failed",
      `${renewalKey}:outcome`,
      { mode, clientRenewalId, outcome: "failed", reason: "CALLING_NOT_CONFIGURED" },
    );
    return res.status(503).json({
      error: "Calling is unavailable because secure call credentials are not configured",
      code: "CALLING_NOT_CONFIGURED",
    });
  }

  const channelName = `mfr_${threadId.replaceAll("-", "")}`;
  const uid = uidFromClerkId(callerId);
  try {
    const token = generateToken(appId, appCert, channelName, uid, 1 /* PUBLISHER */);
    const expiresAt = new Date(Date.now() + CALL_TOKEN_TTL_SECONDS * 1000);
    await recordRenewalEvent(
      thread,
      callerId,
      "credential_renewed",
      `${renewalKey}:outcome`,
      { mode, clientRenewalId, outcome: "renewed", expiresAt: expiresAt.toISOString() },
    );
    return res.json({
      renewed: true,
      duplicate: !recordedAttempt,
      appId,
      token,
      channelName,
      uid,
      mode,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    await recordRenewalEvent(
      thread,
      callerId,
      "credential_renewal_failed",
      `${renewalKey}:outcome`,
      { mode, clientRenewalId, outcome: "failed", reason: "TOKEN_GENERATION_FAILED" },
    );
    req.log.error({ err: error, threadId, callerId }, "Agora call token renewal failed");
    return res.status(503).json({
      error: "The secure call connection could not be renewed",
      code: "CALL_TOKEN_RENEWAL_FAILED",
    });
  }
});

// ─── 1:1 DM calls (/api/call/dm/…) ─────────────────────────────────────────────
//
// A real call lifecycle: the caller creates a call (row in dm_calls, per-call
// Agora channel), the callee is rung by push (Android "calls" channel, high
// priority) and by the /ws/calls socket, and either side drives the
// ringing → accepted → ended state machine (lib/dmCalls.ts). Every state
// change is a conditional UPDATE, so two racing requests can't both win; the
// loser gets 409 INVALID_CALL_STATE with the current call. Unanswered calls
// become `missed` after RING_TIMEOUT_SECONDS — lazily on every read and by an
// in-process timer set when the call is placed. Nothing is ever faked: with no
// Agora credentials the create/accept/token endpoints answer 503.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notConfigured(res: Response) {
  return res.status(503).json({
    error: "Calling is unavailable because secure call credentials are not configured",
    code: "CALLING_NOT_CONFIGURED",
  });
}

export type DmCallRtc = { appId: string; token: string; channelName: string; uid: number; expiresAt: string };

function rtcFor(call: Pick<DmCallRow, "channelName">, userId: string): DmCallRtc {
  const appId = process.env.AGORA_APP_ID?.trim() ?? "";
  const appCert = process.env.AGORA_APP_CERTIFICATE?.trim() ?? "";
  const uid = uidFromClerkId(userId);
  const token = generateToken(appId, appCert, call.channelName, uid, 1 /* PUBLISHER */);
  const expiresAt = new Date(Date.now() + CALL_TOKEN_TTL_SECONDS * 1000).toISOString();
  return { appId, token, channelName: call.channelName, uid, expiresAt };
}

type CallView = { participants: DmCallPeerSource[]; avatars: Map<string, string | null> };

async function loadCallView(conversationId: string, participants?: DmCallPeerSource[]): Promise<CallView> {
  const ps = participants ?? await getCallParticipants(conversationId);
  const avatars = await getAvatarUrls(ps.map((p) => p.userId));
  return { participants: ps, avatars };
}

function emitCallEvent(type: "call.incoming" | "call.updated", call: DmCallRow, view: CallView, to: string[]) {
  for (const userId of to) {
    try {
      sendCallEvent(userId, { type, call: serializeCall(call, userId, view.participants, view.avatars) });
    } catch (err) {
      logger.warn({ err, callId: call.id }, "DM call socket event failed");
    }
  }
}

async function publishMissedCall(call: DmCallRow, view: CallView): Promise<void> {
  const caller = view.participants.find((p) => p.userId === call.callerId);
  const callerName = caller?.name?.trim() || "Someone";
  await publishNotification({
    userId: call.calleeId,
    category: "message",
    type: "dm_call_missed",
    title: call.mode === "video" ? "Missed video call" : "Missed voice call",
    body: `You missed a call from ${callerName}`,
    actorId: call.callerId,
    actorName: callerName,
    actorInitials: caller?.initials || undefined,
    actorColor: caller?.color || undefined,
    targetId: call.conversationId,
    targetType: "conversation",
    extraData: { callId: call.id, conversationId: call.conversationId, mode: call.mode },
  });
}

function voipPayload(call: DmCallRow, view: CallView, type: CallVoipPayload["type"], reason?: string): CallVoipPayload {
  const caller = view.participants.find((p) => p.userId === call.callerId);
  return {
    type,
    callId: call.id,
    conversationId: call.conversationId,
    callerId: call.callerId,
    callerName: caller?.name?.trim() || "Someone",
    callerAvatar: view.avatars.get(call.callerId) ?? null,
    hasVideo: call.mode === "video",
    ...(reason ? { reason } : {}),
  };
}

/**
 * Why the callee's system call screen (CallKit / ConnectionService) should
 * stop ringing after a transition, or null when it never rang / already
 * stopped. `accepted` dismisses the ring on the callee's OTHER devices
 * (answered elsewhere); the device that answered ignores it.
 */
export function nativeRingDismissReason(call: Pick<DmCallRow, "status" | "endReason">): string | null {
  switch (call.status) {
    case "accepted": return "answered_elsewhere";
    case "declined":
    case "cancelled":
    case "missed":
      return call.status;
    case "failed": return call.endReason || "failed";
    default: return null;
  }
}

/** Side effects of a transition this request won: realtime update to both, missed-call notice, native ring dismissal. */
async function afterTransition(call: DmCallRow): Promise<void> {
  try {
    const view = await loadCallView(call.conversationId);
    emitCallEvent("call.updated", call, view, [call.callerId, call.calleeId]);
    const dismiss = nativeRingDismissReason(call);
    if (dismiss) {
      void sendCallVoipPush(call.calleeId, voipPayload(call, view, "dm_call_ended", dismiss));
    }
    if (call.status === "missed" || call.status === "cancelled") {
      await publishMissedCall(call, view);
    }
  } catch (err) {
    logger.error({ err, callId: call.id }, "DM call transition side effects failed");
  }
}

/**
 * A block between two people ends any call they have going right now: a
 * ringing call becomes `failed` (end_reason 'blocked' — no missed-call
 * notice, the native ring is dismissed) and an accepted call is ended.
 * Called by POST /api/social/block. Never throws.
 */
export async function endLiveCallsBetween(a: string, b: string): Promise<number> {
  let ended = 0;
  try {
    const live = (await getLiveCallsForUser(a)).filter((c) => c.callerId === b || c.calleeId === b);
    for (const call of live) {
      const updated = call.status === "ringing"
        ? await transitionCall(call.id, "ringing", "failed", a, "blocked")
        : await transitionCall(call.id, "accepted", "ended", a, "blocked");
      if (updated) {
        ended += 1;
        await afterTransition(updated);
      }
    }
  } catch (err) {
    logger.error({ err }, "Ending calls after a block failed");
  }
  return ended;
}

/**
 * Lazy timeouts: a ringing call past RING_TIMEOUT_SECONDS becomes `missed`; an
 * accepted call abandoned by both clients for MAX_ACCEPTED_CALL_SECONDS is
 * ended. Safe under races (conditional update; only the winner notifies).
 */
export async function expireCallIfStale(call: DmCallRow): Promise<DmCallRow> {
  let updated: DmCallRow | undefined;
  if (isRingExpired(call)) {
    updated = await transitionCall(call.id, "ringing", "missed", null);
  } else if (isAcceptedCallAbandoned(call)) {
    updated = await transitionCall(call.id, "accepted", "ended", null, "timeout");
  } else {
    return call;
  }
  if (updated) {
    await afterTransition(updated);
    return updated;
  }
  return (await getCall(call.id)) ?? call;
}

function scheduleRingTimeout(callId: string): void {
  const timer = setTimeout(() => {
    void (async () => {
      const call = await getCall(callId);
      if (call?.status === "ringing") await expireCallIfStale(call);
    })().catch((err) => logger.error({ err, callId }, "DM call ring timeout failed"));
  }, RING_TIMEOUT_SECONDS * 1000 + 250);
  timer.unref?.();
}

async function liveCallsFor(userId: string): Promise<DmCallRow[]> {
  const rows = await getLiveCallsForUser(userId);
  const fresh = await Promise.all(rows.map(expireCallIfStale));
  return fresh.filter((c) => (LIVE_CALL_STATUSES as string[]).includes(c.status));
}

// A block ends a call that is ringing or live between the two right now.
onUserBlocked((blockerId, blockedId) => endLiveCallsBetween(blockerId, blockedId));

router.post("/dm/calls", async (req, res) => {
  const callerId = (req as any).clerkUserId as string;
  const { conversationId, mode } = req.body ?? {};
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) {
    return res.status(400).json({ error: "conversationId is required" });
  }
  if (!isDmCallMode(mode)) {
    return res.status(400).json({ error: "mode must be voice or video" });
  }

  const conversation = await getConversationForCall(conversationId);
  const participants = conversation && !conversation.deletedAt
    ? await getCallParticipants(conversationId)
    : [];
  if (!participants.some((p) => p.userId === callerId)) {
    return res.status(403).json({ error: "Not a participant in this conversation", code: "NOT_A_PARTICIPANT" });
  }
  const others = [...new Set(participants.map((p) => p.userId))].filter((id) => id !== callerId);
  if (others.length !== 1) {
    return res.status(403).json({ error: "Calls are only available in 1:1 conversations", code: "NOT_ONE_TO_ONE" });
  }
  const calleeId = others[0]!;
  const policy = await evaluateCallPolicy(callerId, calleeId, conversationId);
  if (!policy.ok) {
    return res.status(policy.status).json({ error: policy.error, code: policy.code });
  }
  if (!isCallingConfigured()) return notConfigured(res);

  if ((await liveCallsFor(calleeId)).length > 0) {
    return res.status(409).json({ error: "They're on another call", code: "CALLEE_BUSY" });
  }
  const callerLive = await liveCallsFor(callerId);
  if (callerLive.length > 0) {
    const view = await loadCallView(callerLive[0]!.conversationId);
    return res.status(409).json({
      error: "You're already on a call",
      code: "CALLER_BUSY",
      call: serializeCall(callerLive[0]!, callerId, view.participants, view.avatars),
    });
  }

  const id = randomUUID();
  let call: DmCallRow;
  try {
    call = await insertCall({ id, conversationId, callerId, calleeId, mode, channelName: channelNameForCall(id) });
  } catch (err) {
    // dm_calls_one_live_per_conversation_idx: the other side called at the same instant.
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: "They're on another call", code: "CALLEE_BUSY" });
    }
    throw err;
  }

  const view = await loadCallView(conversationId, participants);
  const rtc = rtcFor(call, callerId);
  scheduleRingTimeout(call.id);
  emitCallEvent("call.incoming", call, view, [calleeId]);

  const caller = participants.find((p) => p.userId === callerId);
  const callerName = caller?.name?.trim() || "Someone";
  void publishNotification({
    userId: calleeId,
    category: "message",
    type: "dm_call_incoming",
    title: mode === "video" ? "Incoming video call" : "Incoming voice call",
    body: `${callerName} is calling you`,
    actorId: callerId,
    actorName: callerName,
    actorInitials: caller?.initials || undefined,
    actorColor: caller?.color || undefined,
    // Activity feed row opens the chat; the push itself carries the call.
    targetId: conversationId,
    targetType: "conversation",
    // A muted chat still rings (mute is for messages only).
    ringThroughMutes: true,
    pushCategory: "message",
    pushChannelId: "calls",
    pushSound: "default",
    pushPriority: "high",
    pushInterruptionLevel: "time-sensitive",
    extraData: {
      targetType: "dm_call",
      targetId: call.id,
      callId: call.id,
      conversationId,
      mode,
      actorName: callerName,
    },
  }).catch((err) => req.log?.error?.({ err, callId: call.id }, "DM call incoming push failed"));
  // System call screen on iOS (CallKit via PushKit) / Android (ConnectionService via FCM data).
  void sendCallVoipPush(calleeId, voipPayload(call, view, "dm_call_incoming"));

  return res.status(201).json({ call: serializeCall(call, callerId, view.participants, view.avatars), rtc });
});

type LoadedCall = { call: DmCallRow; role: DmCallRole };

/** Load a call the requester participates in (after lazy timeouts), or answer 404/403. */
async function loadParticipantCall(req: Request, res: Response): Promise<LoadedCall | null> {
  const userId = (req as any).clerkUserId as string;
  const id = String(req.params.id ?? "");
  const row = UUID_RE.test(id) ? await getCall(id) : undefined;
  if (!row) {
    res.status(404).json({ error: "Call not found", code: "CALL_NOT_FOUND" });
    return null;
  }
  const role = roleOf(row, userId);
  if (!role) {
    res.status(403).json({ error: "Not a participant in this call", code: "NOT_A_PARTICIPANT" });
    return null;
  }
  return { call: await expireCallIfStale(row), role };
}

async function respondCall(res: Response, status: number, call: DmCallRow, userId: string, extra: Record<string, unknown> = {}) {
  const view = await loadCallView(call.conversationId);
  return res.status(status).json({ ...extra, call: serializeCall(call, userId, view.participants, view.avatars) });
}

async function handleCallAction(req: Request, res: Response, action: "accept" | "decline" | "end") {
  const userId = (req as any).clerkUserId as string;
  const loaded = await loadParticipantCall(req, res);
  if (!loaded) return;
  let { call } = loaded;
  const { role } = loaded;
  const withRtc = action === "accept";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const decision = nextCallStatus(action, role, call.status);
    if (decision.kind === "forbidden") {
      return res.status(403).json({ error: "Only the person being called can do that", code: "NOT_CALLEE" });
    }
    if (decision.kind === "invalid") {
      return respondCall(res, 409, call, userId, { error: `Call is ${call.status}`, code: "INVALID_CALL_STATE" });
    }
    if (decision.kind === "idempotent") {
      if (withRtc && !isCallingConfigured()) return notConfigured(res);
      return respondCall(res, 200, call, userId, withRtc ? { rtc: rtcFor(call, userId) } : {});
    }
    if (withRtc && !isCallingConfigured()) return notConfigured(res);
    // A block placed while it rang stops the answer too (the block route
    // already ends live calls; this closes the race with an in-flight accept).
    if (action === "accept" && await isBlockedEitherWay(call.callerId, call.calleeId)) {
      const failed = await transitionCall(call.id, "ringing", "failed", userId, "blocked");
      if (failed) await afterTransition(failed);
      const current = failed ?? (await getCall(call.id)) ?? call;
      return respondCall(res, 403, current, userId, { error: "You can't call this person", code: "BLOCKED" });
    }
    const updated = await transitionCall(call.id, call.status as DmCallStatus, decision.next, userId);
    if (updated) {
      await afterTransition(updated);
      return respondCall(res, 200, updated, userId, withRtc ? { rtc: rtcFor(updated, userId) } : {});
    }
    // Lost a race: re-read and decide again against the state that won.
    const current = await getCall(call.id);
    if (!current) return res.status(404).json({ error: "Call not found", code: "CALL_NOT_FOUND" });
    call = current;
  }
  return respondCall(res, 409, call, userId, { error: `Call is ${call.status}`, code: "INVALID_CALL_STATE" });
}

router.post("/dm/calls/:id/accept", (req, res) => handleCallAction(req, res, "accept"));
router.post("/dm/calls/:id/decline", (req, res) => handleCallAction(req, res, "decline"));
router.post("/dm/calls/:id/end", (req, res) => handleCallAction(req, res, "end"));

router.post("/dm/calls/:id/token", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const loaded = await loadParticipantCall(req, res);
  if (!loaded) return;
  const { call, role } = loaded;
  const allowed = call.status === "accepted" || (call.status === "ringing" && role === "caller");
  if (!allowed) {
    return respondCall(res, 409, call, userId, { error: `Call is ${call.status}`, code: "INVALID_CALL_STATE" });
  }
  if (!isCallingConfigured()) return notConfigured(res);
  return res.json({ rtc: rtcFor(call, userId) });
});

// Call-ended screen: "How was the quality of your call?" (Good / Not good).
// Only for a call that was actually answered and is over; each side rates its
// own column, and answering again overwrites.
router.post("/dm/calls/:id/rating", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { rating } = req.body ?? {};
  if (rating !== "good" && rating !== "not_good") {
    return res.status(400).json({ error: "rating must be good or not_good" });
  }
  const loaded = await loadParticipantCall(req, res);
  if (!loaded) return;
  const { call, role } = loaded;
  if (!isTerminalCallStatus(call.status) || !call.answeredAt) {
    return respondCall(res, 409, call, userId, { error: `Call is ${call.status}`, code: "INVALID_CALL_STATE" });
  }
  await setCallQualityRating(call.id, role, rating);
  return res.json({ ok: true });
});

router.get("/dm/calls/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const loaded = await loadParticipantCall(req, res);
  if (!loaded) return;
  return respondCall(res, 200, loaded.call, userId);
});

router.get("/dm/incoming", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  res.setHeader("Cache-Control", "no-store");
  // Newest first; stale ones are moved to `missed` on the way.
  const calls = await Promise.all((await getRingingCallsForCallee(userId)).map(expireCallIfStale));
  const call = calls.find((c) => c.status === "ringing");
  if (call) return respondCall(res, 200, call, userId);
  return res.json({ call: null });
});

router.get("/dm/conversations/:conversationId/calls", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const conversationId = String(req.params.conversationId ?? "");
  const participants = UUID_RE.test(conversationId) ? await getCallParticipants(conversationId) : [];
  if (!participants.some((p) => p.userId === userId)) {
    return res.status(403).json({ error: "Not a participant in this conversation", code: "NOT_A_PARTICIPANT" });
  }
  const rawLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 50;
  const rows = await listConversationCalls(conversationId, limit);
  const calls = await Promise.all(rows.map(expireCallIfStale));
  const view = await loadCallView(conversationId, participants);
  return res.json({ calls: calls.map((c) => serializeCall(c, userId, view.participants, view.avatars)) });
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

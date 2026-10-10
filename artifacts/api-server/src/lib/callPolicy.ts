/**
 * Who may ring whom — the single place the 1:1 DM call policy is decided.
 * Used by POST /api/call/dm/calls (create) and re-checked on accept
 * (routes/call.ts); a block placed mid-ring ends the call
 * (routes/social.ts → endLiveCallsBetween).
 *
 * Rules, in order:
 *   1. Blocked either way (caller blocked callee, or callee blocked caller)
 *      → 403 BLOCKED. Same copy for both directions so a block is never
 *      revealed.
 *   2. Pending message request (conversations.is_request = true):
 *        - the requester (requested_by = caller) → 403 CALL_REQUEST_NOT_ACCEPTED
 *        - the recipient                        → 403 CALL_REQUEST_PENDING
 *      Calls follow the same rule as replies (POST /messages answers
 *      REQUEST_NOT_ACCEPTED to the recipient until they accept): nobody can
 *      ring anybody until the recipient taps Accept (PATCH
 *      /api/conversations/:id/accept). Calling never accepts a request
 *      implicitly — Accept / Block / Delete stays the recipient's explicit
 *      choice.
 *   3. Otherwise → ok.
 *
 * Deliberately NOT a rule: a muted chat (conversation_participants.muted_until).
 * Mute silences message notifications only; a call still rings the callee
 * (in-app socket, the "calls" push channel and the native VoIP ring).
 */
import { conversations, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isBlockedEitherWay } from "./dmCallsStore";

export type CallPolicyCode = "BLOCKED" | "CALL_REQUEST_NOT_ACCEPTED" | "CALL_REQUEST_PENDING";

export type CallPolicyDenied = { ok: false; status: 403; code: CallPolicyCode; error: string };
export type CallPolicyResult = { ok: true } | CallPolicyDenied;

export type CallPolicyFacts = {
  callerId: string;
  calleeId: string;
  /** Either user has blocked the other. */
  blocked: boolean;
  conversation: { isRequest: boolean | null; requestedBy: string | null };
  /** Ignored on purpose (see the header) — present so the rule is explicit and tested. */
  calleeMutedUntil?: Date | null;
};

export const CALL_POLICY_MESSAGES: Record<CallPolicyCode, string> = {
  BLOCKED: "You can't call this person",
  CALL_REQUEST_NOT_ACCEPTED: "You can call once they accept your message request",
  CALL_REQUEST_PENDING: "Accept the message request to call",
};

function deny(code: CallPolicyCode): CallPolicyDenied {
  return { ok: false, status: 403, code, error: CALL_POLICY_MESSAGES[code] };
}

/** Pure decision over already-loaded facts. */
export function canCall(facts: CallPolicyFacts): CallPolicyResult {
  if (facts.blocked) return deny("BLOCKED");
  if (facts.conversation.isRequest) {
    return facts.conversation.requestedBy === facts.callerId
      ? deny("CALL_REQUEST_NOT_ACCEPTED")
      : deny("CALL_REQUEST_PENDING");
  }
  return { ok: true };
}

/** Loads the facts for one caller → callee in a conversation and decides. */
export async function evaluateCallPolicy(
  callerId: string,
  calleeId: string,
  conversationId: string,
): Promise<CallPolicyResult> {
  const [blocked, [conv]] = await Promise.all([
    isBlockedEitherWay(callerId, calleeId),
    db.select({ isRequest: conversations.isRequest, requestedBy: conversations.requestedBy })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1),
  ]);
  return canCall({
    callerId,
    calleeId,
    blocked,
    conversation: { isRequest: conv?.isRequest ?? false, requestedBy: conv?.requestedBy ?? null },
  });
}

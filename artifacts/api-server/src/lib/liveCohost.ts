/**
 * Live co-host invite state machine — pure logic.
 *
 *   invited  -> accepted (invitee) | declined (invitee) | cancelled (host)
 *   accepted -> removed (host)     | left (co-host)
 *   declined / cancelled / removed / left are terminal; a new invite creates a new row.
 *
 * Plan decision: only the HOST needs the Pro plan (they already passed the
 * gate to start the stream). A co-host is a guest on that stream, so they
 * only have to be a seller account in good standing.
 */

export type CohostStatus = "invited" | "accepted" | "declined" | "cancelled" | "removed" | "left";
export type CohostActor = "host" | "cohost";
export type CohostAction = "accept" | "decline" | "cancel" | "remove" | "leave";

/** Maximum simultaneous co-hosts (invited + accepted) per stream. */
export const MAX_OPEN_COHOSTS = 3;

/**
 * Co-host publisher tokens are short-lived: the co-host app renews through
 * POST /api/live/:id/cohost/token (Agora's token-privilege-will-expire), which
 * refuses once the co-host was removed / left, the live ended, or a block
 * exists — so a removed co-host can publish for at most this long.
 */
export const COHOST_TOKEN_TTL_SECONDS = 10 * 60;

const TRANSITIONS: Record<CohostAction, { from: CohostStatus; actor: CohostActor; to: CohostStatus }> = {
  accept:  { from: "invited",  actor: "cohost", to: "accepted" },
  decline: { from: "invited",  actor: "cohost", to: "declined" },
  cancel:  { from: "invited",  actor: "host",   to: "cancelled" },
  remove:  { from: "accepted", actor: "host",   to: "removed" },
  leave:   { from: "accepted", actor: "cohost", to: "left" },
};

export type TransitionResult =
  | { ok: true; to: CohostStatus }
  | { ok: false; status: number; error: string };

export function transitionCohost(current: CohostStatus, action: CohostAction, actor: CohostActor): TransitionResult {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, status: 400, error: "Unknown action" };
  if (t.actor !== actor) return { ok: false, status: 403, error: "Not allowed" };
  if (current !== t.from) return { ok: false, status: 409, error: `Invite is ${current}` };
  return { ok: true, to: t.to };
}

export function isOpenCohostStatus(s: string): boolean {
  return s === "invited" || s === "accepted";
}

export interface InviteCheckInput {
  hostId: string;
  inviteeId: string;
  streamStatus: string;
  inviteeAccountType: string | null | undefined;
  inviteeSuspended: boolean;
  blocked: boolean;
  openCohostCount: number;
  alreadyOpen: boolean;
}

export type InviteDecision = { ok: true } | { ok: false; status: number; error: string };

export function checkInviteAllowed(i: InviteCheckInput): InviteDecision {
  if (i.streamStatus !== "live") return { ok: false, status: 410, error: "Stream has ended" };
  if (i.inviteeId === i.hostId) return { ok: false, status: 400, error: "You can't invite yourself" };
  if (i.inviteeAccountType !== "seller" && i.inviteeAccountType !== "both") {
    return { ok: false, status: 400, error: "Only sellers can co-host" };
  }
  if (i.inviteeSuspended) return { ok: false, status: 400, error: "This seller can't co-host right now" };
  if (i.blocked) return { ok: false, status: 400, error: "This seller can't be invited" };
  if (i.alreadyOpen) return { ok: false, status: 409, error: "Already invited" };
  if (i.openCohostCount >= MAX_OPEN_COHOSTS) {
    return { ok: false, status: 409, error: `You can have up to ${MAX_OPEN_COHOSTS} co-hosts` };
  }
  return { ok: true };
}

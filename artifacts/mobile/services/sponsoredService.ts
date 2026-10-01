/**
 * Sponsored placement in For You (client side of /api/promotions).
 *
 * The server owns every rule — eligibility, frequency cap, pacing, billing —
 * so this only asks for the slots of each organic page and confirms an
 * impression once a Sponsored post is on screen. Both calls are optional: they
 * never throw, and they are skipped entirely while signed out (no protected
 * API is touched from the signed-out preview).
 */
import { hasServiceToken, serviceRequest } from '@/lib/serviceConfig';

/** One id per app session: a promoted post is never repeated within it. */
const SESSION_ID = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export type SponsoredSlot = { afterIndex: number; boostId: string; post: any };

export async function fetchSponsoredSlots(organicOffset: number, organicCount: number): Promise<SponsoredSlot[]> {
  try {
    if (!(await hasServiceToken())) return [];
    const res = await serviceRequest<{ slots: Array<{ afterIndex: number; boostId: string; post: any }> }>(
      `/api/promotions/sponsored?sessionId=${SESSION_ID}&organicOffset=${organicOffset}&organicCount=${organicCount}`,
      {},
      false,
    );
    return (res.slots ?? []).filter((s) => s?.post?.id && Number.isInteger(s.afterIndex));
  } catch {
    return [];
  }
}

export async function confirmSponsoredImpression(boostId: string): Promise<void> {
  try {
    if (!(await hasServiceToken())) return;
    await serviceRequest('/api/promotions/sponsored/impression', {
      method: 'POST',
      body: JSON.stringify({ boostId, sessionId: SESSION_ID }),
    }, false);
  } catch {
    // Billing confirmation is best-effort; an unconfirmed view is simply not billed.
  }
}

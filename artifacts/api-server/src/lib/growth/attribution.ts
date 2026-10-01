import { db, checkoutAttributions, trackedLinks } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { normalizeLinkCode } from "./linkCodes";
import { sanitizeUtmValue } from "./utm";

export type ClientAttribution = { code?: unknown; source?: unknown; medium?: unknown; campaign?: unknown };

/**
 * Persist which tracked link / UTM campaign a guest web checkout came from.
 * Best effort and strictly additive: it never throws and never affects the
 * checkout. A link code only counts if that link belongs to the store being
 * bought from, so one seller cannot claim another seller's links.
 */
export async function recordCheckoutAttribution(args: {
  checkoutSessionId: string;
  stripeSessionId: string | null;
  sellerId: string;
  attribution: unknown;
}): Promise<void> {
  try {
    const a = (args.attribution && typeof args.attribution === "object" ? args.attribution : null) as ClientAttribution | null;
    if (!a) return;
    const code = normalizeLinkCode(a.code);
    let linkId: string | null = null;
    let utm = { source: sanitizeUtmValue(a.source), medium: sanitizeUtmValue(a.medium), campaign: sanitizeUtmValue(a.campaign) };
    if (code) {
      const [link] = await db.select().from(trackedLinks)
        .where(and(eq(trackedLinks.code, code), eq(trackedLinks.sellerId, args.sellerId))).limit(1);
      if (link) {
        linkId = link.id;
        utm = { source: link.utmSource, medium: link.utmMedium, campaign: link.utmCampaign };
      }
    }
    if (!linkId && !utm.source && !utm.medium && !utm.campaign) return;
    await db.insert(checkoutAttributions).values({
      checkoutSessionId: args.checkoutSessionId,
      stripeSessionId: args.stripeSessionId,
      sellerId: args.sellerId,
      linkId,
      linkCode: linkId ? code : null,
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
    }).onConflictDoNothing();
  } catch {
    // attribution must never break a checkout
  }
}

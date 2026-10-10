/**
 * BT-461: accepting a manufacturer's quote turns it into a payable order card
 * in the seller↔manufacturer conversation (created if it doesn't exist yet),
 * at the quoted price, through the same insert as a card the manufacturer
 * sends by hand. Exactly one card per quote, however often accept is retried.
 */
import { db, manufacturerThreads, manufacturers, sampleOrders, sellerQuoteRequests, users } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { formatMoney, validateCardInput } from "@workspace/manufacturer-flow";
import { insertOrderCard, type OrderCardInput } from "./orderCards";
import { logger } from "../logger";

type QuoteRow = typeof sellerQuoteRequests.$inferSelect;

export type QuoteCardResult =
  | { status: "created" | "existing"; orderId: string; threadId: string; priceCents: number; manufacturerClerkId: string | null; manufacturerName: string }
  | { status: "skipped"; reason: "no_price" | "invalid_card" | "manufacturer_missing"; detail?: string };

/** Card terms for an accepted quote: the quoted price is per unit. */
export function quoteCardInput(quote: Pick<QuoteRow, "type" | "productName" | "quantity" | "quotedPriceCents" | "quotedTurnaround" | "details">): OrderCardInput | null {
  if (!quote.quotedPriceCents || quote.quotedPriceCents < 1) return null;
  const quantity = quote.quantity && quote.quantity > 0 ? quote.quantity : 1;
  const priceCents = quote.quotedPriceCents * quantity;
  if (!Number.isSafeInteger(priceCents)) return null;
  const orderType = quote.type === "sample" && quantity <= 50 ? "sample" : "bulk";
  const terms = [
    `Accepted quote: ${formatMoney(quote.quotedPriceCents)} per piece`,
    quote.quotedTurnaround ? `Turnaround ${quote.quotedTurnaround}` : null,
  ].filter(Boolean).join(" · ");
  return {
    orderType,
    title: quote.productName.trim().slice(0, 120) || "Accepted quote",
    description: [terms, quote.details?.trim() || null].filter(Boolean).join("\n").slice(0, 2000),
    quantity,
    priceCents,
  };
}

async function sellerName(sellerId: string) {
  const [seller] = await db.select({ brandName: users.brandName, displayName: users.displayName, name: users.name })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  return seller?.brandName?.trim() || seller?.displayName?.trim() || seller?.name?.trim() || "A Brandthread seller";
}

async function findOrCreateThread(sellerId: string, manufacturerId: string, subject: string) {
  const where = and(eq(manufacturerThreads.manufacturerId, manufacturerId), eq(manufacturerThreads.buyerClerkId, sellerId));
  const [existing] = await db.select().from(manufacturerThreads).where(where).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(manufacturerThreads)
    .values({ manufacturerId, buyerClerkId: sellerId, buyerName: await sellerName(sellerId), subject: subject.slice(0, 200) })
    .onConflictDoNothing({ target: [manufacturerThreads.manufacturerId, manufacturerThreads.buyerClerkId] })
    .returning();
  return created ?? (await db.select().from(manufacturerThreads).where(where).limit(1))[0];
}

/**
 * Creates (or returns) the payable card for an accepted quote. Never throws for
 * a quote that simply can't become a card (no price, over the card limit);
 * the accept itself has already succeeded and stays accepted.
 */
export async function createOrderCardForAcceptedQuote(quote: QuoteRow): Promise<QuoteCardResult> {
  const [mfr] = await db.select({ id: manufacturers.id, clerkId: manufacturers.clerkId, businessName: manufacturers.businessName })
    .from(manufacturers).where(eq(manufacturers.id, quote.manufacturerId)).limit(1);
  if (!mfr) return { status: "skipped", reason: "manufacturer_missing" };

  const replay = async (): Promise<QuoteCardResult | null> => {
    const [order] = await db.select().from(sampleOrders).where(eq(sampleOrders.quoteRequestId, quote.id)).limit(1);
    if (!order?.threadId) return null;
    return {
      status: "existing", orderId: order.id, threadId: order.threadId, priceCents: order.priceCents,
      manufacturerClerkId: mfr.clerkId, manufacturerName: mfr.businessName,
    };
  };
  const prior = await replay();
  if (prior) return prior;

  const card = quoteCardInput(quote);
  if (!card) return { status: "skipped", reason: "no_price" };
  const check = validateCardInput(card);
  if (!check.ok) return { status: "skipped", reason: "invalid_card", detail: Object.values(check.errors).join(" ") };

  const thread = await findOrCreateThread(quote.sellerId, mfr.id, quote.productName);
  if (!thread) throw new Error("Could not open the seller/manufacturer conversation");
  const created = await db.transaction((tx) => insertOrderCard(tx, {
    manufacturerId: mfr.id,
    thread,
    actorClerkId: mfr.clerkId,
    requestKey: `quote:${quote.id}`,
    card,
    quoteRequestId: quote.id,
  })).catch((err: any) => {
    // A concurrent accept won the unique quote index; replay its card.
    if (err?.code === "23505") return null;
    throw err;
  });
  if (!created) {
    const raced = await replay();
    if (raced) return raced;
    throw new Error("Order card for the accepted quote could not be created");
  }
  logger.info({ quoteId: quote.id, orderId: created.order.id, threadId: thread.id }, "Accepted quote became a payable order card");
  return {
    status: "created", orderId: created.order.id, threadId: thread.id, priceCents: created.order.priceCents,
    manufacturerClerkId: mfr.clerkId, manufacturerName: mfr.businessName,
  };
}

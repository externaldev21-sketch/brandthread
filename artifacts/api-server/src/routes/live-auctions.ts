/**
 * Live auctions for 1-of-1s (F6 item 94), behind the `live_auctions` flag
 * (seeded OFF; when off every route answers 403 LIVE_AUCTIONS_DISABLED and
 * GET answers { enabled: false }). Mounted at /api/live before routes/live.ts.
 *
 *  POST /api/live/:id/auctions                       host starts one { productId, startingBidCents, durationSeconds, suddenDeath }
 *  GET  /api/live/:id/auctions/active                the auction to show (open / just ended / your unpaid win)
 *  POST /api/live/:id/auctions/:auctionId/bid        { amountCents }
 *  POST /api/live/:id/auctions/:auctionId/cancel     host, before the first bid
 *
 * Socket events (ws/liveHub.ts room): auction_started, auction_bid, auction_ended.
 * Rules: lib/liveAuctionRules.ts. Locking + settle + checkout price: lib/liveAuctions.ts.
 */
import { Router, type Response } from "express";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import { parseStartInput } from "../lib/liveAuctionRules";
import {
  AuctionError, activeAuctionFor, cancelAuction, isLiveAuctionsEnabled, placeBid, publicAuction, startAuction,
} from "../lib/liveAuctions";

const router = Router();
const hostPlan = requirePlan("pro");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown) {
  if (e instanceof AuctionError) {
    const auction = (e as any).auction;
    if (auction) {
      return void publicAuction(auction).then((a) => res.status(e.status).json({ error: e.message, code: e.code, auction: a }));
    }
    return res.status(e.status).json({ error: e.message, code: e.code });
  }
  return res.status(500).json({ error: (e as any)?.message ?? "Internal server error" });
}

async function gate(res: Response): Promise<boolean> {
  if (await isLiveAuctionsEnabled()) return true;
  res.status(403).json({ error: "Live auctions aren't available right now.", code: "LIVE_AUCTIONS_DISABLED" });
  return false;
}

router.post("/:id/auctions", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const streamId = String(req.params.id);
  if (!UUID_RE.test(streamId)) return res.status(404).json({ error: "Not found" });
  if (!(await gate(res))) return;
  const parsed = parseStartInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: "INVALID_AUCTION" });
  try {
    const a = await startAuction(sellerId, streamId, parsed.value);
    return res.status(201).json({ auction: await publicAuction(a, sellerId) });
  } catch (e) {
    return fail(res, e);
  }
});

router.get("/:id/auctions/active", async (req, res) => {
  const streamId = String(req.params.id);
  if (!UUID_RE.test(streamId)) return res.json({ enabled: false, auction: null });
  if (!(await isLiveAuctionsEnabled())) return res.json({ enabled: false, auction: null });
  try {
    const viewerId = optionalViewerId(req);
    const a = await activeAuctionFor(streamId, viewerId);
    if (a && viewerId && viewerId !== a.sellerId && await isBlockedEitherWay(viewerId, a.sellerId)) {
      return res.json({ enabled: true, auction: null });
    }
    return res.json({ enabled: true, auction: a ? await publicAuction(a, viewerId) : null });
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/:id/auctions/:auctionId/bid", requireAuth, async (req, res) => {
  const bidderId = (req as any).clerkUserId as string;
  const streamId = String(req.params.id);
  const auctionId = String(req.params.auctionId);
  if (!UUID_RE.test(streamId) || !UUID_RE.test(auctionId)) return res.status(404).json({ error: "Auction not found" });
  if (!(await gate(res))) return;
  const amountCents = Number(req.body?.amountCents);
  try {
    const a = await placeBid(streamId, auctionId, bidderId, amountCents);
    return res.json({ auction: await publicAuction(a, bidderId) });
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/:id/auctions/:auctionId/cancel", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const streamId = String(req.params.id);
  const auctionId = String(req.params.auctionId);
  if (!UUID_RE.test(streamId) || !UUID_RE.test(auctionId)) return res.status(404).json({ error: "Auction not found" });
  if (!(await gate(res))) return;
  try {
    const a = await cancelAuction(sellerId, streamId, auctionId);
    return res.json({ auction: await publicAuction(a, sellerId) });
  } catch (e) {
    return fail(res, e);
  }
});

export default router;

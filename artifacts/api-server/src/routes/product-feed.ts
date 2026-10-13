/**
 * Product feed for Meta (Facebook / Instagram Shopping) and TikTok catalogs.
 *
 * Seller (mounted at /seller/product-feed behind teamContext, marketing permission):
 *   GET  /             { feed: null | { metaUrl, tiktokUrl, createdAt, rotatedAt, metaFetchedAt, tiktokFetchedAt }, productCount, itemCount }
 *   POST /             create the feed URL (idempotent; returns the existing one)
 *   POST /regenerate   new secret URL; every earlier URL stops working
 *
 * Public (mounted at /public/feeds, no auth). Rate-limited by the app-wide
 * limiter (unauthenticated GET = "public-read" policy, per IP) and served from
 * a 10-minute cache, so a burst of fetches never rebuilds the catalog.
 *   GET /:token/meta.csv     Meta Commerce Manager data feed
 *   GET /:token/tiktok.csv   TikTok catalog data feed
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import {
  feedCounts, findFeedByToken, getFeedCsv, getOrCreateFeed, regenerateFeed, serializeFeed, stampFetched,
} from "../lib/productFeed/service";
import { db, productFeeds } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { FeedPlatform } from "../lib/productFeed/feed";

export const sellerProductFeedRouter = Router();
sellerProductFeedRouter.use(requireAuth);
sellerProductFeedRouter.use(requirePermission("marketing"));

const store = (req: Request) => (req as any).clerkUserId as string;

sellerProductFeedRouter.get("/", async (req, res) => {
  try {
    const sellerId = store(req);
    const [[row], counts] = await Promise.all([
      db.select().from(productFeeds).where(eq(productFeeds.sellerId, sellerId)).limit(1),
      feedCounts(sellerId),
    ]);
    res.json({ feed: serializeFeed(row), ...counts });
  } catch (err) {
    req.log.error({ err }, "product feed overview failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

sellerProductFeedRouter.post("/", async (req, res) => {
  try {
    const sellerId = store(req);
    const { row, created } = await getOrCreateFeed(sellerId);
    res.status(created ? 201 : 200).json({ feed: serializeFeed(row), ...(await feedCounts(sellerId)) });
  } catch (err) {
    req.log.error({ err }, "product feed create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

sellerProductFeedRouter.post("/regenerate", async (req, res) => {
  try {
    const sellerId = store(req);
    const row = await regenerateFeed(sellerId);
    res.json({ feed: serializeFeed(row), ...(await feedCounts(sellerId)) });
  } catch (err) {
    req.log.error({ err }, "product feed regenerate failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export const publicProductFeedRouter = Router();

async function serveFeed(req: Request, res: Response, platform: FeedPlatform) {
  try {
    const feed = await findFeedByToken(String(req.params.token ?? ""));
    if (!feed) {
      res.status(404).set("Cache-Control", "no-store").json({ error: "Feed not found", code: "NOT_FOUND" });
      return;
    }
    const csv = await getFeedCsv(feed.sellerId, platform);
    await stampFetched(feed.sellerId, platform).catch((err) => req.log?.warn({ err }, "product feed fetch stamp failed"));
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="brandthread-${platform}-feed.csv"`,
      // A secret URL: keep it out of shared caches and search engines.
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    });
    res.send(csv);
  } catch (err) {
    req.log?.error({ err }, "product feed render failed");
    res.status(500).json({ error: "Internal server error" });
  }
}

publicProductFeedRouter.get("/:token/meta.csv", (req, res) => serveFeed(req, res, "meta"));
publicProductFeedRouter.get("/:token/tiktok.csv", (req, res) => serveFeed(req, res, "tiktok"));

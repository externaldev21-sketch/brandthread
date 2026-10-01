#!/usr/bin/env -S tsx
/**
 * Idempotently creates the App Store / Google Play REVIEW demo accounts: one
 * demo BUYER and one demo SELLER (with a realistic store), in Clerk and in
 * the database. Rows are flagged users.is_review_account = true so the
 * test-data purge leaves them alone.
 *
 * Safety model:
 *   - Credentials come ONLY from env vars. Nothing secret is committed.
 *       REVIEW_DEMO_BUYER_EMAIL / REVIEW_DEMO_BUYER_PASSWORD
 *       REVIEW_DEMO_SELLER_EMAIL / REVIEW_DEMO_SELLER_PASSWORD
 *       REVIEW_DEMO_ASSET_BASE_URL   (optional, https; serves <slug>.jpg images)
 *     plus DATABASE_URL and CLERK_SECRET_KEY of the target environment.
 *   - --dry-run prints the plan and touches neither Clerk nor the DB.
 *   - A real run REQUIRES --confirm-production.
 *   - Re-running is safe: every row is looked up by a natural key (email,
 *     username, SKU, order number, review/order pair, caption, follow pair)
 *     and updated or skipped, never duplicated.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:review-accounts -- --dry-run
 *   pnpm --filter @workspace/api-server run seed:review-accounts -- --confirm-production
 *   pnpm --filter @workspace/api-server run seed:review-accounts -- --render-notes
 *     (prints REVIEW_NOTES.md with credentials filled from env, to stdout only;
 *      paste into App Store Connect, never save it into the repo)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  DEMO_BRAND_NAME,
  DEMO_BUYER_USERNAME,
  DEMO_ORDERS,
  DEMO_POSTS,
  DEMO_SELLER_USERNAME,
  buildProducts,
  checkRunGuard,
  imageUrl,
  orderTotals,
  parseFlags,
  readDemoEnv,
  renderNotes,
  summarize,
  type DemoEnv,
} from "../src/scripts/reviewDemo/plan";

const TERMS_VERSION = "review-seed";

async function ensureClerkUser(email: string, password: string, firstName: string, lastName: string): Promise<string> {
  const existing = await clerkClient.users.getUserList({ emailAddress: [email], limit: 1 });
  if (existing.data.length) return existing.data[0].id;
  const created = await clerkClient.users.createUser({
    emailAddress: [email],
    password,
    firstName,
    lastName,
    skipPasswordChecks: false,
  });
  return created.id;
}

async function seed(env: DemoEnv) {
  // Loaded lazily: @workspace/db throws without DATABASE_URL, and --dry-run
  // must work with no database configured.
  const { db, pool, users, products, productVariants, customers, orders, orderItems, reviews, posts, follows } =
    await import("@workspace/db");
  const upsertUser = async (values: typeof users.$inferInsert): Promise<void> => {
    const { clerkId: _clerkId, ...rest } = values;
    await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({ target: users.clerkId, set: { ...rest, updatedAt: new Date() } });
  };
  try {
    await run();
  } finally {
    await pool.end().catch(() => {});
  }

  async function run() {
  const base = env.assetBaseUrl;
  const sellerClerkId = await ensureClerkUser(env.sellerEmail, env.sellerPassword, "Atelier", "Demo");
  const buyerClerkId = await ensureClerkUser(env.buyerEmail, env.buyerPassword, "Review", "Buyer");
  const now = new Date();

  await upsertUser({
    clerkId: sellerClerkId,
    email: env.sellerEmail,
    name: "Atelier Demo",
    role: "owner",
    accountType: "seller",
    displayName: DEMO_BRAND_NAME,
    username: DEMO_SELLER_USERNAME,
    brandName: DEMO_BRAND_NAME,
    brandType: "apparel",
    brandStage: "established",
    sellModel: "own_products",
    bio: "Demo storefront used by app reviewers: everyday basics, made in small runs.",
    category: "Fashion",
    location: "Brooklyn, NY",
    avatarUrl: imageUrl(base, "atelier-avatar", 400, 400),
    profileImageUrl: imageUrl(base, "atelier-avatar", 400, 400),
    logoUrl: imageUrl(base, "atelier-logo", 400, 400),
    bannerUrl: imageUrl(base, "atelier-cover", 1200, 600),
    onboardingComplete: true,
    verified: true,
    verificationStatus: "verified",
    termsAcceptedAt: now,
    termsVersion: TERMS_VERSION,
    isReviewAccount: true,
  });
  await upsertUser({
    clerkId: buyerClerkId,
    email: env.buyerEmail,
    name: "Review Buyer",
    role: "buyer",
    accountType: "buyer",
    displayName: "Review Buyer",
    username: DEMO_BUYER_USERNAME,
    bio: "App review demo buyer.",
    avatarUrl: imageUrl(base, "buyer-avatar", 400, 400),
    profileImageUrl: imageUrl(base, "buyer-avatar", 400, 400),
    onboardingComplete: true,
    termsAcceptedAt: now,
    termsVersion: TERMS_VERSION,
    isReviewAccount: true,
  });

  // Products + variants
  const productIds = new Map<string, string>();
  const variantIds = new Map<string, string[]>();
  for (const p of buildProducts(base)) {
    const [found] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.ownerId, sellerClerkId), eq(products.name, p.name)))
      .limit(1);
    let productId = found?.id;
    const fields = { description: p.description, category: p.category, tags: p.tags, images: p.images, status: "active" };
    if (productId) await db.update(products).set({ ...fields, updatedAt: new Date() }).where(eq(products.id, productId));
    else {
      const [row] = await db.insert(products).values({ ownerId: sellerClerkId, name: p.name, ...fields }).returning({ id: products.id });
      productId = row.id;
    }
    productIds.set(p.key, productId);
    const ids: string[] = [];
    for (const v of p.variants) {
      const [fv] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, v.sku)).limit(1);
      if (fv) {
        await db.update(productVariants).set({ priceCents: v.priceCents, stock: v.stock, size: v.size, color: v.color, updatedAt: new Date() }).where(eq(productVariants.id, fv.id));
        ids.push(fv.id);
      } else {
        const [row] = await db.insert(productVariants).values({ productId, sku: v.sku, size: v.size, color: v.color, priceCents: v.priceCents, stock: v.stock }).returning({ id: productVariants.id });
        ids.push(row.id);
      }
    }
    variantIds.set(p.key, ids);
  }

  // Customer row (seller-side CRM entry for the demo buyer)
  let [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.ownerId, sellerClerkId), eq(customers.email, env.buyerEmail))).limit(1);
  if (!customer) {
    [customer] = await db.insert(customers).values({
      ownerId: sellerClerkId,
      email: env.buyerEmail,
      name: "Review Buyer",
      address: { street: "1 Demo Street", city: "Brooklyn", state: "NY", zip: "11201", country: "US" },
    }).returning({ id: customers.id });
  }

  // Orders + items + reviews
  const catalogue = new Map(buildProducts(base).map((p) => [p.key, p]));
  for (const o of DEMO_ORDERS) {
    const product = catalogue.get(o.productKey)!;
    const variant = product.variants[o.variantIndex];
    const variantId = variantIds.get(o.productKey)![o.variantIndex];
    const totals = orderTotals(variant.priceCents, o.quantity, o.status);
    const placedAt = new Date(Date.now() - o.daysAgo * 86_400_000);
    let [order] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.ownerId, sellerClerkId), eq(orders.orderNumber, o.orderNumber))).limit(1);
    if (!order) {
      [order] = await db.insert(orders).values({
        ownerId: sellerClerkId,
        buyerId: buyerClerkId,
        orderNumber: o.orderNumber,
        customerId: customer.id,
        status: o.status,
        totalCents: totals.totalCents,
        subtotalCents: totals.subtotalCents,
        shippingCents: totals.shippingCents,
        grossChargedCents: totals.paid ? totals.totalCents : 0,
        paidAt: totals.paid ? placedAt : null,
        trackingStatus: o.trackingStatus,
        trackingNumber: o.trackingStatus ? `DEMO${o.orderNumber.replace(/\D/g, "")}` : null,
        carrier: o.trackingStatus ? "USPS" : null,
        shippingAddress: { name: "Review Buyer", street: "1 Demo Street", city: "Brooklyn", state: "NY", zip: "11201", country: "US" },
        createdAt: placedAt,
      }).returning({ id: orders.id });
      await db.insert(orderItems).values({
        orderId: order.id,
        variantId,
        productName: product.name,
        variantLabel: [variant.size, variant.color].filter(Boolean).join(" / ") || null,
        quantity: o.quantity,
        priceCents: variant.priceCents,
      });
    }
    if (o.review) {
      const [fr] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.buyerId, buyerClerkId), eq(reviews.orderId, order.id))).limit(1);
      if (!fr) {
        await db.insert(reviews).values({ buyerId: buyerClerkId, sellerId: sellerClerkId, orderId: order.id, productId: productIds.get(o.productKey)!, rating: o.review.rating, body: o.review.body });
      }
    }
  }

  // Posts
  for (const p of DEMO_POSTS) {
    const [fp] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.userId, sellerClerkId), eq(posts.caption, p.caption))).limit(1);
    if (!fp) {
      await db.insert(posts).values({
        userId: sellerClerkId,
        mediaUrl: imageUrl(base, `post-${p.key}`, 1080, 1920),
        mediaType: "photo",
        caption: p.caption,
        hashtags: p.hashtags,
        postStatus: "published",
        publishedAt: new Date(),
      });
    }
  }

  // Follow relationship: demo buyer follows demo seller
  await db.insert(follows).values({ followerId: buyerClerkId, followingId: sellerClerkId }).onConflictDoNothing();
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (process.argv.includes("--render-notes")) {
    const r = readDemoEnv(process.env);
    if (!r.ok || !r.env) {
      console.error("Cannot render:\n" + r.errors.map((e) => `  - ${e}`).join("\n"));
      process.exit(1);
    }
    const here = path.dirname(fileURLToPath(import.meta.url));
    const tpl = fs.readFileSync(path.resolve(here, "../../../REVIEW_NOTES.md"), "utf8");
    process.stdout.write(renderNotes(tpl, r.env));
    return;
  }
  const guard = checkRunGuard(flags);
  if ("error" in guard) {
    console.error(guard.error);
    process.exit(1);
  }
  const envResult = readDemoEnv(process.env);
  if (!envResult.ok || !envResult.env) {
    console.error("Cannot run:\n" + envResult.errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  const summary = summarize(envResult.env.assetBaseUrl);
  console.log("Plan (emails and passwords are read from env and never printed):");
  console.log(JSON.stringify(summary, null, 2));
  if (guard.mode === "dry-run") {
    console.log("Dry run only. Nothing was written to Clerk or the database.");
    return;
  }
  await seed(envResult.env);
  console.log("Review demo accounts are seeded. Sign in with the env-provided credentials.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

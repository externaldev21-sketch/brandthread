/**
 * Seeds a small, clearly-fictional catalog into a throwaway database and
 * serves the REAL search routes over it, so the search-upgrade screenshots
 * (artifacts/mobile/scripts/search-upgrade-screenshots.mjs) show actual
 * ranking/pagination output instead of hand-written fixtures.
 *
 *   SEARCH_DEMO_DATABASE_URL=postgres://…/brandthread_test \
 *     pnpm exec tsx ./scripts/searchUpgradeDemoServer.ts --port 4789
 *
 * Refuses any database whose name does not end in _test or _demo. Seeded
 * rows use the `sud-` id prefix and are replaced on every start.
 */
import express from "express";

const url = process.env.SEARCH_DEMO_DATABASE_URL;
const dbName = url ? new URL(url).pathname.replace(/^\//, "") : "";
if (!url || !/_(test|demo)$/.test(dbName)) {
  console.error("Set SEARCH_DEMO_DATABASE_URL to a database whose name ends in _test or _demo.");
  process.exit(1);
}
process.env.DATABASE_URL = url;
delete process.env.DATABASE_READ_URL;

const portArg = process.argv.indexOf("--port");
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 4789;
const IMG = "https://cdn.brandthread.test/demo";

const { db, follows, posts, products, productVariants, users } = await import("@workspace/db");
const { like } = await import("drizzle-orm");

const sellers = [
  { id: "sud-s-northline", brand: "Northline Studio", username: "northline", followers: 4 },
  { id: "sud-s-vault", brand: "Vault Vintage", username: "vaultvintage", followers: 2 },
  { id: "sud-s-ember", brand: "Ember Goods", username: "embergoods", followers: 1 },
  { id: "sud-s-atlas", brand: "Atlas Supply", username: "atlassupply", followers: 0 },
  { id: "sud-s-coldform", brand: "Coldform", username: "coldform", followers: 0 },
];
const buyers = [
  { id: "sud-b-1", name: "Hoodie Hannah", username: "hoodiehannah" },
  { id: "sud-b-2", name: "Maya Ortiz", username: "maya.vintage" },
  { id: "sud-b-3", name: "Jordan Lee", username: "jordanlee" },
  { id: "sud-b-4", name: "Sam Rivera", username: "samhoodies" },
];
type P = { owner: string; name: string; price: number; img: string; style?: string[]; tags?: string[]; category?: string; description?: string };
const catalog: P[] = [
  { owner: "sud-s-northline", name: "Hoodie — Heavyweight Ember", price: 8800, img: "hoodie-ember", style: ["streetwear"] },
  { owner: "sud-s-northline", name: "Hoodie — Graphite", price: 8800, img: "hoodie-graphite", style: ["streetwear", "minimalist"] },
  { owner: "sud-s-ember", name: "Zip Hoodie Moss", price: 9400, img: "hoodie-moss", style: ["gorpcore"] },
  { owner: "sud-s-vault", name: "Washed Vintage Hoodie", price: 6200, img: "hoodie-bone", style: ["vintage"] },
  { owner: "sud-s-coldform", name: "Midnight Pullover", price: 7200, img: "hoodie-midnight", description: "Hoodie-weight brushed fleece pullover", style: ["minimalist"] },
  { owner: "sud-s-atlas", name: "Boxy Crewneck Hoodies Pack", price: 12000, img: "texture-mono", style: ["basics"] },
  { owner: "sud-s-vault", name: "Vintage Rust Bomber", price: 14500, img: "jacket-rust", style: ["vintage"] },
  { owner: "sud-s-vault", name: "Y2K Baby Tee", price: 3200, img: "look-rust", style: ["y2k"] },
  { owner: "sud-s-northline", name: "Onyx Shell Jacket", price: 19800, img: "jacket-onyx", style: ["techwear"] },
  { owner: "sud-s-ember", name: "Cargo Pant Rust", price: 9800, img: "cargo-rust", style: ["streetwear"] },
  { owner: "sud-s-atlas", name: "Trail Runner Stone", price: 13500, img: "runner-stone", style: ["gorpcore"] },
  { owner: "sud-s-ember", name: "Logo Cap", price: 2800, img: "texture-ember", category: "accessories", tags: ["Streetwear"] },
  { owner: "sud-s-coldform", name: "Canvas Tote", price: 3600, img: "look-mono", category: "accessories", style: ["minimalist"] },
  { owner: "sud-s-vault", name: "Vintage Leather Belt", price: 4200, img: "portrait-rust", style: ["vintage"] },
];
const postRows = [
  { user: "sud-s-northline", caption: "Hoodie season starts now #hoodie #streetwear", img: "story-hoodie", type: "video" },
  { user: "sud-b-1", caption: "My hoodie rotation this week", img: "story-rust", type: "photo" },
  { user: "sud-s-vault", caption: "Thrifted vintage hoodie haul #vintage", img: "story-mono", type: "photo" },
  { user: "sud-b-4", caption: "Fit check — oversized hoodie + cargos", img: "look-rust", type: "photo" },
];

async function seed() {
  await db.delete(posts).where(like(posts.userId, "sud-%"));
  await db.delete(products).where(like(products.ownerId, "sud-%"));
  await db.delete(follows).where(like(follows.followingId, "sud-%"));
  await db.delete(follows).where(like(follows.followerId, "sud-%"));
  await db.delete(users).where(like(users.clerkId, "sud-%"));
  await db.insert(users).values([
    ...sellers.map((s) => ({ clerkId: s.id, email: `${s.id}@demo.local`, name: s.brand, displayName: s.brand, brandName: s.brand, username: s.username, role: "seller", accountType: "seller", verified: s.followers >= 4 })),
    ...buyers.map((b) => ({ clerkId: b.id, email: `${b.id}@demo.local`, name: b.name, displayName: b.name, username: b.username, role: "buyer", accountType: "buyer" })),
  ]);
  for (const s of sellers) {
    for (let i = 0; i < s.followers; i++) await db.insert(follows).values({ followerId: buyers[i % buyers.length].id, followingId: s.id }).onConflictDoNothing();
  }
  let n = 0;
  for (const p of catalog) {
    const [row] = await db.insert(products).values({
      ownerId: p.owner, name: p.name, status: "active", images: [`${IMG}/${p.img}.jpg`],
      styleTags: p.style ?? [], tags: p.tags ?? [], category: p.category ?? "apparel", description: p.description ?? null,
    }).returning();
    await db.insert(productVariants).values({ productId: row.id, sku: `sud-${n++}`, size: "M", color: "Black", priceCents: p.price, stock: 5 });
  }
  for (const p of postRows) {
    await db.insert(posts).values({ userId: p.user, mediaType: p.type, mediaUrl: `${IMG}/${p.img}.jpg`, thumbnailUrl: `${IMG}/${p.img}.jpg`, caption: p.caption });
  }
}

await seed();
const { default: searchUnified } = await import("../src/routes/search-unified");
const { default: publicRouter } = await import("../src/routes/public");
const { default: discoveryRouter } = await import("../src/routes/discovery");
const app = express();
app.use((req, _res, next) => { (req as any).log = { error: console.error, warn: console.warn, info: () => {} }; next(); });
app.use("/api/public", searchUnified, publicRouter, discoveryRouter);
app.listen(port, "127.0.0.1", () => console.log(`search demo API on http://127.0.0.1:${port}`));

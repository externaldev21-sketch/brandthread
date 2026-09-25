import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, manufacturers, pool, products, users } from "@workspace/db";
import { purgeTestData } from "@workspace/db/testing";

const RUN = crypto.randomBytes(5).toString("hex");
const uid = (tag: string) => `${tag}-${RUN}`;

// A "real-looking" seller: a normal Gmail address and human name — exactly
// the shape of a genuine account. If the purge ever matches this, it has a
// false-positive and must not ship.
const realClerkId = `user_2${uid("real")}`;
const realEmail = `jane.doe.${uid("real")}@gmail.com`;

// The account-deletion tombstone address production code writes for real
// erasure requests (routes/auth.ts) — ends in `.invalid` just like the fake
// test domains, so it's the sharpest false-positive risk for the TLD-based
// detector and must be excluded explicitly.
const tombstoneClerkId = `deleted_${uid("tomb")}`;
const tombstoneEmail = `deleted+${uid("tombstone")}@deleted.brandthread.invalid`;

// A fabricated test row using the exact moneyHarness.ts signature.
const testClerkId = `money-seller-${uid("fake")}`;
const testEmail = `${testClerkId}@money-tests.invalid`;

describe("purgeTestData", () => {
  afterAll(async () => {
    // Clean up the real-looking rows ourselves — the purge (correctly) never
    // touches them, and the shared afterAll sweep in vitest.setup.ts only
    // matches test signatures, so nothing else will remove them either.
    await db.delete(users).where(eq(users.clerkId, realClerkId));
    await db.delete(users).where(eq(users.clerkId, tombstoneClerkId));
    await db.delete(manufacturers).where(eq(manufacturers.businessName, "Acme Textiles Inc"));
  });

  it("matches only test-signature rows and leaves real-looking rows and the deletion tombstone alone", async () => {
    await db.insert(users).values({ clerkId: realClerkId, email: realEmail, name: "Jane Doe", role: "seller" });
    await db.insert(users).values({ clerkId: tombstoneClerkId, email: tombstoneEmail, name: "Deleted User", role: "seller" });
    await db.insert(users).values({ clerkId: testClerkId, email: testEmail, name: "Seller Fake", role: "seller" });

    const [realManufacturer] = await db
      .insert(manufacturers)
      .values({ businessName: "Acme Textiles Inc", country: "US", specialty: "Knitwear", status: "active" })
      .returning();
    const [testManufacturer] = await db
      .insert(manufacturers)
      .values({ businessName: `Factory ${uid("mfr")}`, country: "PT", specialty: "Knitwear", status: "active" })
      .returning();

    const [realProduct] = await db
      .insert(products)
      .values({ ownerId: realClerkId, name: "Vintage Denim Jacket", status: "active" })
      .returning();
    const [testProduct] = await db
      .insert(products)
      .values({ ownerId: testClerkId, name: `Tee ${uid("product")}`, status: "active" })
      .returning();

    const dryRun = await purgeTestData(pool, { dryRun: true });

    const usersRow = dryRun.tables.find((t) => t.table === "users");
    const manufacturersRow = dryRun.tables.find((t) => t.table === "manufacturers");
    const productsRow = dryRun.tables.find((t) => t.table === "products");

    // Exactly the fake user/manufacturer/product are counted — never the
    // real-looking or tombstone rows, which would inflate these counts.
    expect(usersRow?.matched).toBe(1);
    expect(manufacturersRow?.matched).toBe(1);
    expect(productsRow?.matched).toBe(1);

    await purgeTestData(pool, { dryRun: false });

    const [stillReal] = await db.select().from(users).where(eq(users.clerkId, realClerkId));
    const [stillTombstone] = await db.select().from(users).where(eq(users.clerkId, tombstoneClerkId));
    const [stillRealManufacturer] = await db.select().from(manufacturers).where(eq(manufacturers.id, realManufacturer.id));
    const [stillRealProduct] = await db.select().from(products).where(eq(products.id, realProduct.id));
    expect(stillReal).toBeTruthy();
    expect(stillTombstone).toBeTruthy();
    expect(stillRealManufacturer).toBeTruthy();
    expect(stillRealProduct).toBeTruthy();

    const [deletedFakeUser] = await db.select().from(users).where(eq(users.clerkId, testClerkId));
    const [deletedFakeManufacturer] = await db.select().from(manufacturers).where(eq(manufacturers.id, testManufacturer.id));
    const [deletedFakeProduct] = await db.select().from(products).where(eq(products.id, testProduct.id));
    expect(deletedFakeUser).toBeUndefined();
    expect(deletedFakeManufacturer).toBeUndefined();
    expect(deletedFakeProduct).toBeUndefined();
  });
});

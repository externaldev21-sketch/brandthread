import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inArray, isNotNull, like, sql } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";
import { assignFoundingSellerNumber, FOUNDING_SELLER_LIMIT } from "../foundingSellers";
import { toPublicSellerProfile } from "../publicProfile";

// Test database only: this suite owns users.founding_seller_number while it
// runs (vitest runs DB files one at a time), so it clears the column first.
const suffix = crypto.randomBytes(4).toString("hex");
const prefix = `founding-${suffix}-`;
const id = (name: string) => `${prefix}${name}`;

async function makeUser(name: string, extra: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({
    clerkId: id(name),
    email: `${id(name)}@brandthread-spec.com`,
    name,
    accountType: "seller",
    onboardingComplete: true,
    ...extra,
  });
  return id(name);
}

const assign = (clerkId: string) => db.transaction((tx) => assignFoundingSellerNumber(tx, clerkId));

async function numberOf(clerkId: string): Promise<number | null> {
  const [row] = await db.select({ n: users.foundingSellerNumber }).from(users).where(inArray(users.clerkId, [clerkId]));
  return row?.n ?? null;
}

beforeAll(async () => {
  await db.update(users).set({ foundingSellerNumber: null }).where(isNotNull(users.foundingSellerNumber));
});

afterAll(async () => {
  await db.delete(users).where(like(users.clerkId, `${prefix}%`));
});

describe("founding seller numbers", () => {
  it("assigns the next number once and keeps it on retries", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    expect(await assign(a)).toBe(1);
    expect(await assign(a)).toBe(1);
    expect(await assign(b)).toBe(2);
    expect(await numberOf(a)).toBe(1);
  });

  it("skips buyers, review/system accounts, suspended or deleted accounts and test emails", async () => {
    const buyer = await makeUser("buyer", { accountType: "buyer" });
    const review = await makeUser("review", { isReviewAccount: true });
    const suspended = await makeUser("suspended", { suspendedAt: new Date() });
    const deleting = await makeUser("deleting", { deletionRequestedAt: new Date() });
    const testEmail = id("testmail");
    await db.insert(users).values({ clerkId: testEmail, email: `${testEmail}@seed.test`, name: "t", accountType: "seller" });
    for (const who of [buyer, review, suspended, deleting, testEmail]) {
      expect(await assign(who)).toBeNull();
    }
    expect(await assign(id("missing"))).toBeNull();
  });

  it("never goes past 100, even when sellers finish onboarding at the same moment", async () => {
    // Numbers 3..97 taken by earlier sellers.
    const fillers = Array.from({ length: 95 }, (_, i) => ({
      clerkId: id(`filler-${i}`),
      email: `${id(`filler-${i}`)}@brandthread-spec.com`,
      name: "filler",
      accountType: "seller",
      onboardingComplete: true,
      foundingSellerNumber: i + 3,
    }));
    await db.insert(users).values(fillers);

    const racers = await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser(`racer-${i}`)));
    const results = await Promise.all(racers.map((r) => assign(r)));
    const given = results.filter((n): n is number => n != null).sort((x, y) => x - y);
    expect(given).toEqual([98, 99, 100]);
    expect(results.filter((n) => n == null)).toHaveLength(3);

    const late = await makeUser("late");
    expect(await assign(late)).toBeNull();
    const [{ max }] = (await db.execute(sql`SELECT MAX(founding_seller_number)::int AS max FROM users`) as any).rows;
    expect(max).toBe(FOUNDING_SELLER_LIMIT);
  });

  it("exposes the number on the public seller profile", () => {
    expect(toPublicSellerProfile({ clerkId: "x", foundingSellerNumber: 12 }).foundingSellerNumber).toBe(12);
    expect(toPublicSellerProfile({ clerkId: "x", foundingSellerNumber: null }).foundingSellerNumber).toBeNull();
    expect(toPublicSellerProfile({ clerkId: "x" }).foundingSellerNumber).toBeNull();
  });

  it("migration backfill numbers the earliest sellers by sign-up date and is idempotent", async () => {
    await db.update(users).set({ foundingSellerNumber: null }).where(isNotNull(users.foundingSellerNumber));
    await db.delete(users).where(like(users.clerkId, `${prefix}filler-%`));
    const early = await makeUser("early", { createdAt: new Date("2020-01-01T00:00:00Z") });
    const earlier = await makeUser("earlier", { createdAt: new Date("2019-01-01T00:00:00Z") });
    const reviewEarly = await makeUser("review-early", { isReviewAccount: true, createdAt: new Date("2018-01-01T00:00:00Z") });

    const migration = readFileSync(
      path.resolve(__dirname, "../../../../../lib/db/migrations/271_founding_sellers.sql"), "utf8",
    );
    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(migration);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    };
    await run();
    const first = await numberOf(earlier);
    const second = await numberOf(early);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(await numberOf(reviewEarly)).toBeNull();

    const snapshot = async () => (await db.execute(sql`
      SELECT clerk_id, founding_seller_number FROM users WHERE founding_seller_number IS NOT NULL ORDER BY clerk_id
    `) as any).rows;
    const before = await snapshot();
    expect(before.length).toBeLessThanOrEqual(FOUNDING_SELLER_LIMIT);
    await run();
    expect(await snapshot()).toEqual(before);
  });
});

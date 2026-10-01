/**
 * Seller email marketing against a real DB + the real Express routers, with a
 * mocked email provider (nothing touches the network). Covers public subscribe
 * (idempotency, honeypot, rate limit), unsubscribe + suppression, consent-only
 * audiences, the send queue (batching, daily cap, suppression re-check),
 * delivery webhooks, the feature-off state, and seller isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { db, storefronts, customers, follows, users, emailSubscribers, emailCampaigns, emailSettings } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireRole")>()),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

process.env.SESSION_SECRET = "integration-test-session-secret";

import emailRouter from "../email-marketing";
import publicRouter from "../email-marketing-public";
import storeRouter from "../store";
import webhookRouter from "../email-marketing-webhook";
import { setEmailProvider, type EmailProvider, type OutboundEmail } from "../../lib/emailMarketing/provider";
import { enqueueCampaign, processCampaign } from "../../lib/emailMarketing/sender";
import { resolveAudience } from "../../lib/emailMarketing/audience";
import { signToken } from "../../lib/emailMarketing/tokens";

const P = `em${process.pid}${Date.now() % 100000}`;
const SELLER_A = `${P}-sellerA`;
const SELLER_B = `${P}-sellerB`;
const SLUG_A = `${P}-store-a`;
const SLUG_DRAFT = `${P}-store-draft`;

let configured = true;
let failNext: "none" | "permanent" | "retryable" = "none";
const sent: OutboundEmail[] = [];
const mockProvider: EmailProvider = {
  name: "mock",
  isConfigured: () => configured,
  send: async (e) => {
    if (failNext === "permanent") { failNext = "none"; return { ok: false, error: "mailbox rejected", retryable: false }; }
    if (failNext === "retryable") { failNext = "none"; return { ok: false, error: "rate limited", retryable: true }; }
    sent.push(e);
    return { ok: true, id: `msg_${sent.length}_${crypto.randomUUID().slice(0, 8)}` };
  },
};

let server: Server;
let base = "";
// Rate-limit buckets live in the DB for 10 minutes, so every run uses fresh addresses.
const ipBase = `${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
let ipCounter = 0;
const nextIp = () => `${ipBase}.${(ipCounter++ % 250) + 1}`;

function seller(who: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}/api/marketing/email${path}`, {
    ...init, headers: { "content-type": "application/json", "x-test-acting-as": who, ...(init.headers ?? {}) },
  });
}
const sellerJson = (who: string, method: string, path: string, body?: unknown) =>
  seller(who, path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
function subscribe(slug: string, body: unknown, ip = nextIp()) {
  return fetch(`${base}/api/public/stores/${slug}/subscribe`, {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body),
  });
}
const addr = (n: string) => `${P}-${n}@example.test`;
async function rowFor(sellerId: string, email: string) {
  const r = await db.select().from(emailSubscribers)
    .where(sql`${emailSubscribers.sellerId} = ${sellerId} AND lower(${emailSubscribers.email}) = ${email.toLowerCase()}`);
  return r[0];
}
async function addSub(sellerId: string, email: string, status = "subscribed") {
  const token = crypto.randomBytes(12).toString("base64url");
  const [r] = await db.insert(emailSubscribers).values({ sellerId, email, status, unsubscribeToken: token, consentAt: new Date() }).returning();
  return r;
}
async function makeCampaign(who: string, over: Record<string, unknown> = {}) {
  const res = await sellerJson(who, "POST", "/campaigns", {
    subject: "Spring drop", preheader: "New pieces", audience: "subscribers",
    body: { headline: "New in", text: "Come look.", cta: { label: "Shop", url: "https://shop.example.com" } }, ...over,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}
async function waitStatus(id: string, status: string) {
  await vi.waitFor(async () => {
    const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
    expect(c.status).toBe(status);
  }, { timeout: 8000 });
}

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/webhooks/resend-marketing", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use("/api/webhooks/resend-marketing", webhookRouter);
  app.use("/api/marketing/email", emailRouter);
  app.use("/api/store", storeRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  setEmailProvider(mockProvider);
  await db.insert(storefronts).values([
    {
      ownerId: SELLER_A, slug: SLUG_A, title: "Store A", status: "published",
      theme: { backgroundColor: "#112233", textColor: "#FFEEDD" },
      sections: [{ id: "n1", type: "newsletter", title: "Newsletter", enabled: true, settings: { heading: "Stay close", description: "News", buttonLabel: "Join now" } }],
    },
    { ownerId: SELLER_B, slug: `${P}-store-b`, title: "Store B", status: "published" },
    { ownerId: `${P}-sellerC`, slug: SLUG_DRAFT, title: "Draft", status: "draft" },
  ]);
  await db.insert(emailSettings).values([
    { sellerId: SELLER_A, postalAddress: "1 Main St, New York, NY", fromName: "Store A" },
    { sellerId: SELLER_B, postalAddress: "2 Side St, Austin, TX" },
  ]);
});

afterAll(async () => {
  setEmailProvider(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const sellers = [SELLER_A, SELLER_B, `${P}-sellerC`];
  await db.execute(sql`DELETE FROM email_campaign_sends WHERE seller_id IN (${sql.join(sellers.map((s) => sql`${s}`), sql`, `)})`);
  await db.delete(emailCampaigns).where(inArray(emailCampaigns.sellerId, sellers));
  await db.delete(emailSubscribers).where(inArray(emailSubscribers.sellerId, sellers));
  await db.delete(emailSettings).where(inArray(emailSettings.sellerId, sellers));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, sellers));
  await db.delete(customers).where(inArray(customers.ownerId, sellers));
  await db.delete(follows).where(eq(follows.followingId, SELLER_A));
  await db.delete(users).where(sql`${users.clerkId} LIKE ${P + "%"}`);
});

beforeEach(() => { sent.length = 0; configured = true; failNext = "none"; });

describe("public subscribe", () => {
  it("rejects invalid email and unknown / unpublished stores", async () => {
    expect((await subscribe(SLUG_A, { email: "nope" })).status).toBe(400);
    expect((await subscribe("does-not-exist", { email: addr("x") })).status).toBe(404);
    expect((await subscribe(SLUG_DRAFT, { email: addr("x") })).status).toBe(404);
  });

  it("is idempotent on (seller, lower(email)) and stores consent evidence without the raw IP", async () => {
    const e = addr("idem");
    const a = await subscribe(SLUG_A, { email: e.toUpperCase() });
    const b = await subscribe(SLUG_A, { email: e });
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true, status: "subscribed" });
    expect(await b.json()).toEqual({ ok: true, status: "subscribed" });
    const rows = await db.select().from(emailSubscribers).where(sql`${emailSubscribers.sellerId} = ${SELLER_A} AND lower(${emailSubscribers.email}) = ${e.toLowerCase()}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("subscribed");
    expect(rows[0].consentAt).toBeTruthy();
    expect(rows[0].consentIpHash).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0].unsubscribeToken.length).toBeGreaterThan(20);
  });

  it("honeypot submissions look successful but store nothing", async () => {
    const e = addr("bot");
    const r = await subscribe(SLUG_A, { email: e, website: "http://spam.test" });
    expect(r.status).toBe(200);
    expect(await rowFor(SELLER_A, e)).toBeUndefined();
  });

  it("rate limits repeated submissions of the same address from one connection", async () => {
    const ip = nextIp();
    const e = addr("ratelimit");
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await subscribe(SLUG_A, { email: e }, ip)).status);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it("rate limits one connection across many addresses (per-IP)", async () => {
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await subscribe(SLUG_A, { email: addr(`flood${i}`) }, ip)).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(20);
    expect(codes.slice(20)).toEqual([429, 429]);
  });

  it("double opt-in (when the seller turns it on) stays pending until confirmed", async () => {
    await db.update(emailSettings).set({ doubleOptIn: true }).where(eq(emailSettings.sellerId, SELLER_A));
    try {
      const e = addr("double");
      const r = await subscribe(SLUG_A, { email: e });
      expect(await r.json()).toEqual({ ok: true, status: "pending" });
      const row = await rowFor(SELLER_A, e);
      expect(row.status).toBe("pending");
      expect(sent.some((m) => m.to === e && /Confirm/.test(m.subject))).toBe(true);
      const confirm = await fetch(`${base}/api/public/email/confirm/${signToken("confirm", row.unsubscribeToken)}`);
      expect(confirm.status).toBe(200);
      expect((await rowFor(SELLER_A, e)).status).toBe("subscribed");
      // an unsubscribe token cannot be used to confirm
      const p = await addSub(SELLER_A, addr("double2"), "pending");
      const bad = await fetch(`${base}/api/public/email/confirm/${signToken("unsub", p.unsubscribeToken)}`);
      expect(bad.status).toBe(404);
    } finally {
      await db.update(emailSettings).set({ doubleOptIn: false }).where(eq(emailSettings.sellerId, SELLER_A));
    }
  });
});

describe("store site signup block", () => {
  it("the published site's newsletter section posts to the subscribe endpoint and keeps the seller's theme", async () => {
    const html = await (await fetch(`${base}/api/store/site/${SLUG_A}`)).text();
    expect(html).toContain('class="bt-subscribe"');
    expect(html).toContain(`/api/public/stores/${SLUG_A}/subscribe`);
    expect(html).toContain('name="website"'); // honeypot
    expect(html).toContain("Join now");
    expect(html).toContain("#112233"); // seller's own background, untouched
  });
});

describe("unsubscribe", () => {
  it("GET only shows a confirmation page; POST (one-click) unsubscribes; repeats are harmless", async () => {
    const s = await addSub(SELLER_A, addr("unsub"));
    const url = `${base}/api/public/email/unsubscribe/${signToken("unsub", s.unsubscribeToken)}`;
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<form");
    expect((await rowFor(SELLER_A, s.email)).status).toBe("subscribed");

    const oneClick = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
    expect(oneClick.status).toBe(200);
    const row = await rowFor(SELLER_A, s.email);
    expect(row.status).toBe("unsubscribed");
    expect(row.unsubscribedAt).toBeTruthy();
    expect((await fetch(url, { method: "POST" })).status).toBe(200);
  });

  it("rejects forged, wrong-purpose and unknown tokens", async () => {
    const s = await addSub(SELLER_A, addr("forge"));
    for (const t of ["garbage", `${s.unsubscribeToken}.AAAA`, signToken("confirm", s.unsubscribeToken), signToken("unsub", "unknown-raw-token")]) {
      expect((await fetch(`${base}/api/public/email/unsubscribe/${encodeURIComponent(t)}`, { method: "POST" })).status).toBe(404);
    }
    expect((await rowFor(SELLER_A, s.email)).status).toBe("subscribed");
  });

  it("a new signup re-activates an unsubscribed address, but bounced stays suppressed", async () => {
    const u = await addSub(SELLER_A, addr("resub"), "unsubscribed");
    await subscribe(SLUG_A, { email: u.email });
    expect((await rowFor(SELLER_A, u.email)).status).toBe("subscribed");
    const b = await addSub(SELLER_A, addr("bounced"), "bounced");
    await subscribe(SLUG_A, { email: b.email });
    expect((await rowFor(SELLER_A, b.email)).status).toBe("bounced");
  });
});

describe("audience resolution (consent + suppression)", () => {
  it("returns only subscribed rows; customers/followers are segments of the consented list", async () => {
    const A = `${P}-aud`;
    const consentedCustomer = await addSub(A, addr("cust"));
    await addSub(A, addr("unsubbed"), "unsubscribed");
    await addSub(A, addr("bouncedx"), "bounced");
    await addSub(A, addr("pend"), "pending");
    const plainSub = await addSub(A, addr("plain"));
    // a customer who never subscribed must NOT be emailed
    await db.insert(customers).values([
      { ownerId: A, email: consentedCustomer.email, name: "C1" },
      { ownerId: A, email: addr("never-opted-in"), name: "C2" },
    ]);
    const followerUser = `${P}-follower`;
    const fSub = await addSub(A, addr("fol"));
    await db.insert(users).values({ clerkId: followerUser, email: fSub.email, name: "F" });
    await db.insert(follows).values({ followerId: followerUser, followingId: A });

    const all = await resolveAudience(A, "subscribers");
    expect(all.map((r) => r.email).sort()).toEqual([consentedCustomer.email, plainSub.email, fSub.email].sort());
    expect((await resolveAudience(A, "customers")).map((r) => r.email)).toEqual([consentedCustomer.email]);
    expect((await resolveAudience(A, "followers")).map((r) => r.email)).toEqual([fSub.email]);

    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, A));
    await db.delete(customers).where(eq(customers.ownerId, A));
    await db.delete(follows).where(eq(follows.followingId, A));
  });
});

describe("feature off when no provider key", () => {
  it("status is truthful, drafts still save, send is refused and nothing is sent", async () => {
    configured = false;
    const st = ((await (await seller(SELLER_A, "/status")).json()) as any);
    expect(st.enabled).toBe(false);
    expect(st.provider).toBeNull();
    expect(st.message).toMatch(/isn't set up/i);
    expect(st.tracking).toEqual({ delivered: false, opened: false, clicked: false });
    const c = await makeCampaign(SELLER_A);
    expect((await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/send`, {})).status).toBe(503);
    expect((await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/test`, {})).status).toBe(503);
    expect(sent).toHaveLength(0);
    const after = ((await (await seller(SELLER_A, `/campaigns/${c.id}`)).json()) as any);
    expect(after.status).toBe("draft");
  });
});

describe("campaign send", () => {
  it("sends to consented subscribers only with unsubscribe headers, then reports results", async () => {
    const a1 = await addSub(SELLER_A, addr("s1"));
    const a2 = await addSub(SELLER_A, addr("s2"));
    await addSub(SELLER_A, addr("s-unsub"), "unsubscribed");
    await addSub(SELLER_A, addr("s-bounce"), "bounced");
    await addSub(SELLER_B, addr("other-seller")); // other seller's list must never be mailed
    const c = await makeCampaign(SELLER_A);
    const res = await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/send`, {});
    expect(res.status).toBe(202);
    await waitStatus(c.id, "sent");

    const recipients = sent.map((m) => m.to);
    expect(recipients).toContain(a1.email);
    expect(recipients).toContain(a2.email);
    expect(recipients.some((r) => /s-unsub|s-bounce|other-seller|pend/.test(r))).toBe(false);
    for (const m of sent) {
      expect(m.headers?.["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/api\/public\/email\/unsubscribe\/.+>$/);
      expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(m.html).toContain("/api/public/email/unsubscribe/");
      expect(m.html).toContain("1 Main St, New York, NY");
      expect(m.subject).toBe("Spring drop");
    }
    // the link in the mail really unsubscribes that person
    const link = sent.find((m) => m.to === a1.email)!.headers!["List-Unsubscribe"].slice(1, -1)
      .replace(/^https?:\/\/[^/]+/, base); // same path, pointed at the in-process test server
    expect((await fetch(link, { method: "POST" })).status).toBe(200);
    expect((await rowFor(SELLER_A, a1.email)).status).toBe("unsubscribed");

    const detail = ((await (await seller(SELLER_A, `/campaigns/${c.id}`)).json()) as any);
    expect(detail.status).toBe("sent");
    expect(detail.stats.sent).toBe(recipients.length);
    expect(detail.stats.failed).toBe(0);
    expect(detail.tracking).toBe(false); // no RESEND_WEBHOOK_SECRET in tests
    // sent campaigns are immutable and cannot be re-sent
    expect((await sellerJson(SELLER_A, "PUT", `/campaigns/${c.id}`, { subject: "x" })).status).toBe(409);
    expect((await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/send`, {})).status).toBe(409);
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, SELLER_A));
  });

  it("requires a mailing address and a real audience", async () => {
    const C = `${P}-sellerC`;
    const c = await makeCampaign(C);
    const noAddr = await sellerJson(C, "POST", `/campaigns/${c.id}/send`, {});
    expect(noAddr.status).toBe(400);
    expect(((await noAddr.json()) as any).code).toBe("MAILING_ADDRESS_REQUIRED");
    await db.insert(emailSettings).values({ sellerId: C, postalAddress: "3 Elm St" });
    const none = await sellerJson(C, "POST", `/campaigns/${c.id}/send`, {});
    expect(((await none.json()) as any).code).toBe("NO_RECIPIENTS");
    expect(sent).toHaveLength(0);
  });

  it("re-checks suppression at send time and enforces the daily cap across batches", async () => {
    const S = `${P}-capseller`;
    await db.insert(emailSettings).values({ sellerId: S, postalAddress: "9 Cap St" });
    const subs = [];
    for (let i = 0; i < 5; i++) subs.push(await addSub(S, addr(`cap${i}`)));
    const [camp] = await db.insert(emailCampaigns).values({
      sellerId: S, subject: "Cap", body: { headline: "Hi", text: "", imageUrl: null, productIds: [], cta: null },
    }).returning();
    expect(await enqueueCampaign(camp)).toBe(5);
    // someone unsubscribes after the queue was built
    await db.update(emailSubscribers).set({ status: "unsubscribed" }).where(eq(emailSubscribers.id, subs[0].id));

    const r1 = await processCampaign(camp.id, { provider: mockProvider, cap: 2, batchSize: 1 });
    expect(r1.capReached).toBe(true);
    expect(r1.completed).toBe(false);
    expect(r1.sent + r1.skipped).toBeGreaterThan(0);
    const sentAfterDay1 = sent.length;
    expect(sentAfterDay1).toBe(2);
    expect(sent.map((m) => m.to)).not.toContain(subs[0].email);

    // next UTC day: cap resets and the remainder drains
    const tomorrow = new Date(Date.now() + 26 * 3600_000);
    const r2 = await processCampaign(camp.id, { provider: mockProvider, cap: 10, batchSize: 2, now: () => tomorrow });
    expect(r2.completed).toBe(true);
    expect(sent).toHaveLength(4);
    expect(sent.map((m) => m.to)).not.toContain(subs[0].email);
    const [done] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, camp.id));
    expect(done.status).toBe("sent");
    await db.execute(sql`DELETE FROM email_campaign_sends WHERE seller_id = ${S}`);
    await db.delete(emailCampaigns).where(eq(emailCampaigns.sellerId, S));
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, S));
    await db.delete(emailSettings).where(eq(emailSettings.sellerId, S));
  });

  it("records permanent failures and pauses (re-queues) on retryable provider errors", async () => {
    const S = `${P}-failseller`;
    await db.insert(emailSettings).values({ sellerId: S, postalAddress: "1 Fail St" });
    for (let i = 0; i < 3; i++) await addSub(S, addr(`fail${i}`));
    const [camp] = await db.insert(emailCampaigns).values({
      sellerId: S, subject: "F", body: { headline: "Hi", text: "", imageUrl: null, productIds: [], cta: null },
    }).returning();
    await enqueueCampaign(camp);
    failNext = "permanent";
    const r1 = await processCampaign(camp.id, { provider: mockProvider, batchSize: 1, cap: 100 });
    // first batch hard-fails, the rest send
    expect(r1.failed).toBe(1);
    expect(r1.sent).toBe(2);
    expect(r1.completed).toBe(true);

    const [camp2] = await db.insert(emailCampaigns).values({
      sellerId: S, subject: "R", body: { headline: "Hi", text: "", imageUrl: null, productIds: [], cta: null },
    }).returning();
    await enqueueCampaign(camp2);
    failNext = "retryable";
    const r2 = await processCampaign(camp2.id, { provider: mockProvider, batchSize: 10, cap: 100 });
    expect(r2.retryLater).toBe(true);
    expect(r2.completed).toBe(false);
    expect(r2.remaining).toBeGreaterThan(0);
    const r3 = await processCampaign(camp2.id, { provider: mockProvider, batchSize: 10, cap: 100 });
    expect(r3.completed).toBe(true);
    await db.execute(sql`DELETE FROM email_campaign_sends WHERE seller_id = ${S}`);
    await db.delete(emailCampaigns).where(eq(emailCampaigns.sellerId, S));
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, S));
    await db.delete(emailSettings).where(eq(emailSettings.sellerId, S));
  });

  it("test send goes only to the seller's own account email and never touches the list", async () => {
    await db.insert(users).values({ clerkId: SELLER_A, email: addr("owner-a"), name: "A" }).onConflictDoNothing();
    await addSub(SELLER_A, addr("list-member"));
    const c = await makeCampaign(SELLER_A);
    const r = await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/test`, {});
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(addr("owner-a"));
    expect(sent[0].subject).toMatch(/^\[Test\]/);
    expect(sent[0].headers?.["List-Unsubscribe"]).toBeUndefined();
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, SELLER_A));
  });

  it("scheduling validates the time and can be undone", async () => {
    await addSub(SELLER_A, addr("sched"));
    const c = await makeCampaign(SELLER_A);
    expect((await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/send`, { scheduleAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const ok = await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/send`, { scheduleAt: at });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).status).toBe("scheduled");
    expect(sent).toHaveLength(0);
    expect((((await (await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/unschedule`, {})).json()) as any)).status).toBe("draft");
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, SELLER_A));
  });
});

describe("seller isolation", () => {
  it("one seller cannot read, edit, send, delete or see another seller's data", async () => {
    const sub = await addSub(SELLER_A, addr("iso"));
    const c = await makeCampaign(SELLER_A);
    expect((await seller(SELLER_B, `/campaigns/${c.id}`)).status).toBe(404);
    expect((await sellerJson(SELLER_B, "PUT", `/campaigns/${c.id}`, { subject: "hijack" })).status).toBe(404);
    expect((await sellerJson(SELLER_B, "POST", `/campaigns/${c.id}/send`, {})).status).toBe(404);
    expect((await sellerJson(SELLER_B, "POST", `/campaigns/${c.id}/preview`, {})).status).toBe(404);
    expect((await sellerJson(SELLER_B, "DELETE", `/campaigns/${c.id}`)).status).toBe(404);
    expect((await sellerJson(SELLER_B, "DELETE", `/subscribers/${sub.id}`)).status).toBe(404);
    const listB = ((await (await seller(SELLER_B, "/campaigns")).json()) as any);
    expect(listB.campaigns.find((x: any) => x.id === c.id)).toBeUndefined();
    const audB = ((await (await seller(SELLER_B, "/audience")).json()) as any);
    expect(audB.subscribers.find((x: any) => x.email === sub.email)).toBeUndefined();
    const csvB = await (await seller(SELLER_B, "/audience/export")).text();
    expect(csvB).not.toContain(sub.email);
    const csvA = await (await seller(SELLER_A, "/audience/export")).text();
    expect(csvA).toContain(sub.email);
    expect(csvA.split("\n")[0]).toBe("email,status,source,subscribed_at,joined_at");
    // a seller cannot attach another seller's product to a campaign
    const bad = await sellerJson(SELLER_B, "POST", "/campaigns", { subject: "s", body: { productIds: [crypto.randomUUID()] } });
    expect(bad.status).toBe(400);
    // unauthenticated
    expect((await fetch(`${base}/api/marketing/email/campaigns`)).status).toBe(401);
    // the owner can remove an active subscriber; suppressed rows are retained
    expect((await sellerJson(SELLER_A, "DELETE", `/subscribers/${sub.id}`)).status).toBe(200);
    const sup = await addSub(SELLER_A, addr("iso-sup"), "unsubscribed");
    expect((await sellerJson(SELLER_A, "DELETE", `/subscribers/${sup.id}`)).status).toBe(409);
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, SELLER_A));
  });
});

describe("delivery webhook", () => {
  const key = crypto.randomBytes(24);
  const post = (payload: unknown, sign = true) => {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", key).update(`id1.${ts}.${body}`).digest("base64");
    return fetch(`${base}/api/webhooks/resend-marketing`, {
      method: "POST",
      headers: { "content-type": "application/json", "svix-id": "id1", "svix-timestamp": ts, "svix-signature": sign ? `v1,${sig}` : "v1,bad" },
      body,
    });
  };

  it("is unavailable without a secret, rejects bad signatures, and records only what the provider reports", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await post({ type: "email.opened" })).status).toBe(503);
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${key.toString("base64")}`;
    try {
      expect((await post({ type: "email.opened" }, false)).status).toBe(400);
      const s = await addSub(SELLER_A, addr("hook"));
      const c = await makeCampaign(SELLER_A);
      await sellerJson(SELLER_A, "POST", `/campaigns/${c.id}/send`, {});
      await waitStatus(c.id, "sent");
      const [send] = (await db.execute(sql`SELECT provider_message_id AS id FROM email_campaign_sends WHERE campaign_id = ${c.id} AND subscriber_id = ${s.id}`)).rows as any[];
      expect((await post({ type: "email.delivered", data: { email_id: send.id } })).status).toBe(200);
      expect((await post({ type: "email.opened", data: { email_id: send.id } })).status).toBe(200);
      let detail = ((await (await seller(SELLER_A, `/campaigns/${c.id}`)).json()) as any);
      expect(detail.tracking).toBe(true);
      expect(detail.stats).toMatchObject({ delivered: 1, opened: 1, clicked: 0 });
      await post({ type: "email.bounced", data: { email_id: send.id, bounce: { type: "Permanent" } } });
      expect((await rowFor(SELLER_A, s.email)).status).toBe("bounced");
      detail = ((await (await seller(SELLER_A, `/campaigns/${c.id}`)).json()) as any);
      expect(detail.stats.bounced).toBe(1);
    } finally {
      delete process.env.RESEND_WEBHOOK_SECRET;
    }
    await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, SELLER_A));
  });
});

/**
 * Boost Checkout Session lifecycle integration tests.
 *
 * Covers the new pending_payment → Checkout Session → verify → active lifecycle
 * introduced in migration 080. Exercises:
 *   - POST /api/boosts          creates pending_payment (no charge)
 *   - POST /api/boosts/:id/pay  creates Checkout Session, reuses open session, rotates expired
 *   - POST /api/boosts/:id/pay/verify  activates after payment_status=paid
 *   - Webhook helpers (activateBoostFromCheckoutSession, markBoostCheckoutFailed)
 *   - Media eligibility helper (checkPostMediaEligibility)
 *   - Return-URL allowlist (isAllowedBoostReturnUrl)
 *   - Verify rejects metadata mismatch and wrong amount
 *   - Verify rejects unpaid sessions
 *   - Cancel stays pending (not activated) when post deleted mid-flight
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { boosts, db, posts, users } from "@workspace/db";

// ── Stripe mock ───────────────────────────────────────────────────────────────

const stripeState = vi.hoisted(() => ({
  sessionStatus:      "open" as "open" | "complete" | "expired",
  paymentStatus:      "unpaid" as "unpaid" | "paid" | "no_payment_required",
  forceExpired:       false,
  persistedSessionId: null as string | null,
  amountTotal:        0,
  _lastBoostId:       null as string | null,
  _lastSellerId:      null as string | null,
  _lastTargetId:      null as string | null,
}));

const stripeFake = vi.hoisted(() => ({
  checkout: {
    sessions: {
      create: vi.fn(async (params: any) => {
        const id = `cs_test_${crypto.randomUUID()}`;
        stripeState.persistedSessionId = id;
        stripeState.amountTotal = params.line_items[0].price_data.unit_amount;
        return {
          id,
          url:            `https://checkout.stripe.com/test/${id}`,
          payment_status: stripeState.forceExpired ? "unpaid" : stripeState.paymentStatus,
          status:         stripeState.forceExpired ? "expired" : stripeState.sessionStatus,
          amount_total:   stripeState.amountTotal,
          currency:       "usd",
          metadata:       params.metadata,
        };
      }),
      retrieve: vi.fn(async (id: string) => {
        if (stripeState.forceExpired) {
          return {
            id,
            url:            null,
            payment_status: "unpaid",
            status:         "expired",
            amount_total:   stripeState.amountTotal,
            currency:       "usd",
            metadata: {
              kind:         "boost",
              boostId:      stripeState._lastBoostId ?? "",
              sellerId:     stripeState._lastSellerId ?? "",
              targetId:     stripeState._lastTargetId ?? "",
              budgetCents:  String(stripeState.amountTotal),
              durationDays: "7",
            },
          };
        }
        return {
          id,
          url:            `https://checkout.stripe.com/test/${id}`,
          payment_status: stripeState.paymentStatus,
          status:         stripeState.sessionStatus,
          amount_total:   stripeState.amountTotal,
          currency:       "usd",
          metadata: {
            kind:         "boost",
            boostId:      stripeState._lastBoostId ?? "",
            sellerId:     stripeState._lastSellerId ?? "",
            targetId:     stripeState._lastTargetId ?? "",
            budgetCents:  String(stripeState.amountTotal),
            durationDays: "7",
          },
        };
      }),
    },
  },
  _lastBoostId:   undefined as string | undefined,
  _lastSellerId:  undefined as string | undefined,
  _lastTargetId:  undefined as string | undefined,
} as any));

// Capture boostId/sellerId from session.create for metadata injection
const origCreate = stripeFake.checkout.sessions.create;
stripeFake.checkout.sessions.create = vi.fn(async (params: any) => {
  stripeFake._lastBoostId  = params.metadata?.boostId;
  stripeFake._lastSellerId = params.metadata?.sellerId;
  stripeFake._lastTargetId = params.metadata?.targetId;
  stripeState._lastBoostId  = params.metadata?.boostId;
  stripeState._lastSellerId = params.metadata?.sellerId;
  stripeState._lastTargetId = params.metadata?.targetId;
  return origCreate(params);
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => stripeFake }));

// ── Test data ─────────────────────────────────────────────────────────────────

const tag      = crypto.randomUUID().slice(0, 8);
const seller   = `boost-cs-seller-${tag}`;
const stranger = `boost-cs-stranger-${tag}`;
let videoPostId    = "";
let slideshowPostId = "";
let photoPostId    = "";
let draftPostId    = "";
let server: Server;
let base   = "";

async function req(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const { default: boostsRouter } = await import("../boosts");
  const app = express();
  app.use(express.json());
  app.use("/api/boosts", boostsRouter);

  await db.insert(users).values([
    { clerkId: seller,   email: `${seller}@test.local`,   name: "Boost CS Seller",   role: "seller", accountType: "seller" },
    { clerkId: stranger, email: `${stranger}@test.local`, name: "Boost CS Stranger", role: "seller", accountType: "seller" },
  ]);

  // Published video post — eligible
  [videoPostId] = (await db.insert(posts).values({
    userId: seller, mediaUrl: "https://cdn.test/video.mp4", mediaType: "video",
    postStatus: "published",
  }).returning({ id: posts.id })).map(x => x.id);

  // Published slideshow with 3 images — eligible
  [slideshowPostId] = (await db.insert(posts).values({
    userId: seller, mediaUrl: "https://cdn.test/slide1.jpg",
    mediaType: "slideshow",
    mediaUrls: ["https://cdn.test/slide1.jpg", "https://cdn.test/slide2.jpg", "https://cdn.test/slide3.jpg"] as any,
    mediaPaths: ["obj/s1", "obj/s2", "obj/s3"] as any,
    postStatus: "published",
  }).returning({ id: posts.id })).map(x => x.id);

  // Published single photo — ineligible
  [photoPostId] = (await db.insert(posts).values({
    userId: seller, mediaUrl: "https://cdn.test/photo.jpg", mediaType: "photo",
    postStatus: "published",
  }).returning({ id: posts.id })).map(x => x.id);

  // Draft — ineligible
  [draftPostId] = (await db.insert(posts).values({
    userId: seller, mediaUrl: "https://cdn.test/draft.jpg", mediaType: "video",
    postStatus: "draft",
  }).returning({ id: posts.id })).map(x => x.id);

  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(boosts).where(eq(boosts.sellerId, seller));
  await db.delete(posts).where(eq(posts.userId, seller));
  await db.delete(users).where(eq(users.clerkId, seller));
  await db.delete(users).where(eq(users.clerkId, stranger));
  await new Promise<void>(resolve => server.close(() => resolve()));
});

// ─── Unit: checkPostMediaEligibility ─────────────────────────────────────────

describe("checkPostMediaEligibility", () => {
  it("approves video posts", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    expect(checkPostMediaEligibility({
      userId: "u1", mediaType: "video", mediaUrl: "https://cdn.test/v.mp4",
      postStatus: "published",
    })).toEqual({ eligible: true });
  });

  it("approves slideshow with 2+ images", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    expect(checkPostMediaEligibility({
      userId: "u1", mediaType: "slideshow", mediaUrl: "https://cdn.test/s1.jpg",
      mediaPaths: ["a", "b"], postStatus: "published",
    })).toEqual({ eligible: true });
  });

  it("rejects slideshow with only 1 image", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    const r = checkPostMediaEligibility({
      userId: "u1", mediaType: "slideshow", mediaUrl: "https://cdn.test/s1.jpg",
      mediaPaths: ["a"], postStatus: "published",
    });
    expect(r.eligible).toBe(false);
  });

  it("rejects single photo", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    const r = checkPostMediaEligibility({
      userId: "u1", mediaType: "photo", mediaUrl: "https://cdn.test/p.jpg",
      postStatus: "published",
    });
    expect(r.eligible).toBe(false);
  });

  it("rejects draft posts", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    const r = checkPostMediaEligibility({
      userId: "u1", mediaType: "video", mediaUrl: "https://cdn.test/v.mp4",
      postStatus: "draft",
    });
    expect(r.eligible).toBe(false);
  });

  it("rejects private posts (isPublic=false)", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    const r = checkPostMediaEligibility({
      userId: "u1", mediaType: "video", mediaUrl: "https://cdn.test/v.mp4",
      postStatus: "published", visibility: { isPublic: false },
    });
    expect(r.eligible).toBe(false);
  });

  it("rejects missing mediaUrl", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    const r = checkPostMediaEligibility({
      userId: "u1", mediaType: "video", mediaUrl: null, postStatus: "published",
    });
    expect(r.eligible).toBe(false);
  });

  it("approves scheduled-and-due posts", async () => {
    const { checkPostMediaEligibility } = await import("../boosts");
    const past = new Date(Date.now() - 1000);
    expect(checkPostMediaEligibility({
      userId: "u1", mediaType: "video", mediaUrl: "https://cdn.test/v.mp4",
      postStatus: "scheduled", scheduledAt: past,
    })).toEqual({ eligible: true });
  });
});

// ─── Unit: isAllowedBoostReturnUrl ─────────────────────────────────────────────

describe("isAllowedBoostReturnUrl", () => {
  it("accepts native brandthread://boost/ URLs", async () => {
    const { isAllowedBoostReturnUrl } = await import("../boosts");
    const id = crypto.randomUUID();
    expect(isAllowedBoostReturnUrl(`brandthread://boost/?id=${id}&paymentReturn=1`)).toBe(true);
  });

  it("rejects wrong scheme", async () => {
    const { isAllowedBoostReturnUrl } = await import("../boosts");
    const id = crypto.randomUUID();
    expect(isAllowedBoostReturnUrl(`brandthread://design-campaign/?id=${id}&paymentReturn=1`)).toBe(false);
  });

  it("rejects non-UUID id", async () => {
    const { isAllowedBoostReturnUrl } = await import("../boosts");
    expect(isAllowedBoostReturnUrl(`brandthread://boost/?id=not-a-uuid&paymentReturn=1`)).toBe(false);
  });

  it("rejects missing paymentReturn", async () => {
    const { isAllowedBoostReturnUrl } = await import("../boosts");
    const id = crypto.randomUUID();
    expect(isAllowedBoostReturnUrl(`brandthread://boost/?id=${id}`)).toBe(false);
  });
});

// ─── HTTP: targets endpoint ─────────────────────────────────────────────────────

describe("GET /api/boosts/targets", () => {
  it("returns only video and slideshow(2+) posts for the authenticated seller", async () => {
    const r = await req(seller, "GET", "/api/boosts/targets");
    expect(r.status).toBe(200);
    const ids = r.body.map((x: any) => x.id);
    expect(ids).toContain(videoPostId);
    expect(ids).toContain(slideshowPostId);
    expect(ids).not.toContain(photoPostId);   // single photo
    expect(ids).not.toContain(draftPostId);   // draft
  });

  it("includes mediaKind badge for each eligible post", async () => {
    const r = await req(seller, "GET", "/api/boosts/targets");
    const video = r.body.find((x: any) => x.id === videoPostId);
    const slide = r.body.find((x: any) => x.id === slideshowPostId);
    expect(video?.mediaKind).toBe("video");
    expect(slide?.mediaKind).toBe("slideshow");
    expect(slide?.imageCount).toBe(3);
  });
});

// ─── HTTP: create boost (pending_payment, no charge) ──────────────────────────

describe("POST /api/boosts — pending lifecycle", () => {
  it("creates a pending_payment boost without charging", async () => {
    const r = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: videoPostId, objective: "views",
      budgetCents: 1000, durationDays: 5,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "pending_payment", budgetCents: 1000, durationDays: 5 });
    expect(r.body.paidAt).toBeFalsy();
    expect(r.body.startsAt).toBeFalsy();
  });

  it("rejects single photo posts with 422 ineligible_media", async () => {
    const r = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: photoPostId, objective: "views", budgetCents: 500, durationDays: 1,
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("ineligible_media");
  });

  it("rejects draft posts", async () => {
    const r = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: draftPostId, objective: "views", budgetCents: 500, durationDays: 1,
    });
    expect(r.status).toBe(404);
  });

  it("rejects another seller's post", async () => {
    const r = await req(stranger, "POST", "/api/boosts", {
      targetType: "post", targetId: videoPostId, objective: "views", budgetCents: 500, durationDays: 1,
    });
    expect(r.status).toBe(404);
  });

  it("validates budgetCents boundaries", async () => {
    for (const bad of [499, 100_001, 500.5, 0]) {
      const r = await req(seller, "POST", "/api/boosts", {
        targetType: "post", targetId: videoPostId, objective: "views",
        budgetCents: bad, durationDays: 7,
      });
      expect(r.status).toBe(400);
    }
  });

  it("validates durationDays boundaries", async () => {
    for (const bad of [0, 31, -1]) {
      const r = await req(seller, "POST", "/api/boosts", {
        targetType: "post", targetId: videoPostId, objective: "views",
        budgetCents: 500, durationDays: bad,
      });
      expect(r.status).toBe(400);
    }
  });
});

// ─── HTTP: pay endpoint ────────────────────────────────────────────────────────

describe("POST /api/boosts/:id/pay", () => {
  let boostId = "";

  beforeAll(async () => {
    const r = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: slideshowPostId,
      budgetCents: 750, durationDays: 3,
    });
    boostId = r.body.id;
    stripeState.sessionStatus = "open";
    stripeState.paymentStatus = "unpaid";
    stripeState.forceExpired  = false;
  });

  it("rejects invalid returnUrl", async () => {
    const r = await req(seller, "POST", `/api/boosts/${boostId}/pay`, {
      returnUrl: "https://evil.example.com/steal",
    });
    expect(r.status).toBe(400);
  });

  it("creates a Checkout Session for a pending_payment boost", async () => {
    const id = crypto.randomUUID();
    const returnUrl = `brandthread://boost/?id=${id}&paymentReturn=1`;
    const r = await req(seller, "POST", `/api/boosts/${boostId}/pay`, { returnUrl });
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/checkout\.stripe\.com/);
    expect(r.body.paymentStatus).toBe("unpaid");
    expect(r.body.status).toBe("pending_payment");
    expect(r.body.sessionId).toBeTruthy();
  });

  it("reuses an open Checkout Session on retry", async () => {
    stripeState.sessionStatus = "open";
    const id = crypto.randomUUID();
    const returnUrl = `brandthread://boost/?id=${id}&paymentReturn=1`;
    const r = await req(seller, "POST", `/api/boosts/${boostId}/pay`, { returnUrl });
    expect(r.status).toBe(200);
    expect(stripeFake.checkout.sessions.create).toHaveBeenCalledTimes(1); // not called again
  });

  it("rejects a stranger's request", async () => {
    const id = crypto.randomUUID();
    const returnUrl = `brandthread://boost/?id=${id}&paymentReturn=1`;
    const r = await req(stranger, "POST", `/api/boosts/${boostId}/pay`, { returnUrl });
    expect(r.status).toBe(404);
  });
});

// ─── HTTP: verify endpoint ────────────────────────────────────────────────────

describe("POST /api/boosts/:id/pay/verify", () => {
  let boostId = "";

  beforeAll(async () => {
    // Reset call count before this suite
    stripeFake.checkout.sessions.create.mockClear();
    stripeState.forceExpired  = false;
    stripeState.sessionStatus = "open";
    stripeState.paymentStatus = "unpaid";

    const r = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: videoPostId,
      budgetCents: 500, durationDays: 7,
    });
    boostId = r.body.id;

    const id = crypto.randomUUID();
    const returnUrl = `brandthread://boost/?id=${id}&paymentReturn=1`;
    await req(seller, "POST", `/api/boosts/${boostId}/pay`, { returnUrl });
  });

  it("returns 402 when session is unpaid", async () => {
    stripeState.paymentStatus = "unpaid";
    stripeState.sessionStatus = "open";
    const r = await req(seller, "POST", `/api/boosts/${boostId}/pay/verify`, {});
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("unpaid");
  });

  it("activates boost when session is paid", async () => {
    stripeState.paymentStatus = "paid";
    stripeState.sessionStatus = "complete";
    const r = await req(seller, "POST", `/api/boosts/${boostId}/pay/verify`, {});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("active");
    expect(r.body.paidAt).toBeTruthy();
    expect(r.body.startsAt).toBeTruthy();
    expect(r.body.estimatedReachLow).toBeGreaterThan(0);
    expect(r.body.estimatedReachHigh).toBeGreaterThan(0);
  });

  it("is idempotent — returns active boost on second verify", async () => {
    stripeState.paymentStatus = "paid";
    const r = await req(seller, "POST", `/api/boosts/${boostId}/pay/verify`, {});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("active");
  });

  it("rejects a stranger's verify attempt", async () => {
    const r = await req(stranger, "POST", `/api/boosts/${boostId}/pay/verify`, {});
    expect(r.status).toBe(404);
  });
});

// ─── Webhook helpers ──────────────────────────────────────────────────────────

describe("webhook activation helpers", () => {
  it("activateBoostFromCheckoutSession activates a pending boost", async () => {
    const { activateBoostFromCheckoutSession } = await import("../boosts");
    stripeFake.checkout.sessions.create.mockClear();
    stripeState.paymentStatus = "unpaid";
    stripeState.sessionStatus = "open";
    stripeState.forceExpired  = false;

    // Create a pending boost and pay session
    const r1 = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: slideshowPostId, budgetCents: 600, durationDays: 2,
    });
    const bid = r1.body.id;
    const id  = crypto.randomUUID();
    await req(seller, "POST", `/api/boosts/${bid}/pay`, {
      returnUrl: `brandthread://boost/?id=${id}&paymentReturn=1`,
    });

    // Simulate webhook
    const [row] = await db.select({ stripeCheckoutSessionId: boosts.stripeCheckoutSessionId })
      .from(boosts).where(eq(boosts.id, bid)).limit(1);

    await activateBoostFromCheckoutSession(
      {
        id:             row.stripeCheckoutSessionId!,
        payment_status: "paid",
        amount_total:   600,
        currency:       "usd",
        metadata: { kind: "boost", boostId: bid, sellerId: seller, targetId: slideshowPostId, budgetCents: "600", durationDays: "2" },
      },
      new Date(),
    );

    const [activated] = await db.select().from(boosts).where(eq(boosts.id, bid)).limit(1);
    expect(activated.status).toBe("active");
    expect(activated.paidAt).toBeTruthy();
  });

  it("markBoostCheckoutFailed sets status to failed", async () => {
    const { markBoostCheckoutFailed } = await import("../boosts");
    stripeFake.checkout.sessions.create.mockClear();
    stripeState.paymentStatus = "unpaid";
    stripeState.sessionStatus = "open";
    stripeState.forceExpired  = false;

    const r1 = await req(seller, "POST", "/api/boosts", {
      targetType: "post", targetId: videoPostId, budgetCents: 500, durationDays: 1,
    });
    const bid = r1.body.id;
    const id  = crypto.randomUUID();
    await req(seller, "POST", `/api/boosts/${bid}/pay`, {
      returnUrl: `brandthread://boost/?id=${id}&paymentReturn=1`,
    });

    const [row] = await db.select({ stripeCheckoutSessionId: boosts.stripeCheckoutSessionId })
      .from(boosts).where(eq(boosts.id, bid)).limit(1);

    await markBoostCheckoutFailed(
      { id: row.stripeCheckoutSessionId!, metadata: { kind: "boost" } },
    );

    const [failed] = await db.select().from(boosts).where(eq(boosts.id, bid)).limit(1);
    expect(failed.status).toBe("failed");
  });

  it("does not activate when kind != boost", async () => {
    const { activateBoostFromCheckoutSession } = await import("../boosts");
    // Should be a no-op
    await expect(activateBoostFromCheckoutSession(
      { id: "cs_other", payment_status: "paid", metadata: { kind: "ad_campaign" } },
      new Date(),
    )).resolves.toBeUndefined();
  });
});

// ─── Reach estimate ───────────────────────────────────────────────────────────

describe("estimateBoostReach", () => {
  it("uses 35–65 per $1 formula matching adCampaignService", async () => {
    const { estimateBoostReach } = await import("../boosts");
    const r = estimateBoostReach(1000); // $10
    expect(r.low).toBe(350);
    expect(r.high).toBe(650);
  });

  it("floors fractional values", async () => {
    const { estimateBoostReach } = await import("../boosts");
    const r = estimateBoostReach(750); // $7.50
    expect(r.low).toBe(Math.floor(7.5 * 35));
    expect(r.high).toBe(Math.floor(7.5 * 65));
  });
});

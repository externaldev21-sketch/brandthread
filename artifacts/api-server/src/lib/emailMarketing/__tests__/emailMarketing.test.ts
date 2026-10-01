import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashIp, newRawToken, signToken, verifyToken,
} from "../tokens";
import {
  isHttpsUrl, normalizeEmail, parseCampaignBody, parseCampaignInput, parseSettingsInput, parseSubscribeBody,
} from "../validation";
import { dedupeRecipients, isSendableStatus } from "../audience";
import { listUnsubscribeHeaders, planBatch, startOfUtcDay } from "../sender";
import { renderCampaign } from "../render";
import { verifySvixSignature } from "../../../routes/email-marketing-webhook";

const SECRET = "unit-test-secret-value";

describe("email validation", () => {
  it("normalizes valid addresses and rejects malformed ones", () => {
    expect(normalizeEmail("  Jane.Doe+shop@Example.COM ")).toBe("jane.doe+shop@example.com");
    for (const bad of ["", "nope", "a@b", "a@@b.com", "a b@c.com", "a..b@c.com", ".a@c.com", 42, null, "x".repeat(250) + "@a.com"]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("subscribe body flags the honeypot and rejects bad email", () => {
    expect(parseSubscribeBody({ email: "a@b.co" })).toEqual({ ok: true, value: { email: "a@b.co", honeypot: false } });
    expect(parseSubscribeBody({ email: "a@b.co", website: "http://spam" })).toMatchObject({ ok: true, value: { honeypot: true } });
    expect(parseSubscribeBody({ email: "bad" }).ok).toBe(false);
    expect(parseSubscribeBody(undefined).ok).toBe(false);
  });

  it("only accepts https links", () => {
    expect(isHttpsUrl("https://shop.example.com/a")).toBe(true);
    expect(isHttpsUrl("http://shop.example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://user:pw@x.com")).toBe(false);
  });

  it("campaign body enforces limits (3 products, https image and CTA)", () => {
    const id = () => crypto.randomUUID();
    expect(parseCampaignBody({ productIds: [id(), id(), id(), id()] }).ok).toBe(false);
    expect(parseCampaignBody({ productIds: ["not-a-uuid"] }).ok).toBe(false);
    expect(parseCampaignBody({ imageUrl: "http://x.com/a.png" }).ok).toBe(false);
    expect(parseCampaignBody({ cta: { label: "Shop", url: "javascript:x" } }).ok).toBe(false);
    expect(parseCampaignBody({ cta: { label: "", url: "https://x.com" } }).ok).toBe(false);
    const dup = id();
    const ok = parseCampaignBody({ headline: "Hi", productIds: [dup, dup], cta: { label: "Shop", url: "https://x.com" } });
    expect(ok).toMatchObject({ ok: true, value: { productIds: [dup] } });
  });

  it("subject cannot carry header-injection newlines and drafts may be incomplete", () => {
    const r = parseCampaignInput({ subject: "Hello\r\nBcc: evil@x.com", body: { headline: "x" } }, { requireComplete: true });
    expect(r.ok && r.value.subject).toBe("Hello Bcc: evil@x.com");
    expect(parseCampaignInput({}, { requireComplete: false }).ok).toBe(true);
    expect(parseCampaignInput({}, { requireComplete: true }).ok).toBe(false);
    expect(parseCampaignInput({ subject: "s", body: {} }, { requireComplete: true }).ok).toBe(false);
    expect(parseCampaignInput({ subject: "s", audience: "everyone", body: { text: "x" } }, { requireComplete: false }).ok).toBe(false);
  });

  it("settings validate reply-to", () => {
    expect(parseSettingsInput({ replyTo: "bad" }).ok).toBe(false);
    expect(parseSettingsInput({ fromName: "Acme", replyTo: "hi@acme.com", postalAddress: "1 Main St", doubleOptIn: true }))
      .toMatchObject({ ok: true, value: { fromName: "Acme", doubleOptIn: true } });
  });
});

describe("unsubscribe / confirm tokens", () => {
  it("round-trips a signed token", () => {
    const raw = newRawToken();
    const token = signToken("unsub", raw, SECRET);
    expect(verifyToken("unsub", token, SECRET)).toBe(raw);
  });

  it("rejects tampering, wrong purpose, wrong secret and junk", () => {
    const raw = newRawToken();
    const token = signToken("unsub", raw, SECRET);
    expect(verifyToken("unsub", `${newRawToken()}.${token.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifyToken("unsub", token.slice(0, -2) + "xx", SECRET)).toBeNull();
    expect(verifyToken("confirm", token, SECRET)).toBeNull();
    expect(verifyToken("unsub", token, "another-secret-value")).toBeNull();
    expect(verifyToken("unsub", "garbage", SECRET)).toBeNull();
    expect(verifyToken("unsub", undefined, SECRET)).toBeNull();
    expect(verifyToken("unsub", "a".repeat(500), SECRET)).toBeNull();
  });

  it("generates unique raw tokens and never stores the raw IP", () => {
    expect(newRawToken()).not.toBe(newRawToken());
    const h = hashIp("203.0.113.9", SECRET);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(hashIp(undefined, SECRET)).toBeNull();
  });
});

describe("audience helpers", () => {
  it("only fully consented rows are sendable", () => {
    expect(isSendableStatus("subscribed")).toBe(true);
    for (const s of ["pending", "unsubscribed", "bounced", "complained", "", null, undefined]) expect(isSendableStatus(s as any)).toBe(false);
  });

  it("dedupes recipients case-insensitively", () => {
    const out = dedupeRecipients([
      { subscriberId: "1", email: "A@x.com" }, { subscriberId: "2", email: "a@x.com" }, { subscriberId: "3", email: "b@x.com" },
    ]);
    expect(out.map((r) => r.subscriberId)).toEqual(["1", "3"]);
  });
});

describe("batching and daily cap", () => {
  it("never exceeds the batch size, the queue or the remaining daily allowance", () => {
    expect(planBatch({ cap: 1000, sentToday: 0, queued: 500, batchSize: 50 })).toBe(50);
    expect(planBatch({ cap: 1000, sentToday: 980, queued: 500, batchSize: 50 })).toBe(20);
    expect(planBatch({ cap: 1000, sentToday: 1000, queued: 500, batchSize: 50 })).toBe(0);
    expect(planBatch({ cap: 1000, sentToday: 1200, queued: 5, batchSize: 50 })).toBe(0);
    expect(planBatch({ cap: 1000, sentToday: 0, queued: 7, batchSize: 50 })).toBe(7);
  });

  it("the cap window starts at 00:00 UTC", () => {
    expect(startOfUtcDay(new Date("2026-03-04T23:59:59Z")).toISOString()).toBe("2026-03-04T00:00:00.000Z");
  });
});

describe("rendering and compliance headers", () => {
  it("emits RFC 8058 one-click List-Unsubscribe headers", () => {
    const h = listUnsubscribeHeaders("https://x.test/u/abc");
    expect(h["List-Unsubscribe"]).toBe("<https://x.test/u/abc>");
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("escapes seller text and includes unsubscribe link + postal address in html and text", () => {
    const { html, text } = renderCampaign({
      storeName: "Acme <b>", subject: "s", preheader: "p",
      body: { headline: "<script>x</script>", text: "line1\n\nline2", imageUrl: null, productIds: [], cta: { label: "Shop", url: "https://x.com/?a=1&b=2" } },
      products: [{ id: "1", name: "Tee", imageUrl: null, priceCents: 2500 }],
      storeUrl: null, postalAddress: "1 Main St, NYC", unsubscribeUrl: "https://x.test/unsub/tok",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("https://x.test/unsub/tok");
    expect(html).toContain("1 Main St, NYC");
    expect(html).toContain("$25.00");
    expect(text).toContain("Unsubscribe: https://x.test/unsub/tok");
  });
});

describe("resend webhook signature", () => {
  const key = crypto.randomBytes(24);
  const secret = `whsec_${key.toString("base64")}`;
  const sign = (id: string, ts: string, body: string) =>
    `v1,${crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;

  it("accepts a valid signature and rejects tampered, stale or missing ones", () => {
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const body = '{"type":"email.opened"}';
    const base = { secret, id: "msg_1", timestamp: ts, body, nowMs: now };
    expect(verifySvixSignature({ ...base, signatureHeader: sign("msg_1", ts, body) })).toBe(true);
    expect(verifySvixSignature({ ...base, signatureHeader: sign("msg_1", ts, body + " ") })).toBe(false);
    expect(verifySvixSignature({ ...base, signatureHeader: "" })).toBe(false);
    expect(verifySvixSignature({ ...base, nowMs: now + 10 * 60_000, signatureHeader: sign("msg_1", ts, body) })).toBe(false);
  });
});

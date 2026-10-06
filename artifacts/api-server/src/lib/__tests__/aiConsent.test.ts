import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "user_1" as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: auth.userId }) }));
vi.mock("@workspace/db", () => ({ db: {}, aiDataConsents: {} }));

import {
  AI_CONSENT_REQUIRED, AI_CONSENT_VERSION, consentIsCurrent, makeAiConsentGate, requiresAiConsent,
} from "../aiConsent";

function run(gate: ReturnType<typeof makeAiConsentGate>, method: string, path: string) {
  const res: any = { statusCode: 200, body: null };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  const next = vi.fn();
  return gate({ method, path, log: { error: vi.fn() } } as any, res, next).then(() => ({ res, next }));
}

describe("AI data consent (QA-0043)", () => {
  it("covers every AI tool that sends user content, and nothing else", () => {
    for (const p of ["/bg-removal/remove", "/photography/generate", "/mockup/generate", "/ai/chat", "/ai/chat/stream",
      "/brandthread-agent/message", "/store/ai/generate", "/support-chat/message", "/lifestyle/generate"]) {
      expect(requiresAiConsent("POST", p)).toBe(true);
    }
    for (const p of ["/products", "/support-chat/escalate", "/ai/credits", "/orders/1"]) {
      expect(requiresAiConsent("POST", p)).toBe(false);
    }
    expect(requiresAiConsent("GET", "/ai/chat")).toBe(false);
  });

  it("refuses an AI call until the person has allowed it", async () => {
    auth.userId = "user_1";
    const { res, next } = await run(makeAiConsentGate(async () => false), "POST", "/bg-removal/remove");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: AI_CONSENT_REQUIRED, providers: ["OpenAI", "fal.ai", "FASHN"] });
  });

  it("lets the call through once allowed", async () => {
    const { next } = await run(makeAiConsentGate(async () => true), "POST", "/bg-removal/remove");
    expect(next).toHaveBeenCalled();
  });

  it("fails closed if consent cannot be read", async () => {
    const { res, next } = await run(makeAiConsentGate(async () => { throw new Error("db down"); }), "POST", "/ai/chat");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("ignores non-AI routes and signed-out requests (their own auth answers)", async () => {
    const lookup = vi.fn(async () => false);
    expect((await run(makeAiConsentGate(lookup), "POST", "/products")).next).toHaveBeenCalled();
    auth.userId = null;
    expect((await run(makeAiConsentGate(lookup), "POST", "/ai/chat")).next).toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    auth.userId = "user_1";
  });

  it("asks again when the disclosure version changes or consent was withdrawn", () => {
    expect(consentIsCurrent({ version: AI_CONSENT_VERSION, grantedAt: new Date() })).toBe(true);
    expect(consentIsCurrent({ version: "2020-01-01", grantedAt: new Date() })).toBe(false);
    expect(consentIsCurrent({ version: AI_CONSENT_VERSION, grantedAt: null })).toBe(false);
    expect(consentIsCurrent(null)).toBe(false);
  });
});

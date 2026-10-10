/**
 * BT-372: no user message reaches OpenAI before AI data-sharing consent.
 * Pure/unit tests (no database): the guard itself, the consent payload, the
 * real brandthread-agent router answering 428 without calling OpenAI, and
 * static checks on mount order and the onboarding welcome hook.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => ({ consent: false, openaiCalls: 0, moderationCalls: 0 }));

// No real database: any query from the agent route would throw, proving the
// guard answered before the handler touched the DB or OpenAI.
vi.mock("@workspace/db", () => {
  const table = () => new Proxy({}, { get: (_t, key) => String(key) });
  const boom = () => { throw new Error("db must not be reached without consent"); };
  return {
    db: { select: boom, insert: boom, update: boom, delete: boom, execute: boom },
    users: table(), conversations: table(), conversationParticipants: table(),
    messages: table(), agentConversations: table(),
  };
});
vi.mock("../../lib/aiConsent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/aiConsent")>();
  return { ...actual, hasAiConsent: async () => state.consent };
});
vi.mock("../requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "consent-test-user"; next(); },
}));
vi.mock("../rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: async () => { state.openaiCalls++; return { choices: [{ message: { content: "hi" } }] }; } } },
    moderations: { create: async () => { state.moderationCalls++; return { results: [] }; } },
  },
}));

import { requireAiConsent } from "../requireAiConsent";
import { consentPayload } from "../../routes/ai-consent";
import { hasConsentTimestamp, isConsentGatedMethod, AI_CONSENT_REQUIRED_CODE } from "../../lib/aiConsent";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../..");

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

async function run(mw: ReturnType<typeof requireAiConsent>, req: any) {
  const res = fakeRes();
  const next = vi.fn();
  await mw(req, res, next);
  return { res, next };
}

describe("requireAiConsent", () => {
  it("answers 428 AI_CONSENT_REQUIRED for a signed-in POST without consent", async () => {
    const mw = requireAiConsent({ getUserId: () => "u1", hasConsent: async () => false });
    const { res, next } = await run(mw, { method: "POST" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(428);
    expect(res.body).toMatchObject({ code: AI_CONSENT_REQUIRED_CODE, provider: "OpenAI" });
  });

  it("lets a consented user through", async () => {
    const mw = requireAiConsent({ getUserId: () => "u1", hasConsent: async () => true });
    const { res, next } = await run(mw, { method: "POST" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("fails closed (503) when consent cannot be read", async () => {
    const mw = requireAiConsent({ getUserId: () => "u1", hasConsent: async () => { throw new Error("db down"); } });
    const { res, next } = await run(mw, { method: "POST" });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("passes reads and signed-out requests through without a lookup", async () => {
    const hasConsent = vi.fn(async () => false);
    const get = await run(requireAiConsent({ getUserId: () => "u1", hasConsent }), { method: "GET" });
    expect(get.next).toHaveBeenCalledOnce();
    const anon = await run(requireAiConsent({ getUserId: () => null, hasConsent }), { method: "POST" });
    expect(anon.next).toHaveBeenCalledOnce();
    expect(hasConsent).not.toHaveBeenCalled();
  });

  it("looks consent up only once per request when mounted twice", async () => {
    const hasConsent = vi.fn(async () => true);
    const mw = requireAiConsent({ getUserId: () => "u1", hasConsent });
    const req = { method: "POST" };
    await run(mw, req);
    await run(mw, req);
    expect(hasConsent).toHaveBeenCalledTimes(1);
  });
});

describe("consent helpers", () => {
  it("gates only write methods", () => {
    expect(["POST", "put", "PATCH"].every(isConsentGatedMethod)).toBe(true);
    expect(["GET", "HEAD", "OPTIONS", "DELETE", undefined].some((m) => isConsentGatedMethod(m))).toBe(false);
  });
  it("treats only a real timestamp as consent", () => {
    expect(hasConsentTimestamp(null)).toBe(false);
    expect(hasConsentTimestamp(undefined)).toBe(false);
    expect(hasConsentTimestamp("not a date")).toBe(false);
    expect(hasConsentTimestamp(new Date())).toBe(true);
    expect(hasConsentTimestamp("2026-10-10T00:00:00.000Z")).toBe(true);
  });
  it("builds the GET/POST payload", () => {
    expect(consentPayload(null)).toEqual({ consented: false, consentedAt: null, provider: "OpenAI" });
    const at = new Date("2026-10-10T12:00:00.000Z");
    expect(consentPayload(at)).toEqual({ consented: true, consentedAt: at.toISOString(), provider: "OpenAI" });
  });
});

describe("POST /api/brandthread-agent/message without consent", () => {
  let server: Server | undefined;
  let baseUrl = "";

  beforeEach(async () => {
    state.openaiCalls = 0;
    state.moderationCalls = 0;
    if (server) return;
    const { default: agentRouter } = await import("../../routes/brandthread-agent");
    const app = express();
    app.use(express.json());
    app.use("/api/brandthread-agent", agentRouter);
    server = app.listen(0);
    await new Promise<void>((r) => server!.once("listening", () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("refuses with 428 and never calls OpenAI", async () => {
    state.consent = false;
    const res = await fetch(`${baseUrl}/api/brandthread-agent/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "c1", text: "hello" }),
    });
    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ code: AI_CONSENT_REQUIRED_CODE });
    expect(state.openaiCalls).toBe(0);
    expect(state.moderationCalls).toBe(0);
  });
});

describe("static wiring", () => {
  it("mounts requireAiConsent before aiSafetyGuard on /brandthread-agent", () => {
    const index = fs.readFileSync(path.join(srcDir, "routes/index.ts"), "utf8");
    const line = index.split("\n").find((l) => l.includes('router.use("/brandthread-agent"'));
    expect(line).toBeDefined();
    const consentAt = line!.indexOf("requireAiConsent(");
    const safetyAt = line!.indexOf("aiSafetyGuard(");
    expect(consentAt).toBeGreaterThan(-1);
    expect(consentAt).toBeLessThan(safetyAt);
    expect(index).toMatch(/router\.use\("\/ai-consent",\s+aiConsentRouter\)/);
  });

  it("guards the /message route inside the agent router too", () => {
    const route = fs.readFileSync(path.join(srcDir, "routes/brandthread-agent.ts"), "utf8");
    const line = route.split("\n").find((l) => l.startsWith('router.post("/message"'));
    expect(line).toContain("requireAiConsent()");
    expect(line!.indexOf("requireAiConsent()")).toBeLessThan(line!.indexOf("async"));
  });

  it("the onboarding welcome hook sends nothing to OpenAI", () => {
    const lib = fs.readFileSync(path.join(srcDir, "lib/brandthreadAgent.ts"), "utf8");
    expect(lib).not.toMatch(/from\s+["'][^"']*openai[^"']*["']/i);
    expect(lib).not.toMatch(/chat\.completions|responses\.create/);
  });
});

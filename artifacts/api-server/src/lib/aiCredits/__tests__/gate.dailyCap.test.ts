/**
 * The per-user daily generation ceiling answers with code "user_daily_cap", the
 * code the app's classifier (mobile lib/aiCreditsError.ts) turns into
 * "You have reached today's AI limit. It resets tomorrow." — so tools like
 * Remove Background stop telling a capped seller to "wait a minute".
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "user_capped" }) }));
vi.mock("../ledger", () => ({
  allowTextRequest: async () => true,
  meterRequest: async () => ({ ok: false, reason: "rate_limited" }),
  debitCredits: async () => ({ ok: false, reason: "rate_limited", balance: 500 }),
  refundDebit: async () => {},
}));
vi.mock("../lowPriority", () => ({ acquireLowPrioritySlot: async () => () => {} }));

import { aiCreditsGate } from "../gate";

function run(path: string) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  const next = vi.fn();
  return aiCreditsGate({ method: "POST", path, body: {} } as any, res, next).then(() => ({ res, next }));
}

describe("AI credits gate: daily generation cap", () => {
  it("tells a capped seller the limit resets tomorrow, with the user_daily_cap code", async () => {
    const { res, next } = await run("/bg-removal/remove");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "You have reached today's AI limit. It resets tomorrow.", code: "user_daily_cap" });
  });

  it("keeps the silent, generic message for free metered tools", async () => {
    const { res } = await run("/support-chat/message");
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "Too many requests, try again later" });
  });
});

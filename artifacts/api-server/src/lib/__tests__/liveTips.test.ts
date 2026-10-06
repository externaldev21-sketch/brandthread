import { describe, expect, it, vi } from "vitest";
import { LIVE_TIPS_DISABLED_CODE, LIVE_TIPS_FLAG, liveTipsGate } from "../liveTips";

function run(check: () => Promise<boolean>) {
  const res: any = { statusCode: 200, body: undefined as any };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  const next = vi.fn();
  return Promise.resolve(liveTipsGate(check)({} as any, res, next)).then(() => ({ res, next }));
}

describe("live_tips gate", () => {
  it("uses the live_tips flag key", () => {
    expect(LIVE_TIPS_FLAG).toBe("live_tips");
  });

  it("rejects gifts with LIVE_TIPS_DISABLED when the flag is OFF", async () => {
    const { res, next } = await run(async () => false);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe(LIVE_TIPS_DISABLED_CODE);
  });

  it("lets the request through when the flag is ON", async () => {
    const { res, next } = await run(async () => true);
    expect(next).toHaveBeenCalledOnce();
    expect(res.body).toBeUndefined();
  });

  it("fails closed when the flag lookup throws", async () => {
    const { res, next } = await run(async () => { throw new Error("db down"); });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe(LIVE_TIPS_DISABLED_CODE);
  });
});

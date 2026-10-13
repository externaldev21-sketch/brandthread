import { describe, expect, it, vi } from "vitest";

const gate = require("./release-gate.js") as {
  ROLLOUT_STEPS: number[];
  parseArgs: (argv: string[]) => { options: Record<string, any>; errors: string[] };
  nextRolloutStep: (current: number | null) => number | null;
  evaluateGate: (t: { crashFreeRate: number | null; sessions: number }, o?: { target?: number; minSessions?: number }) => { status: string; percent?: number };
  sessionsUrl: (o: { org: string; project: string; release: string; period: string }) => string;
  readSessionTotals: (body: unknown) => { crashFreeRate: number | null; sessions: number };
  fetchSessionTotals: (o: { release: string; period: string }, env: Record<string, string>, f: typeof fetch) => Promise<{ crashFreeRate: number | null; sessions: number }>;
};

describe("staged rollout", () => {
  it("goes 10% → 50% → 100%", () => {
    expect(gate.ROLLOUT_STEPS).toEqual([10, 50, 100]);
    expect(gate.nextRolloutStep(null)).toBe(10);
    expect(gate.nextRolloutStep(10)).toBe(50);
    expect(gate.nextRolloutStep(50)).toBe(100);
    expect(gate.nextRolloutStep(100)).toBeNull();
  });
});

describe("crash-free gate", () => {
  it("passes at or above 99.8% with enough sessions", () => {
    expect(gate.evaluateGate({ crashFreeRate: 0.998, sessions: 600 })).toMatchObject({ status: "pass", percent: 99.8 });
    expect(gate.evaluateGate({ crashFreeRate: 0.9995, sessions: 5000 }).status).toBe("pass");
  });

  it("fails below 99.8%", () => {
    expect(gate.evaluateGate({ crashFreeRate: 0.9979, sessions: 5000 })).toMatchObject({ status: "fail", percent: 99.79 });
  });

  it("waits until there are enough sessions to judge", () => {
    expect(gate.evaluateGate({ crashFreeRate: 1, sessions: 120 }).status).toBe("wait");
    expect(gate.evaluateGate({ crashFreeRate: null, sessions: 900 }).status).toBe("wait");
    expect(gate.evaluateGate({ crashFreeRate: 0.999, sessions: 50 }, { minSessions: 40 }).status).toBe("pass");
  });
});

describe("arguments", () => {
  it("requires a release and sensible values", () => {
    expect(gate.parseArgs([]).errors.join(" ")).toMatch(/--release is required/);
    expect(gate.parseArgs(["--release", "r", "--period", "soon"]).errors.join(" ")).toMatch(/--period/);
    expect(gate.parseArgs(["--release", "r"]).errors).toEqual([]);
  });

  it("only advances with a group and a current step of 10 or 50", () => {
    expect(gate.parseArgs(["--release", "r", "--advance"]).errors.join(" ")).toMatch(/--group/);
    expect(gate.parseArgs(["--release", "r", "--advance", "--group", "g", "--current", "100"]).errors.join(" ")).toMatch(/--current 10 or 50/);
    expect(gate.parseArgs(["--release", "r", "--advance", "--group", "g", "--current", "10"]).errors).toEqual([]);
  });
});

describe("Sentry sessions API", () => {
  it("asks for crash-free rate and session count for one release", () => {
    const url = new URL(gate.sessionsUrl({ org: "brandthread", project: "123", release: "app@1.0.0+42", period: "24h" }));
    expect(url.pathname).toBe("/api/0/organizations/brandthread/sessions/");
    expect(url.searchParams.getAll("field")).toEqual(["crash_free_rate(session)", "sum(session)"]);
    expect(url.searchParams.get("query")).toBe('release:"app@1.0.0+42"');
    expect(url.searchParams.get("project")).toBe("123");
  });

  it("reads the totals and tolerates an empty response", () => {
    expect(gate.readSessionTotals({ groups: [{ totals: { "crash_free_rate(session)": 0.9991, "sum(session)": 812 } }] }))
      .toEqual({ crashFreeRate: 0.9991, sessions: 812 });
    expect(gate.readSessionTotals({ groups: [] })).toEqual({ crashFreeRate: null, sessions: 0 });
  });

  it("needs the numeric project ID and sends the token as a bearer header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ groups: [{ totals: { "crash_free_rate(session)": 1, "sum(session)": 10 } }] })));
    const env = { SENTRY_AUTH_TOKEN: "tok", SENTRY_ORG: "bt", SENTRY_PROJECT: "brandthread-mobile" };
    await expect(gate.fetchSessionTotals({ release: "r", period: "24h" }, env, fetchMock as unknown as typeof fetch)).rejects.toThrow(/SENTRY_PROJECT_ID/);
    await gate.fetchSessionTotals({ release: "r", period: "24h" }, { ...env, SENTRY_PROJECT_ID: "4501" }, fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("project")).toBe("4501");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

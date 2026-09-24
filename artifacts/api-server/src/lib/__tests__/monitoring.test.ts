import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  flushMonitoring,
  initMonitoring,
  isMonitoringEnabled,
  reportLoggedError,
  resolveDsn,
  shouldReportLog,
  tagsFor,
} from "../monitoring";

// Built from parts so the literal values never appear in this file's source:
// Sentry attaches nearby source lines to stack frames, which would otherwise
// make the "nothing personal is sent" assertions pass or fail for the wrong reason.
const SECRET_USER_ID = ["user", "secret", "123"].join("_");
const SECRET_EMAIL = ["someone", "example.com"].join("@");
const EXPECTED_404 = ["expected", "client", "error"].join(" ");
const WARNING_ONLY = ["only", "a", "warning"].join(" ");

describe("resolveDsn", () => {
  it("treats missing, empty and placeholder values as disabled", () => {
    for (const value of [undefined, "", "  ", "REPLACE_WITH_SENTRY_DSN", "your-dsn", "<dsn>", "$SENTRY_DSN", "not a url"]) {
      expect(resolveDsn(value)).toBeNull();
    }
  });

  it("accepts a real DSN", () => {
    expect(resolveDsn("https://abc@o1.ingest.sentry.io/42")).toBe("https://abc@o1.ingest.sentry.io/42");
  });
});

describe("shouldReportLog", () => {
  const err = new Error("boom");
  it("reports error and fatal lines that carry an Error", () => {
    expect(shouldReportLog(50, { err })).toBe(true);
    expect(shouldReportLog(60, { error: err })).toBe(true);
    expect(shouldReportLog(50, { err, status: 500 })).toBe(true);
  });

  it("skips warnings, lines without an Error and expected client errors", () => {
    expect(shouldReportLog(40, { err })).toBe(false);
    expect(shouldReportLog(50, "plain message")).toBe(false);
    expect(shouldReportLog(50, { err: "not an error" })).toBe(false);
    expect(shouldReportLog(50, { err, status: 404 })).toBe(false);
  });
});

describe("tagsFor", () => {
  it("keeps only non-personal tags and strips query strings", () => {
    const tags = tagsFor(
      { err: new Error("x"), job: "computeTrending", errorCode: "INTERNAL_ERROR", status: 500, clerkId: "user_123" },
      { req: { id: 7, method: "POST", url: "/api/v1/orders?token=secret" } },
    );
    expect(tags).toEqual({
      job: "computeTrending",
      errorCode: "INTERNAL_ERROR",
      status: "500",
      request_id: "7",
      method: "POST",
      path: "/api/v1/orders",
    });
  });
});

describe("when SENTRY_DSN is not set", () => {
  it("stays disabled and reporting is a no-op", () => {
    expect(initMonitoring({ SENTRY_DSN: "" })).toBe(false);
    expect(isMonitoringEnabled()).toBe(false);
    expect(() => reportLoggedError(50, [{ err: new Error("ignored") }], {})).not.toThrow();
  });
});

describe("end to end against a fake Sentry endpoint", () => {
  let server: Server;
  const envelopes: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        envelopes.push((req.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    expect(initMonitoring({ SENTRY_DSN: `http://publickey@127.0.0.1:${port}/1`, NODE_ENV: "test" })).toBe(true);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends logged server errors with safe tags and nothing personal", async () => {
    const logger = pino(
      {
        level: "info",
        hooks: {
          logMethod(args, method, level) {
            reportLoggedError(level, args, this.bindings());
            return method.apply(this, args);
          },
        },
      },
      { write: () => undefined },
    );
    const reqLog = logger.child({ req: { id: "req-1", method: "GET", url: `/api/buyer/orders?email=${SECRET_EMAIL}` } });

    reqLog.error({ err: new Error("database exploded"), clerkId: SECRET_USER_ID }, "Failed to fetch buyer orders");
    reqLog.error({ err: new Error(EXPECTED_404), status: 404, errorCode: "NOT_FOUND" }, "API request failed");
    reqLog.warn({ err: new Error(WARNING_ONLY) }, "warned");
    await flushMonitoring();

    const all = envelopes.join("\n");
    expect(all).toContain("database exploded");
    expect(all).toContain('"path":"/api/buyer/orders"');
    expect(all).toContain('"request_id":"req-1"');
    expect(all).not.toContain(SECRET_USER_ID);
    expect(all).not.toContain(SECRET_EMAIL);
    expect(all).not.toContain(EXPECTED_404);
    expect(all).not.toContain(WARNING_ONLY);
  });
});

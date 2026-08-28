import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ApiError } from "../../lib/apiError";
import {
  apiErrorHandler,
  jsonNotFound,
  normalizeErrorResponses,
} from "../errorHandling";

let server: Server;
let base = "";
const logError = vi.fn();

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.id = "request-test-123";
    req.log = { error: logError } as unknown as typeof req.log;
    next();
  });
  app.use(normalizeErrorResponses);
  app.use(express.json({ limit: "64b" }));
  app.post("/payload", (_req, res) => res.json({ ok: true }));
  app.get("/validation", (_req, res) =>
    res.status(400).json({ error: "email is required", field: "email" }),
  );
  app.get("/authorization", (_req, res) =>
    res.status(403).json({
      error: "Insufficient role",
      code: "ROLE_REQUIRED",
      requiredRole: "owner",
      currentRole: "staff",
    }),
  );
  app.get("/provider", (_req, res) =>
    res.status(502).json({
      error: "Stripe secret payload",
      providerResponse: { token: "must-not-leak" },
    }),
  );
  app.get("/known", () => {
    throw new ApiError(409, "ALREADY_EXISTS", "This resource already exists.", {
      field: "name",
    });
  });
  app.get("/unexpected", async () => {
    throw new Error("select * from private_table password=secret");
  });
  app.use(jsonNotFound);
  app.use(apiErrorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("API error handling", () => {
  it("normalizes validation details", async () => {
    const response = await fetch(`${base}/validation`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "email is required",
        details: { field: "email" },
      },
      requestId: "request-test-123",
    });
  });

  it("preserves safe authorization metadata in details", async () => {
    const response = await fetch(`${base}/authorization`);
    expect(await response.json()).toEqual({
      error: {
        code: "ROLE_REQUIRED",
        message: "Insufficient role",
        details: { requiredRole: "owner", currentRole: "staff" },
      },
      requestId: "request-test-123",
    });
  });

  it("sanitizes provider failures", async () => {
    const response = await fetch(`${base}/provider`);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "An external service is currently unavailable.",
      },
      requestId: "request-test-123",
    });
    expect(JSON.stringify(body)).not.toContain("Stripe");
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("handles typed conflicts and rejected async handlers", async () => {
    const known = await fetch(`${base}/known`);
    expect(known.status).toBe(409);
    expect(await known.json()).toMatchObject({
      error: {
        code: "ALREADY_EXISTS",
        details: { field: "name" },
      },
    });

    const unexpected = await fetch(`${base}/unexpected`);
    expect(unexpected.status).toBe(500);
    const body = await unexpected.json() as {
      error: { code: string; message: string };
      requestId: string;
    };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("private_table");
    expect(logError).toHaveBeenCalled();
  });

  it("returns JSON for unknown routes", async () => {
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
      requestId: "request-test-123",
    });
  });

  it("preserves the 413 contract for oversized parser bodies", async () => {
    const response = await fetch(`${base}/payload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(256) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request is too large.",
      },
      requestId: "request-test-123",
    });
  });
});
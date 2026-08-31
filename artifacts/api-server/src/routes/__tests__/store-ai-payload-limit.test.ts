import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  clerkMiddlewareCalls: 0,
  authCalls: 0,
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    state.clerkMiddlewareCalls++;
    next();
  },
  getAuth: () => {
    state.authCalls++;
    return { userId: null };
  },
  clerkClient: {},
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: () => "test-publishable-key",
}));

import app from "../../app";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  state.clerkMiddlewareCalls = 0;
  state.authCalls = 0;
});

describe("store AI visual import payload limits", () => {
  it.each([
    {
      route: "/api/store/ai/from-social",
      payload: { socialUrl: "https://example.com/brand", base64List: ["x"] },
    },
    {
      route: "/api/store/ai/from-logo",
      payload: { base64: "x" },
    },
    {
      route: "/api/store/ai/from-moodboard",
      payload: { base64List: ["x"] },
    },
  ])("rejects oversized JSON for $route before authentication", async ({ route, payload }) => {
    const oversizedPayload = {
      ...payload,
      oversizedReference: "x".repeat(10 * 1024 * 1024),
    };

    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(oversizedPayload),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request is too large.",
      },
      requestId: expect.any(String),
    });
    expect(state.clerkMiddlewareCalls).toBe(0);
    expect(state.authCalls).toBe(0);
  });

  it("allows a small visual import request to continue through parsing", async () => {
    const response = await fetch(`${baseUrl}/api/store/ai/from-logo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base64: "small-image" }),
    });

    expect(response.status).toBe(401);
    expect(state.clerkMiddlewareCalls).toBe(1);
    expect(state.authCalls).toBeGreaterThan(0);
  });
});
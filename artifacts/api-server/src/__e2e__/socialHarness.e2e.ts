/**
 * Social E2E UI harness — the REAL api-server app (every router, real
 * Postgres) with only Clerk swapped for a test identity, kept alive so a
 * browser (Playwright, artifacts/mobile/e2e/social-*.spec.ts) can drive the
 * Expo web build as two real accounts: a buyer and a seller.
 *
 * Identity: `Authorization: Bearer e2e:<clerkId>` (what the Playwright Clerk
 * stub's getToken() returns) or `x-test-user-id: <clerkId>`.
 *
 * Run (test database only — never a real one):
 *   cd artifacts/api-server
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/brandthread_test \
 *     npx vitest run --config vitest.harness.config.ts
 * Stop: touch $SOCIAL_E2E_STOP_FILE (default /tmp/social-e2e.stop).
 * Seeded rows use @example.test emails, so the suite's purge sweeps them.
 */
import { afterAll, describe, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";

export const E2E_BUYER = "e2e_social_buyer";
export const E2E_SELLER = "e2e_social_seller";
const PORT = Number(process.env.SOCIAL_E2E_PORT ?? 5055);
const STOP_FILE = process.env.SOCIAL_E2E_STOP_FILE ?? "/tmp/social-e2e.stop";

function identityFrom(req: any): string | null {
  const header = req.headers?.["x-test-user-id"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers?.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer e2e:")) return auth.slice("Bearer e2e:".length);
  return null;
}

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    getAuth: (req: any) => {
      const userId = identityFrom(req);
      return { userId, sessionId: userId ? `sess_${userId}` : null, getToken: async () => null, has: () => false };
    },
  };
});
vi.mock("../lib/webOrigin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/webOrigin")>();
  return { ...actual, isAllowedWebOrigin: () => true };
});
vi.mock("../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push")>();
  return { ...actual, sendPushToUser: vi.fn(async () => {}) };
});

let server: Server | undefined;

describe("social e2e harness", () => {
  it("serves the real API until stopped", async () => {
    const { seedSocialE2e } = await import("./socialSeed");
    await seedSocialE2e({ buyer: E2E_BUYER, seller: E2E_SELLER, mediaBase: `http://127.0.0.1:${PORT}/e2e-media` });
    const { default: app } = await import("../app");
    const outer = express();
    const mediaDir = path.resolve(__dirname, "../../../mobile/assets/videos");
    outer.use("/e2e-media", express.static(mediaDir, { setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin") }));
    outer.use(app);
    try { fs.unlinkSync(STOP_FILE); } catch { /* not present */ }
    server = outer.listen(PORT, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    // Realtime channel, if this branch has it — same e2e token scheme.
    const userHub = await import("../ws/userHub").catch(() => null);
    userHub?.attachUserWebSocket(server, {
      verifyToken: async (token) => (token && token.startsWith("e2e:") ? token.slice(4) : null),
    });
    // eslint-disable-next-line no-console
    console.log(`[social-e2e] API on http://127.0.0.1:${PORT} — buyer=${E2E_BUYER} seller=${E2E_SELLER}`);
    while (!fs.existsSync(STOP_FILE)) await new Promise((r) => setTimeout(r, 500));
  }, 6 * 60 * 60 * 1000);
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

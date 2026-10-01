/**
 * LOAD-TEST ONLY. esbuild aliases `@clerk/express` to this file in
 * loadtest/build.mjs so the real API can be driven by k6 without a Clerk
 * instance. It is never imported by src/ and never part of `pnpm build`.
 *
 * Identity comes from the `x-loadtest-user` header. The stub refuses to run
 * unless LOADTEST_AUTH_STUB=1 is set, so an accidentally deployed bundle
 * fails closed (every request is signed out).
 */
import type { NextFunction, Request, Response } from "express";

const enabled = () => process.env.LOADTEST_AUTH_STUB === "1";

export function clerkMiddleware(_opts?: unknown) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const id = enabled() ? req.header("x-loadtest-user") : undefined;
    (req as any).auth = { userId: id ?? null, sessionId: id ? `sess_${id}` : null };
    next();
  };
}

export function getAuth(req: Request) {
  return (req as any).auth ?? { userId: null, sessionId: null };
}

export const clerkClient = {
  users: {
    getUser: async (id: string) => ({ id, emailAddresses: [], firstName: "Load", lastName: "Test" }),
  },
  sessions: { getSessionList: async () => ({ data: [] }) },
} as any;

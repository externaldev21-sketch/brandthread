/**
 * Serves the REAL /api/bg-removal and /api/photography routers on a local port
 * for hands-on app verification (artifacts/mobile/scripts/ai-image-tools-verify.mjs
 * forwards the web preview's calls here). Only sign-in is stubbed: a fixed
 * seller id stands in for Clerk. The model, the engine, validation and error
 * handling are the production code paths.
 *
 *   PORT=8791 DATABASE_URL=postgres://unused@127.0.0.1:1/unused tsx scripts/aiImageVerification/serveTools.ts
 *
 * (No database is touched by these routes; @workspace/db only insists the URL is set.)
 */
import express from "express";
import bgRemovalRouter from "../../src/routes/bg-removal";
import photographyRouter from "../../src/routes/photography";

const app = express();
app.use(express.json({ limit: "45mb" }));
app.use((req, _res, next) => {
  // What clerkMiddleware() leaves on the request for getAuth(): a branded auth handler.
  const auth = Object.assign(() => ({ userId: "user_verify_seller", sessionId: "sess_verify", tokenType: "session_token", isAuthenticated: true, getToken: async () => null }), {
    [Symbol.for("@clerk/express.auth")]: true,
  });
  (req as unknown as { auth: typeof auth }).auth = auth;
  next();
});
app.use(["/api/bg-removal", "/api/v1/bg-removal"], bgRemovalRouter);
app.use(["/api/photography", "/api/v1/photography"], photographyRouter);

const port = Number(process.env.PORT) || 8791;
app.listen(port, "127.0.0.1", () => console.log(`ai-image-tools verify server on http://127.0.0.1:${port}`));

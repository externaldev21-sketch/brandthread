import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { isAllowedWebOrigin } from "./lib/webOrigin";
import {
  apiErrorHandler,
  jsonNotFound,
  normalizeErrorResponses,
} from "./middlewares/errorHandling";
import { appRateLimiter, rateLimit } from "./middlewares/rateLimit";
import { validateMutationEnvelope } from "./middlewares/validateRequest";
import { DESIGN_STUDIO_ASSET_MIME_TYPES } from "./lib/designStudioAssetTypes";
import { requireAuth } from "./middlewares/requireAuth";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(normalizeErrorResponses);

// Clerk proxy must be mounted BEFORE body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Credentials (cookies) are only ever sent to a known first-party web
// origin for this environment — reflecting an arbitrary Origin header with
// credentials: true would let any site issue authenticated, cookie-bearing
// requests on a signed-in user's behalf. Non-browser callers (native mobile,
// server-to-server) send no Origin header and are unaffected by this check.
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, isAllowedWebOrigin(origin));
    },
  }),
);

// Baseline security headers for every response. These are static values that
// do not depend on request content, so setting them unconditionally here is
// safe for both API JSON responses and any static/error fallbacks.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  next();
});

// Stripe webhooks need the raw body for signature verification —
// register a raw parser scoped to just that path BEFORE express.json().
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
);
app.use(
  "/api/v1/webhooks/stripe",
  express.raw({ type: "application/json" }),
);

// Shopify webhooks are HMAC-signed over the raw body too.
app.use(
  "/api/webhooks/shopify",
  express.raw({ type: "application/json" }),
);
app.use(
  "/api/v1/webhooks/shopify",
  express.raw({ type: "application/json" }),
);

// Authentication and strict admission controls run before Design Studio binary
// bodies are buffered. Content-Length is only an early rejection; express.raw
// remains the authoritative streamed size limit.
const designStudioUploadAdmission = [
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
  requireAuth,
  rateLimit("asset-upload"),
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const length = Number(req.headers["content-length"]);
    if (Number.isFinite(length) && length > 40 * 1024 * 1024) {
      res.status(413).json({ error: "Design Studio asset is too large" });
      return;
    }
    next();
  },
];

// Design Studio master uploads must reach ingestion as the original bytes.
// Register both API aliases before the global JSON parser; the route verifies
// byte signatures and dimensions and stores the same Buffer without re-encoding.
app.use(
  "/api/design-studio/projects/:projectId/assets/:kind",
  ...designStudioUploadAdmission,
  express.raw({ type: DESIGN_STUDIO_ASSET_MIME_TYPES, limit: "40mb" }),
);
app.use(
  "/api/v1/design-studio/projects/:projectId/assets/:kind",
  ...designStudioUploadAdmission,
  express.raw({ type: DESIGN_STUDIO_ASSET_MIME_TYPES, limit: "40mb" }),
);

// Tighter limit for every store AI route that can receive visual references
// (logo, moodboard, and social screenshots). Clients pre-resize images before
// uploading; a 10 MB ceiling keeps vision requests within a safe token budget.
app.use("/api/store/ai", express.json({ limit: "10mb" }));
app.use("/api/v1/store/ai", express.json({ limit: "10mb" }));

// Raised from the default 100kb so requests carrying base64-encoded reference
// photos (e.g. AI product photography uploads) don't get rejected.
app.use(express.json({ limit: "45mb" }));
app.use(express.urlencoded({ extended: true, limit: "45mb" }));
app.use(validateMutationEnvelope);

// Clerk session middleware — handles both cookie (web) and Bearer token (mobile)
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use(appRateLimiter);
app.use("/api/v1", (_req, res, next) => {
  res.setHeader("X-Brandthread-API-Version", "1");
  next();
});
app.use("/api", (req, res, next) => {
  if (req.path === "/v1" || req.path.startsWith("/v1/")) {
    next();
    return;
  }
  res.setHeader("X-Brandthread-API-Version", "1");
  res.setHeader("Deprecation", "true");
  res.setHeader("Sunset", "Wed, 31 Dec 2027 23:59:59 GMT");
  res.setHeader("Link", `</api/v1${req.path}>; rel="successor-version"`);
  next();
});

app.use("/api/v1", router);
app.use("/api", router);
app.use("/api/v1", jsonNotFound);
app.use("/api", jsonNotFound);
app.use(apiErrorHandler);

export default app;

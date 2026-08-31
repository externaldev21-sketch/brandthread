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
import {
  apiErrorHandler,
  jsonNotFound,
  normalizeErrorResponses,
} from "./middlewares/errorHandling";
import { appRateLimiter } from "./middlewares/rateLimit";
import { validateMutationEnvelope } from "./middlewares/validateRequest";

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

app.use(cors({ credentials: true, origin: true }));

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

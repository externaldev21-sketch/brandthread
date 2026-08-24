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

const app: Express = express();

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

// Clerk proxy must be mounted BEFORE body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));

// Stripe webhooks need the raw body for signature verification —
// register a raw parser scoped to just that path BEFORE express.json().
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
);

// Tighter limit for every store AI route that can receive visual references
// (logo, moodboard, and social screenshots). Clients pre-resize images before
// uploading; a 10 MB ceiling keeps vision requests within a safe token budget.
app.use("/api/store/ai", express.json({ limit: "10mb" }));

// Raised from the default 100kb so requests carrying base64-encoded reference
// photos (e.g. AI product photography uploads) don't get rejected.
app.use(express.json({ limit: "45mb" }));
app.use(express.urlencoded({ extended: true, limit: "45mb" }));

// Clerk session middleware — handles both cookie (web) and Bearer token (mobile)
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;

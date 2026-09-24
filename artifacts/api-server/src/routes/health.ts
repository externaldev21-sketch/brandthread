import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const READINESS_TIMEOUT_MS = 2_000;

async function checkDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("Database readiness check timed out")),
          READINESS_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Database check failed",
    };
  }
}

/**
 * Liveness: is the process itself up and able to handle an HTTP request.
 * This must never check external dependencies (DB, Stripe, etc.) — an
 * orchestrator uses liveness to decide whether to kill and restart the
 * process, and restarting a healthy process because a downstream dependency
 * is having trouble only makes an outage worse. Kept at "/" for backward
 * compatibility with existing probes pointed at /healthz.
 */
router.get("/", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/live", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness: can this instance actually serve traffic right now. Used by the
 * load balancer / orchestrator to decide whether to route requests to this
 * instance. Checks the one hard dependency every request effectively needs
 * (Postgres). Returns 503 (not 200) when a dependency is down so traffic is
 * routed away from this instance instead of erroring on every request.
 */
router.get("/ready", async (_req, res) => {
  const database = await checkDatabase();
  const ready = database.ok;

  if (!ready) {
    logger.warn({ checks: { database } }, "Readiness check failed");
  }

  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "unavailable",
    checks: { database },
  });
});

export default router;

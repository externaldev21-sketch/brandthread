import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = fs.readFileSync(
  path.resolve(__dirname, "..", "index.ts"),
  "utf8",
);
const manufacturersSource = fs.readFileSync(
  path.resolve(__dirname, "..", "manufacturers.ts"),
  "utf8",
);

describe("paid route mounts", () => {
  it("keeps every paid route behind an explicit minimum plan", () => {
    expect(routesSource).toContain(
      'router.use("/logo",            tc, requirePlan("growth"), logoRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/mockup",          tc, requirePlan("growth"), mockupRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/photography",     tc, requirePlan("growth"), photographyRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/bg-removal",      tc, requirePlan("growth"), bgRemovalRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/lifestyle",       tc, requirePlan("growth"), lifestyleRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/techpack",        tc, requirePlan("growth"), techpackRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/manufacturers",   tc, manufacturersRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/team",                      teamRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/live",                      tc, requirePlan("pro"), liveRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/boosts",                    tc, requirePlan("pro"), boostsRouter);',
    );
  });

  it("gates seller manufacturer actions without blocking manufacturer onboarding", () => {
    expect(manufacturersSource).toContain(
      'const requireGrowthSeller = [requireAuth, teamContext(), requirePlan("growth")] as const;',
    );
    expect(manufacturersSource).toContain(
      'router.post("/invite-tokens", ...requireGrowthSeller',
    );
    expect(manufacturersSource).toContain(
      'router.get("/threads/:threadId/messages", ...requireGrowthSeller',
    );
    expect(manufacturersSource).toContain(
      'router.get("/invite-tokens/resolve/:token", async',
    );
    expect(manufacturersSource).toContain(
      'router.post("/register-via-invite/:token", async',
    );
  });
});
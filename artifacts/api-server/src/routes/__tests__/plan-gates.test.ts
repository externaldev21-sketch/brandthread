import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = fs.readFileSync(
  path.resolve(__dirname, "..", "index.ts"),
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
      'router.use("/manufacturers",   tc, requirePlan("growth"), manufacturersRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/team",                      tc, requirePlan("scale"), teamRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/live",                      tc, requirePlan("scale"), liveRouter);',
    );
    expect(routesSource).toContain(
      'router.use("/boosts",                    tc, requirePlan("scale"), boostsRouter);',
    );
  });
});
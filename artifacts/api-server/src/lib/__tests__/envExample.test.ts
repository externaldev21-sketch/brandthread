import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const envExample = fs.readFileSync(path.resolve(__dirname, "../../../../../.env.example"), "utf8");
const value = (key: string) => envExample.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

describe(".env.example", () => {
  it("points the Meta OAuth redirect at the /api route the server serves", () => {
    const uri = value("META_REDIRECT_URI");
    expect(uri).toBeDefined();
    expect(new URL(uri!).pathname).toBe("/api/meta-ads/oauth/callback");
  });

  it("documents the webhook secrets and job switches these flows depend on", () => {
    for (const key of ["SHIPPO_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET", "BACKGROUND_JOBS", "STRIPE_BNPL_ENABLED"]) {
      expect(value(key), key).toBeDefined();
    }
  });
});

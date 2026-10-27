/**
 * End to end through the real route and the real model: a seeded runway photo
 * goes in as the app sends it (a JPEG data URL), and the PNG that comes back is
 * inspected pixel by pixel. Opt-in, because the model is ~224 MB and needs
 * several GB of RAM:
 *
 *   BG_REMOVAL_MODEL_DIR=<dir with the .onnx> RUN_BG_MODEL_TEST=1 pnpm vitest run bg-removal-remove.real
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import sharp from "sharp";
import { bgModelPath } from "../../lib/bgRemoval/segmenter";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "user_real_e2e"; next(); },
}));

const enabled = process.env.RUN_BG_MODEL_TEST === "1" && fs.existsSync(bgModelPath());

describe.runIf(enabled)("POST /api/bg-removal/remove with the real model", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const { default: router } = await import("../bg-removal");
    const app = express();
    app.use(express.json({ limit: "20mb" }));
    app.use("/api/bg-removal", router);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  it("returns a same-size RGBA PNG: background fully clear, subject solid, a soft anti-aliased edge, original pixels kept", async () => {
    const photo = fs.readFileSync(path.resolve(__dirname, "../../../../mobile/assets/videos/fashion_runway_09.jpg"));
    const res = await fetch(`${base}/api/bg-removal/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: `data:image/jpeg;base64,${photo.toString("base64")}` }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mime).toBe("image/png");
    const png = Buffer.from(body.b64_json, "base64");
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([1080, 1920, 4]);

    let clear = 0, solid = 0, soft = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) clear++; else if (data[i] === 255) solid++; else soft++;
    }
    const n = info.width * info.height;
    expect(clear / n).toBeGreaterThan(0.5); // the runway set is gone
    expect(solid / n).toBeGreaterThan(0.15); // the model is kept
    expect(soft / n).toBeGreaterThan(0.002); // a real matte, not a hard binary mask
    expect(soft / n).toBeLessThan(0.08);

    // Not a redraw: deep inside the subject the colour is the original photo's.
    const orig = await sharp(photo).raw().toBuffer();
    const x = Math.round(info.width * 0.5), y = Math.round(info.height * 0.5);
    const i = y * info.width + x;
    expect(data[i * 4 + 3]).toBe(255);
    for (let c = 0; c < 3; c++) expect(Math.abs(data[i * 4 + c]! - orig[i * 3 + c]!)).toBeLessThanOrEqual(2);
  }, 240_000);
});

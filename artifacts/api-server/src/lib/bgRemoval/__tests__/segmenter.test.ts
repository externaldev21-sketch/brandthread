import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BG_MODELS, bgModelName, bgModelPath, decontaminate, removeBackground } from "../segmenter";

const GB = 1024 ** 3;

describe("background-removal model choice", () => {
  it("uses BiRefNet when the process may use 7 GB or more, IS-Net below that", () => {
    expect(bgModelName({}, 16 * GB)).toBe("birefnet-general-lite");
    expect(bgModelName({}, 7 * GB)).toBe("birefnet-general-lite");
    expect(bgModelName({}, 4 * GB)).toBe("isnet-general-use");
  });

  it("lets BG_REMOVAL_MODEL pin a model and ignores unknown names", () => {
    expect(bgModelName({ BG_REMOVAL_MODEL: "birefnet-general" }, 2 * GB)).toBe("birefnet-general");
    expect(bgModelName({ BG_REMOVAL_MODEL: "u2net" }, 2 * GB)).toBe("isnet-general-use");
  });

  it("resolves the model file from BG_REMOVAL_MODEL_PATH, then BG_REMOVAL_MODEL_DIR", () => {
    expect(bgModelPath({ BG_REMOVAL_MODEL_PATH: "/m/x.onnx" })).toBe("/m/x.onnx");
    expect(bgModelPath({ BG_REMOVAL_MODEL_DIR: "/models" }, "birefnet-general-lite")).toBe(
      path.join("/models", BG_MODELS["birefnet-general-lite"].file),
    );
    expect(bgModelPath({}, "isnet-general-use")).toMatch(/api-server[\\/]\.models[\\/]isnet-general-use\.onnx$/);
  });
});

describe("edge colour decontamination", () => {
  it("pulls a half-transparent edge pixel toward the nearby subject colour, leaves solid and empty pixels alone", async () => {
    // 21x1 strip: red subject on the left, green background on the right, one soft edge pixel.
    const width = 21;
    const rgb = Buffer.alloc(width * 3);
    const matte = Buffer.alloc(width);
    for (let x = 0; x < width; x++) {
      const subject = x < 10;
      rgb.set(subject ? [220, 20, 20] : [20, 200, 20], x * 3);
      matte[x] = subject ? 255 : 0;
    }
    rgb.set([120, 110, 20], 10 * 3); // edge pixel: half subject, half background
    matte[10] = 128;

    const out = await decontaminate({ rgb, width, height: 1 }, matte);
    const px = (x: number) => [...out.subarray(x * 4, x * 4 + 4)];
    expect(px(0)).toEqual([220, 20, 20, 255]);
    expect(px(20)).toEqual([20, 200, 20, 0]);
    const [r, g, , a] = px(10);
    expect(a).toBe(128);
    expect(r).toBeGreaterThan(120); // toward the red subject
    expect(g).toBeLessThan(110); // away from the green background
  });
});

// The real model is ~224 MB and needs several GB of RAM, so this only runs where
// it is already on disk: BG_REMOVAL_MODEL_DIR=<dir with the .onnx> RUN_BG_MODEL_TEST=1.
const modelReady = process.env.RUN_BG_MODEL_TEST === "1" && fs.existsSync(bgModelPath());
describe.runIf(modelReady)("real segmentation on a seeded runway photo", () => {
  it("returns a PNG of the same size with a transparent background and a solid subject", async () => {
    const photo = fs.readFileSync(path.resolve(__dirname, "../../../../../mobile/assets/videos/fashion_runway_07.jpg"));
    const result = await removeBackground(photo);
    expect([result.width, result.height]).toEqual([1080, 1920]);
    const { data, info } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    expect(alpha(10, 10)).toBe(0); // backdrop corner
    expect(alpha(info.width - 10, 10)).toBe(0);
    expect(alpha(Math.round(info.width / 2), Math.round(info.height * 0.45))).toBeGreaterThan(250); // the model's torso
    expect(result.coverage).toBeGreaterThan(0.1);
    expect(result.coverage).toBeLessThan(0.6);
  }, 180_000);
});

/**
 * Slide output dimensions/quality — the helpers compose-slideshow renders
 * every slide with. No DB or storage; real sharp.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, posts: {}, users: {} }));
vi.mock("../../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../../lib/objectAcl", () => ({ ObjectPermission: {} }));

import sharp from "sharp";
import {
  MAX_SLIDE_BYTES,
  SLIDE_CANVAS,
  SLIDE_THUMB_WIDTH,
  encodeSlide,
  renderSlideBase,
} from "../post-slide";

/** A 12 MP iPhone-style photo: stored landscape 4032x3024, EXIF says rotate 90°. */
async function iphonePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 120, g: 90, b: 160 } } })
    .composite([{ input: { text: { text: "BRANDTHREAD fine print 0123456789", dpi: 600 } }, top: 200, left: 200 }])
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe("compose-slideshow canvases", () => {
  it("is 1080 wide for every ratio (9:16 is 1080x1920)", () => {
    expect(SLIDE_CANVAS["9:16"]).toEqual({ w: 1080, h: 1920 });
    expect(SLIDE_CANVAS["3:4"]).toEqual({ w: 1080, h: 1440 });
    expect(SLIDE_CANVAS["4:5"]).toEqual({ w: 1080, h: 1350 });
    expect(SLIDE_CANVAS["1:1"]).toEqual({ w: 1080, h: 1080 });
  });

  it("accepts a full-resolution phone JPEG", () => {
    expect(MAX_SLIDE_BYTES).toBeGreaterThanOrEqual(40 * 1024 * 1024);
  });

  for (const ratio of Object.keys(SLIDE_CANVAS)) {
    it(`renders a 12 MP portrait photo to exactly ${SLIDE_CANVAS[ratio].w}x${SLIDE_CANVAS[ratio].h} (${ratio})`, async () => {
      const canvas = SLIDE_CANVAS[ratio];
      const png = await renderSlideBase(await iphonePhoto(), canvas);
      const { slide, thumb } = await encodeSlide(png, canvas);
      const meta = await sharp(slide).metadata();
      expect([meta.width, meta.height]).toEqual([canvas.w, canvas.h]);
      expect(meta.format).toBe("jpeg");
      // Full chroma — text and fabric edges don't smear.
      expect(meta.chromaSubsampling).toBe("4:4:4");
      // No EXIF/GPS on what viewers download.
      expect(meta.exif).toBeUndefined();
      const t = await sharp(thumb).metadata();
      expect(t.width).toBe(SLIDE_THUMB_WIDTH);
      expect(t.height).toBe(Math.round((SLIDE_THUMB_WIDTH * canvas.h) / canvas.w));
    });
  }

  it("applies EXIF orientation before filling the canvas", async () => {
    // Stored landscape: left half red, right half blue; EXIF 6 = rotate 90° CW,
    // so the displayed photo is red on top, blue at the bottom.
    const half = (r: number, b: number) => sharp({ create: { width: 200, height: 300, channels: 3, background: { r, g: 0, b } } }).png().toBuffer();
    const stored = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#000" } })
      .composite([{ input: await half(255, 0), left: 0, top: 0 }, { input: await half(0, 255), left: 200, top: 0 }])
      .withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const png = await renderSlideBase(stored, { w: 1080, h: 1440 });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
    expect(px(540, 100)[0]).toBeGreaterThan(200); // top is red
    expect(px(540, 1340)[2]).toBeGreaterThan(200); // bottom is blue
  });
});

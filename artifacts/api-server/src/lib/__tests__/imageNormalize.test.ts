import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../objectAcl", () => ({ getObjectAclPolicy: vi.fn(), setObjectAclPolicy: vi.fn() }));
vi.mock("../objectStorage", async () => {
  const actual = await vi.importActual<typeof import("../objectStorage")>("../objectStorage");
  class FakeObjectStorageService {}
  return { ...actual, ObjectStorageService: FakeObjectStorageService };
});

import sharp from "sharp";
import {
  IMAGE_VARIANT_WIDTHS,
  MAX_STORED_IMAGE_EDGE,
  fitLongEdge,
  normalizeUploadedImage,
  resizeImageBuffer,
  snapVariantWidth,
} from "../productImageResize";

const solid = (width: number, height: number, channels: 3 | 4 = 3) => ({
  create: { width, height, channels, background: { r: 200, g: 100, b: 50, alpha: channels === 4 ? 0.5 : 1 } },
});

describe("fitLongEdge", () => {
  it("scales the long edge down and preserves aspect ratio", () => {
    expect(fitLongEdge(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitLongEdge(3000, 6000)).toEqual({ width: 1024, height: 2048 });
    const out = fitLongEdge(4032, 3024);
    expect(out.width / out.height).toBeCloseTo(4032 / 3024, 2);
    expect(Math.max(out.width, out.height)).toBe(MAX_STORED_IMAGE_EDGE);
  });

  it("never upscales", () => {
    expect(fitLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitLongEdge(2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it("never returns a zero side and ignores invalid input", () => {
    expect(fitLongEdge(10000, 1)).toEqual({ width: 2048, height: 1 });
    expect(fitLongEdge(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("snapVariantWidth", () => {
  it("snaps to an allowed width", () => {
    expect(snapVariantWidth(300)).toBe(240);
    expect(snapVariantWidth(400)).toBe(480);
    expect(snapVariantWidth(5000)).toBe(1600);
    expect(snapVariantWidth(-1)).toBe(IMAGE_VARIANT_WIDTHS[0]);
    expect(snapVariantWidth(Number.NaN)).toBe(IMAGE_VARIANT_WIDTHS[0]);
  });
});

describe("resizeImageBuffer / normalizeUploadedImage", () => {
  let big: Buffer;
  let withExif: Buffer;
  beforeAll(async () => {
    big = await sharp(solid(3000, 1500)).jpeg({ quality: 95 }).toBuffer();
    withExif = await sharp(solid(400, 300))
      .withExif({ IFD0: { Copyright: "secret", Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 0/1 0/1" } })
      .jpeg({ quality: 100 })
      .toBuffer();
  });

  it("caps the long edge at 2048, keeps aspect ratio and shrinks the file", async () => {
    const { buffer, contentType } = await normalizeUploadedImage(big, "image/jpeg");
    const meta = await sharp(buffer).metadata();
    expect(contentType).toBe("image/jpeg");
    expect(meta.width).toBe(2048);
    expect(meta.height).toBe(1024);
    expect(buffer.length).toBeLessThan(big.length);
  });

  it("strips EXIF and GPS even when the image is already small", async () => {
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const { buffer } = await normalizeUploadedImage(withExif, "image/jpeg");
    const meta = await sharp(buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it("never upscales a small image", async () => {
    const tiny = await sharp(solid(32, 32)).jpeg({ quality: 40 }).toBuffer();
    const out = await normalizeUploadedImage(tiny, "image/jpeg");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(32);
    expect(out.buffer.length).toBeLessThanOrEqual(tiny.length);
  });

  it("keeps PNG transparency", async () => {
    const png = await sharp(solid(3000, 3000, 4)).png().toBuffer();
    const { buffer, contentType } = await normalizeUploadedImage(png, "image/png");
    const meta = await sharp(buffer).metadata();
    expect(contentType).toBe("image/png");
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(2048);
  });

  it("applies EXIF orientation before stripping it", async () => {
    const rotated = await sharp(solid(400, 200)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const { buffer } = await resizeImageBuffer(rotated, "image/jpeg");
    const meta = await sharp(buffer).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(400);
  });

  it("resizes to a variant width without enlarging", async () => {
    const small = await sharp(solid(500, 250)).jpeg().toBuffer();
    expect((await sharp((await resizeImageBuffer(small, "image/jpeg", { width: 720 })).buffer).metadata()).width).toBe(500);
    expect((await sharp((await resizeImageBuffer(big, "image/jpeg", { width: 720 })).buffer).metadata()).width).toBe(720);
  });

  it("passes GIFs and undecodable bytes through unchanged", async () => {
    const gif = Buffer.from("GIF89a-not-really");
    expect((await normalizeUploadedImage(gif, "image/gif")).buffer).toBe(gif);
    const junk = Buffer.from("definitely not an image");
    const out = await normalizeUploadedImage(junk, "image/jpeg");
    expect(out.buffer).toBe(junk);
    expect(out.contentType).toBe("image/jpeg");
  });
});

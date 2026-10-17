import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, { bytes: Buffer; contentType: string; custom?: Record<string, string> }>());
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile(path: string) {
      const f = files.get(path);
      if (!f) throw new Error("not found");
      return {
        getMetadata: async () => [{ contentType: f.contentType, size: f.bytes.length, metadata: f.custom }],
        download: async () => [f.bytes],
      };
    }
    async getObjectEntityDownloadURL(path: string) { return path; }
  },
}));

import sharp from "sharp";
import {
  dimsFromMetadata,
  dimsMetadata,
  imageBufferDims,
  measurePostMedia,
  objectPathFor,
  postDimsPayload,
  videoDims,
} from "../mediaDimensions";

const jpeg = (w: number, h: number, orientation?: number) => {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: "#888" } });
  return (orientation ? img.withMetadata({ orientation }) : img).jpeg().toBuffer();
};

describe("dimension metadata", () => {
  it("round-trips through GCS custom metadata", () => {
    const meta = dimsMetadata({ width: 1080, height: 1920 });
    expect(dimsFromMetadata({ metadata: meta })).toEqual({ width: 1080, height: 1920 });
    expect(dimsFromMetadata({})).toBeNull();
    expect(dimsMetadata({ width: 0, height: 10 })).toBeUndefined();
  });

  it("maps our media URLs back to object paths and ignores foreign hosts", () => {
    expect(objectPathFor("https://api.example/api/posts/media/uploads/abc")).toBe("/objects/uploads/abc");
    expect(objectPathFor("/objects/uploads/x")).toBe("/objects/uploads/x");
    expect(objectPathFor("https://cdn.example/a.jpg")).toBeNull();
    expect(objectPathFor("https://api.example/api/posts/media/../etc")).toBeNull();
  });

  it("serializes unknown (0/null) sizes as null", () => {
    expect(postDimsPayload({ mediaWidth: 0, mediaHeight: null, thumbnailWidth: 540, thumbnailHeight: 720 })).toEqual({
      mediaWidth: null, mediaHeight: null, thumbnailWidth: 540, thumbnailHeight: 720, mediaDimensions: [],
    });
  });
});

describe("measuring", () => {
  it("applies EXIF orientation to image sizes", async () => {
    expect(await imageBufferDims(await jpeg(400, 300))).toEqual({ width: 400, height: 300 });
    expect(await imageBufferDims(await jpeg(400, 300, 6))).toEqual({ width: 300, height: 400 });
  });

  it("measures a slideshow from stamped metadata, falling back to decoding", async () => {
    files.clear();
    files.set("/objects/uploads/s1", { bytes: Buffer.from("x"), contentType: "image/jpeg", custom: dimsMetadata({ width: 1080, height: 1440 }) });
    files.set("/objects/uploads/s2", { bytes: await jpeg(736, 981), contentType: "image/jpeg" });
    files.set("/objects/uploads/t", { bytes: await jpeg(540, 720), contentType: "image/jpeg" });
    const d = await measurePostMedia({
      mediaUrl: "/objects/uploads/s1",
      thumbnailUrl: "https://api.example/api/posts/media/uploads/t",
      mediaPaths: ["/objects/uploads/s1", "/objects/uploads/s2"],
    });
    expect(d.mediaDimensions).toEqual([{ width: 1080, height: 1440 }, { width: 736, height: 981 }]);
    expect([d.mediaWidth, d.mediaHeight]).toEqual([1080, 1440]);
    expect([d.thumbnailWidth, d.thumbnailHeight]).toEqual([540, 720]);
  });

  it("stamps per-slide sizes onto carousel slides and marks unmeasurable media 0", async () => {
    files.clear();
    files.set("/objects/uploads/p", { bytes: await jpeg(1080, 1440), contentType: "image/jpeg" });
    const d = await measurePostMedia({
      mediaUrl: "", slides: [{ kind: "photo", path: "/objects/uploads/p", thumbnailPath: "/objects/uploads/p" }, { kind: "photo", path: "/objects/uploads/missing" }],
    });
    expect(d.slides?.[0]).toMatchObject({ width: 1080, height: 1440 });
    expect(d.slides?.[1]).not.toHaveProperty("width");
    const none = await measurePostMedia({ mediaUrl: "/objects/uploads/missing" });
    expect(none.mediaWidth).toBe(0);
  });
});

let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }

describe.skipIf(!ffmpeg)("video sizes", () => {
  it("reports display size through rotation metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "md-"));
    try {
      const src = join(dir, "a.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=0.3", "-c:v", "libx264", "-preset", "ultrafast", src]);
      expect(await videoDims(src)).toEqual({ width: 320, height: 180 });
      const rotated = join(dir, "r.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", "90", "-i", src, "-c", "copy", rotated]);
      expect(await videoDims(rotated)).toEqual({ width: 180, height: 320 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

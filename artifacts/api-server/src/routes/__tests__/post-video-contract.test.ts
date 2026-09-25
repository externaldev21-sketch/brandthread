import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const postsRoute = fs.readFileSync(path.resolve(__dirname, "..", "posts.ts"), "utf8");
const videoRoute = fs.readFileSync(path.resolve(__dirname, "..", "post-video.ts"), "utf8");

describe("post video publication contract", () => {
  it("returns signed owner preview URLs while composed objects remain private", () => {
    expect(videoRoute).toContain('router.post("/compose-video", requireAuth');
    expect(videoRoute).toContain('visibility: "private"');
    expect(videoRoute).toContain(
      "storage.getObjectEntityDownloadURL(outputObject, COMPOSED_PREVIEW_TTL_SECONDS)",
    );
    expect(videoRoute).toContain(
      "storage.getObjectEntityDownloadURL(thumbnailObject, COMPOSED_PREVIEW_TTL_SECONDS)",
    );
  });

  it("keeps stable media ACL-protected until verified publication", () => {
    expect(videoRoute).toContain('router.get("/media/*path"');
    expect(videoRoute).toContain("storage.canAccessObjectEntity");
    expect(videoRoute).toContain("requestedPermission: ObjectPermission.READ");
    expect(videoRoute).toContain("requestedPermission: ObjectPermission.WRITE");
    expect(videoRoute).toContain("setComposedMediaVisibility");
    expect(postsRoute).toContain("setComposedMediaVisibility(");
    expect(postsRoute).toContain('nextMediaPaths, "private"');
    expect(postsRoute).toContain('nextMediaPaths, "public"');
    expect(postsRoute).toContain("composedMediaUrl(req, mediaPath)");
    expect(postsRoute).toContain("composedMediaUrl(req, thumbnailPath)");
  });

  it("revalidates stored clips and cleans source objects after composition", () => {
    expect(videoRoute).toContain("isSupportedVideo(contentType, bytes)");
    expect(videoRoute).toContain("MAX_TOTAL_DURATION_SECONDS = 600");
    expect(videoRoute).toContain("storage.deleteObjectEntity(path)");
    expect(videoRoute).toContain("OBJECT_PATH_RE");
    expect(videoRoute).toContain('req.get("range")');
    expect(videoRoute).toContain("file.createReadStream({ start, end })");
  });

  it("lets a seller re-extract the cover frame at a chosen offset without re-encoding", () => {
    // Previously the composed thumbnail was always grabbed at a fixed
    // offset (min(0.5, duration/3)) with no way for the seller to pick a
    // different frame as their cover image.
    expect(videoRoute).toContain('router.post("/compose-video/thumbnail", requireAuth');
    expect(videoRoute).toContain("validObjectPath(mediaPath)");
    expect(videoRoute).toContain("requestedPermission: ObjectPermission.WRITE");
    expect(videoRoute).toContain('"-ss", String(clampedOffset)');
    expect(videoRoute).toContain('visibility: "private"');
  });
});
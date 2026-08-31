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
});
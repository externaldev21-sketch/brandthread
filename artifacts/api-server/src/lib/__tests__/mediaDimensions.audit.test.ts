/**
 * POST /posts accepts client-supplied external mediaUrls, and measureMedia
 * fetches them server-side. It must never reach internal addresses (cloud
 * metadata, the object-storage sidecar on 127.0.0.1:1106, private networks).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() { throw new Error("not found"); }
    async getObjectEntityDownloadURL(path: string) { return path; }
  },
}));

import { isPublicMediaUrl, measureMedia } from "../mediaDimensions";

afterEach(() => { vi.restoreAllMocks(); });

describe("measureMedia external URLs", () => {
  it("never fetches internal hosts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const url of [
      "http://169.254.169.254/latest/meta-data/iam.jpg",
      "http://127.0.0.1:1106/credential",
      "http://10.0.0.7/internal.png",
      "http://[::1]/x.png",
      "http://localhost/x.png",
    ]) {
      expect(await measureMedia(url), url).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still measures images on public hosts", async () => {
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#000" } }).png().toBuffer();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }));
    expect(await measureMedia("https://93.184.216.34/a.png")).toEqual({ width: 30, height: 20 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("isPublicMediaUrl rejects credentials and non-web schemes", async () => {
    expect(await isPublicMediaUrl("https://user:pw@93.184.216.34/a.png")).toBe(false);
    expect(await isPublicMediaUrl("file:///etc/passwd")).toBe(false);
    expect(await isPublicMediaUrl("https://93.184.216.34/a.png")).toBe(true);
  });
});

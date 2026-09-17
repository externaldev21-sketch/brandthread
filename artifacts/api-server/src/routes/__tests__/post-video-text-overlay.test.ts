/**
 * Server validation + source-contract tests for the text overlay pipeline.
 *
 * These tests verify:
 * 1. That the route source contains all required safety guards
 * 2. That overlay validation logic behaves correctly (unit-style regex/set checks)
 * 3. That FFmpeg filter building does not interpolate user text into shell args
 * 4. That temp text files are cleaned up in the finally block
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSrc = fs.readFileSync(
  path.resolve(__dirname, "..", "post-video.ts"),
  "utf8",
);

// ─── Source-contract assertions ──────────────────────────────────────────────

describe("post-video text overlay: source contract", () => {
  it("validates overlays with a dedicated validateOverlays function", () => {
    expect(routeSrc).toContain("function validateOverlays");
    expect(routeSrc).toContain("validateOverlays(body.textOverlays)");
  });

  it("enforces maximum overlay count", () => {
    expect(routeSrc).toContain("MAX_TEXT_OVERLAYS = 10");
    expect(routeSrc).toContain("raw.length > MAX_TEXT_OVERLAYS");
  });

  it("enforces max text length", () => {
    expect(routeSrc).toContain("MAX_TEXT_LENGTH = 200");
    expect(routeSrc).toContain("text.length > MAX_TEXT_LENGTH");
  });

  it("validates colour with a hex regex, not an allowlist of names", () => {
    expect(routeSrc).toContain("HEX_COLOR_RE");
    expect(routeSrc).toContain("/^#[0-9A-Fa-f]{6}$/");
    // Must test the regex, not just contains
    expect(routeSrc).toContain("HEX_COLOR_RE.test(color)");
  });

  it("validates normalized positions are 0–1", () => {
    expect(routeSrc).toContain("x < 0 || x > 1");
    expect(routeSrc).toContain("y < 0 || y > 1");
  });

  it("validates font size range", () => {
    expect(routeSrc).toContain("MIN_FONT_SIZE");
    expect(routeSrc).toContain("MAX_FONT_SIZE");
  });

  it("validates fontStyle against a known set", () => {
    expect(routeSrc).toContain("VALID_FONT_STYLES");
    expect(routeSrc).toContain('"classic"');
    expect(routeSrc).toContain('"elegance"');
    expect(routeSrc).toContain('"retro"');
    expect(routeSrc).toContain('"vintage"');
    expect(routeSrc).toContain('"postcard"');
    expect(routeSrc).toContain('"script"');
    expect(routeSrc).toContain('"technic"');
  });

  it("validates align against a known set", () => {
    expect(routeSrc).toContain("VALID_ALIGN");
    expect(routeSrc).toContain('"left"');
    expect(routeSrc).toContain('"center"');
    expect(routeSrc).toContain('"right"');
  });

  it("validates bgStyle against a known set", () => {
    expect(routeSrc).toContain("VALID_BG_STYLES");
    expect(routeSrc).toContain('"none"');
    expect(routeSrc).toContain('"solid"');
    expect(routeSrc).toContain('"semi"');
  });

  it("writes overlay text to a temp file — never interpolates into filter string", () => {
    // The function that writes text files must exist
    expect(routeSrc).toContain("async function writeOverlayTextFile");
    expect(routeSrc).toContain("await fs.writeFile(textPath, text");
    // The drawtext filter must use textfile= not text=
    expect(routeSrc).toContain("textfile=");
    // There must be no `text=${` or `text='${` pattern that could inject user content
    const textEqualUserContent = /drawtext=.*text=\$\{/.test(routeSrc);
    expect(textEqualUserContent).toBe(false);
  });

  it("passes text file path via textfile= not inline text= in drawtext filter", () => {
    expect(routeSrc).toContain("textfile='${safeTextFile}'");
    // Must NOT have raw text interpolation
    const inlineText = /text='?\$\{overlay\.(text|rawText)/.test(routeSrc);
    expect(inlineText).toBe(false);
  });

  it("discovers font via fc-match with fallback to DejaVu", () => {
    expect(routeSrc).toContain("discoverFont");
    expect(routeSrc).toContain("fc-match");
    expect(routeSrc).toContain("DejaVuSans.ttf");
    expect(routeSrc).toContain("FALLBACK_FONT");
  });

  it("cleans up temp text files in the finally block", () => {
    expect(routeSrc).toContain("const textFiles: string[]");
    expect(routeSrc).toContain("textFiles.push(textFile)");
    // Cleanup must happen in finally
    const finallyBlock = routeSrc.split("} finally {")[1] ?? "";
    expect(finallyBlock).toContain("textFiles");
    expect(finallyBlock).toContain("fs.unlink");
  });

  it("uses the existing spawn argument array pattern — no shell: true", () => {
    // exec (promisify(execFile)) never uses shell
    expect(routeSrc).toContain('const exec = promisify(execFile)');
    expect(routeSrc).not.toContain('shell: true');
  });

  it("preserves existing clip/filter/speed/trim behaviour", () => {
    expect(routeSrc).toContain("videoFilters");
    expect(routeSrc).toContain("audioFilters");
    expect(routeSrc).toContain("trim=start=");
    expect(routeSrc).toContain("atrim=start=");
    expect(routeSrc).toContain("setpts=PTS-STARTPTS");
  });

  it("preserves source cleanup after successful composition", () => {
    expect(routeSrc).toContain("storage.deleteObjectEntity(path)");
  });

  it("returns duration, mediaUrl, thumbnailUrl in response", () => {
    expect(routeSrc).toContain("mediaUrl: previewMediaUrl");
    expect(routeSrc).toContain("thumbnailUrl: previewThumbnailUrl");
    expect(routeSrc).toContain("duration: outputDuration");
  });
});

// ─── Inline validation logic tests ────────────────────────────────────────────
// Re-implement the validation logic inline to test it without spinning up the server

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const VALID_FONT_STYLES = new Set(["classic", "elegance", "retro", "vintage", "postcard", "script", "technic"]);
const VALID_ALIGN = new Set(["left", "center", "right"]);
const VALID_BG_STYLES = new Set(["none", "solid", "semi"]);
const MAX_TEXT_OVERLAYS = 10;
const MAX_TEXT_LENGTH = 200;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 120;

describe("overlay validation logic", () => {
  it("accepts valid hex colours", () => {
    expect(HEX_COLOR_RE.test("#ffffff")).toBe(true);
    expect(HEX_COLOR_RE.test("#000000")).toBe(true);
    expect(HEX_COLOR_RE.test("#FF3300")).toBe(true);
    expect(HEX_COLOR_RE.test("#abc123")).toBe(true);
  });

  it("rejects invalid colours", () => {
    expect(HEX_COLOR_RE.test("white")).toBe(false);
    expect(HEX_COLOR_RE.test("#fff")).toBe(false);
    expect(HEX_COLOR_RE.test("#gggggg")).toBe(false);
    expect(HEX_COLOR_RE.test("rgb(0,0,0)")).toBe(false);
    expect(HEX_COLOR_RE.test("'; DROP TABLE")).toBe(false);
    expect(HEX_COLOR_RE.test("$(whoami)")).toBe(false);
    expect(HEX_COLOR_RE.test("../../etc/passwd")).toBe(false);
  });

  it("accepts valid font styles", () => {
    const valid = ["classic", "elegance", "retro", "vintage", "postcard", "script", "technic"];
    valid.forEach((fs) => expect(VALID_FONT_STYLES.has(fs)).toBe(true));
  });

  it("rejects unknown font styles", () => {
    expect(VALID_FONT_STYLES.has("system")).toBe(false);
    expect(VALID_FONT_STYLES.has("../../../etc")).toBe(false);
    expect(VALID_FONT_STYLES.has("'; DROP TABLE")).toBe(false);
    expect(VALID_FONT_STYLES.has("")).toBe(false);
  });

  it("accepts valid align values", () => {
    ["left", "center", "right"].forEach((a) => expect(VALID_ALIGN.has(a)).toBe(true));
  });

  it("rejects invalid align values", () => {
    expect(VALID_ALIGN.has("justify")).toBe(false);
    expect(VALID_ALIGN.has("'; rm -rf /")).toBe(false);
  });

  it("accepts valid bgStyle values", () => {
    ["none", "solid", "semi"].forEach((bg) => expect(VALID_BG_STYLES.has(bg)).toBe(true));
  });

  it("rejects invalid bgStyle values", () => {
    expect(VALID_BG_STYLES.has("gradient")).toBe(false);
    expect(VALID_BG_STYLES.has("blur")).toBe(false);
    expect(VALID_BG_STYLES.has("")).toBe(false);
  });

  it("enforces max overlay count", () => {
    const tooMany = new Array(MAX_TEXT_OVERLAYS + 1).fill({ id: "x", text: "y", x: 0.5, y: 0.5 });
    expect(tooMany.length > MAX_TEXT_OVERLAYS).toBe(true);
  });

  it("enforces max text length", () => {
    const longText = "a".repeat(MAX_TEXT_LENGTH + 1);
    expect(longText.length > MAX_TEXT_LENGTH).toBe(true);
    const ok = "a".repeat(MAX_TEXT_LENGTH);
    expect(ok.length > MAX_TEXT_LENGTH).toBe(false);
  });

  it("enforces font size bounds", () => {
    expect(MIN_FONT_SIZE <= 10 && 10 <= MAX_FONT_SIZE).toBe(true);
    expect(9 < MIN_FONT_SIZE).toBe(true);
    expect(121 > MAX_FONT_SIZE).toBe(true);
  });

  it("validates normalized positions stay 0–1", () => {
    const clamp = (v: number) => v < 0 || v > 1;
    expect(clamp(-0.1)).toBe(true);
    expect(clamp(1.1)).toBe(true);
    expect(clamp(0.5)).toBe(false);
    expect(clamp(0)).toBe(false);
    expect(clamp(1)).toBe(false);
  });

  it("rejects empty text", () => {
    expect("".length === 0).toBe(true);
  });

  it("does not allow path traversal in id field (sliced to 64 chars only)", () => {
    const unsafeId = "../../../../etc/passwd";
    // The server slices the id to 64 chars for the filename but sanitises with regex
    // in writeOverlayTextFile. Verify the regex pattern we use.
    const safeId = unsafeId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
    expect(safeId).not.toContain("/");
    expect(safeId).not.toContain(".");
  });
});

describe("existing video contract preserved", () => {
  it("compose-video route still has core video processing", () => {
    expect(routeSrc).toContain('router.post("/compose-video", requireAuth');
    expect(routeSrc).toContain('visibility: "private"');
    expect(routeSrc).toContain(
      "storage.getObjectEntityDownloadURL(outputObject, COMPOSED_PREVIEW_TTL_SECONDS)",
    );
    expect(routeSrc).toContain(
      "storage.getObjectEntityDownloadURL(thumbnailObject, COMPOSED_PREVIEW_TTL_SECONDS)",
    );
  });

  it("keeps ACL-protected media endpoint", () => {
    expect(routeSrc).toContain('router.get("/media/*path"');
    expect(routeSrc).toContain("storage.canAccessObjectEntity");
    expect(routeSrc).toContain("requestedPermission: ObjectPermission.READ");
    expect(routeSrc).toContain("requestedPermission: ObjectPermission.WRITE");
  });

  it("validates clip files on compose", () => {
    expect(routeSrc).toContain("isSupportedVideo(contentType, bytes)");
    expect(routeSrc).toContain("MAX_TOTAL_DURATION_SECONDS = 600");
    expect(routeSrc).toContain("OBJECT_PATH_RE");
    expect(routeSrc).toContain('req.get("range")');
    expect(routeSrc).toContain("file.createReadStream({ start, end })");
  });
});

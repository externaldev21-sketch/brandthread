import { describe, expect, it } from "vitest";
import { adjustFilters, cropFilter, NO_ADJUST, parseAdjust, parseCrop } from "../carouselAdjust";
import { MAX_SLIDES_BY_SURFACE } from "../postLimits";

describe("carousel adjust", () => {
  it("does nothing for the default look", () => {
    expect(adjustFilters(NO_ADJUST)).toEqual([]);
  });
  it("builds one eq filter and the other tools in a fixed order", () => {
    const f = adjustFilters({ ...NO_ADJUST, brightness: 50, contrast: -20, saturation: 10, warmth: 40, structure: 25, fade: 30, vignette: 50 });
    expect(f[0]).toBe("eq=brightness=0.2000:contrast=0.9000:saturation=1.1000");
    expect(f.map((x) => x.split("=")[0])).toEqual(["eq", "colorbalance", "unsharp", "curves", "vignette"]);
  });
  it("rejects out-of-range and non-numeric values", () => {
    expect(parseAdjust({ brightness: 101 }).ok).toBe(false);
    expect(parseAdjust({ fade: -1 }).ok).toBe(false);
    expect(parseAdjust({ contrast: "1;rm -rf" }).ok).toBe(false);
    expect(parseAdjust(undefined)).toEqual({ ok: true, adjust: NO_ADJUST });
  });
  it("validates crop rectangles", () => {
    expect(parseCrop({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }).ok).toBe(true);
    expect(parseCrop({ x: 0.6, y: 0, width: 0.6, height: 1 }).ok).toBe(false);
    expect(cropFilter({ x: 0, y: 0, width: 1, height: 1 })).toContain("crop=w='trunc(iw*1.00000/2)*2'");
  });
  it("caps: POST 14, THREAD 30", () => {
    expect(MAX_SLIDES_BY_SURFACE).toEqual({ thread: 30, profile: 14 });
  });
});

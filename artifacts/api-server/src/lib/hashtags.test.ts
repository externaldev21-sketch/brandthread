import { describe, expect, it } from "vitest";
import {
  extractHashtagsFromCaption, isTagAllowedPublicly, mergeHashtags, normalizeHashtag, normalizeHashtags,
} from "./hashtags";

describe("normalizeHashtag", () => {
  it("strips '#', lowercases and applies NFKC", () => {
    expect(normalizeHashtag("#OOTD")).toBe("ootd");
    expect(normalizeHashtag("##Street_Style")).toBe("street_style");
    expect(normalizeHashtag("ＦＵＬＬＷＩＤＴＨ")).toBe("fullwidth");
  });
  it("drops disallowed characters and keeps unicode letters", () => {
    expect(normalizeHashtag("#my-tag!")).toBe("mytag");
    expect(normalizeHashtag("#café")).toBe("café");
    expect(normalizeHashtag("#東京ファッション")).toBe("東京ファッション");
    expect(normalizeHashtag("#😀")).toBeNull();
  });
  it("caps at 30 characters and rejects empties / non-strings", () => {
    expect(normalizeHashtag("a".repeat(45))).toHaveLength(30);
    expect(normalizeHashtag("#")).toBeNull();
    expect(normalizeHashtag("   ")).toBeNull();
    expect(normalizeHashtag(42)).toBeNull();
  });
});

describe("normalizeHashtags", () => {
  it("dedupes case-insensitively and keeps first-seen order", () => {
    expect(normalizeHashtags(["#Fit", "fit", "FIT", "#Drop"])).toEqual(["fit", "drop"]);
  });
  it("caps at 30 tags per post", () => {
    const many = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    expect(normalizeHashtags(many)).toHaveLength(30);
  });
  it("returns [] for non-arrays", () => {
    expect(normalizeHashtags(undefined)).toEqual([]);
    expect(normalizeHashtags("#a")).toEqual([]);
  });
});

describe("extractHashtagsFromCaption", () => {
  it("finds tags anywhere in a caption", () => {
    expect(extractHashtagsFromCaption("New drop #Vintage and #y2k_fits!")).toEqual(["vintage", "y2k_fits"]);
    expect(extractHashtagsFromCaption("#first line\nsecond #Second")).toEqual(["first", "second"]);
  });
  it("ignores ordinals, url anchors and mid-word hashes", () => {
    expect(extractHashtagsFromCaption("#1 seller, item #2")).toEqual([]);
    expect(extractHashtagsFromCaption("see https://x.test/page#section")).toEqual([]);
    expect(extractHashtagsFromCaption("abc#def")).toEqual([]);
  });
  it("handles no caption", () => {
    expect(extractHashtagsFromCaption(null)).toEqual([]);
    expect(extractHashtagsFromCaption("plain text")).toEqual([]);
  });
});

describe("mergeHashtags", () => {
  it("normalises the explicit array and adds caption tags without duplicates", () => {
    expect(mergeHashtags(["#Launch", "sale"], "Big #SALE and #newdrop")).toEqual(["launch", "sale", "newdrop"]);
  });
  it("keeps plain arrays unchanged when the caption has no tags", () => {
    expect(mergeHashtags(["launch"], "Ready to ship")).toEqual(["launch"]);
    expect(mergeHashtags(undefined, "")).toEqual([]);
  });
});

describe("isTagAllowedPublicly", () => {
  it("allows ordinary tags and blocks threats", () => {
    expect(isTagAllowedPublicly("streetwear")).toBe(true);
    expect(isTagAllowedPublicly("kill_yourself")).toBe(false);
  });
});

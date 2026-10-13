import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCommentMediaUrl, parseCommentMediaInput } from "../commentMedia";

const BUCKET = "unit-bucket";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = BUCKET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  else process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = saved;
});

const ours = `https://storage.googleapis.com/${BUCKET}/comment-media/u1/abc.jpg`;

describe("isCommentMediaUrl", () => {
  it("accepts only our comment-media prefix", () => {
    expect(isCommentMediaUrl(ours)).toBe(true);
    expect(isCommentMediaUrl(`https://storage.googleapis.com/${BUCKET}/community/u1/abc.jpg`)).toBe(false);
    expect(isCommentMediaUrl(`https://storage.googleapis.com/other/comment-media/u1/abc.jpg`)).toBe(false);
    expect(isCommentMediaUrl(`https://storage.googleapis.com/${BUCKET}/comment-media/../x.jpg`)).toBe(false);
    expect(isCommentMediaUrl(`${ours}?x=1`)).toBe(false);
    expect(isCommentMediaUrl(42)).toBe(false);
  });

  it("is off when storage is not configured", () => {
    delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    expect(isCommentMediaUrl(ours)).toBe(false);
  });
});

describe("parseCommentMediaInput", () => {
  it("treats missing media as none", () => {
    expect(parseCommentMediaInput(undefined)).toEqual({ ok: true, ref: null });
    expect(parseCommentMediaInput(null)).toEqual({ ok: true, ref: null });
  });

  it("accepts an upload id or our URL", () => {
    const id = "6f1c7d4e-2b9a-4c3d-8e5f-0a1b2c3d4e5f";
    expect(parseCommentMediaInput({ id })).toEqual({ ok: true, ref: { id } });
    expect(parseCommentMediaInput({ url: ours, width: 1 })).toEqual({ ok: true, ref: { url: ours } });
  });

  it("refuses anything else", () => {
    expect(parseCommentMediaInput("https://evil.example/a.jpg").ok).toBe(false);
    expect(parseCommentMediaInput({ url: "https://evil.example/a.jpg" }).ok).toBe(false);
    expect(parseCommentMediaInput({ id: "nope" }).ok).toBe(false);
    expect(parseCommentMediaInput([ours]).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  readGifDimensions,
  readJpegDimensions,
  readPngDimensions,
  readWebpMetadata,
} from "../design-studio";

describe("Design Studio image byte inspection", () => {
  it("reads exact PNG dimensions from IHDR without decoding or rewriting bytes", () => {
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const before = Buffer.from(bytes);
    expect(readPngDimensions(bytes)).toEqual({ width: 1, height: 1 });
    expect(bytes.equals(before)).toBe(true);
  });

  it("rejects bytes with a false PNG declaration", () => {
    expect(readPngDimensions(Buffer.from("not a png"))).toBeNull();
  });

  it("reads exact JPEG dimensions from a SOF marker without decoding or rewriting bytes", () => {
    const bytes = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08,
      0x15, 0x18, // 5400 high
      0x11, 0x94, // 4500 wide
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x00,
      0xff, 0xd9,
    ]);
    const before = Buffer.from(bytes);
    expect(readJpegDimensions(bytes)).toEqual({ width: 4500, height: 5400 });
    expect(bytes.equals(before)).toBe(true);
  });

  it("rejects bytes with a false JPEG declaration", () => {
    expect(readJpegDimensions(Buffer.from("not a jpeg"))).toBeNull();
  });

  it("reads a complete GIF without changing its bytes", () => {
    const bytes = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    const before = Buffer.from(bytes);
    expect(readGifDimensions(bytes)).toEqual({ width: 1, height: 1 });
    expect(bytes.equals(before)).toBe(true);
    expect(readGifDimensions(bytes.subarray(0, -1))).toBeNull();
  });

  it("reads lossless WebP dimensions without changing its bytes", () => {
    const bytes = Buffer.alloc(26);
    bytes.write("RIFF", 0, "ascii");
    bytes.writeUInt32LE(18, 4);
    bytes.write("WEBPVP8L", 8, "ascii");
    bytes.writeUInt32LE(5, 16);
    Buffer.from([0x2f, 0x01, 0x80, 0x00, 0x00]).copy(bytes, 20);
    const before = Buffer.from(bytes);
    expect(readWebpMetadata(bytes)).toEqual({ width: 2, height: 3, lossless: true });
    expect(bytes.equals(before)).toBe(true);
    expect(readWebpMetadata(bytes.subarray(0, -1))).toBeNull();
  });
});
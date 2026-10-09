import { describe, it, expect } from "vitest";
import {
  checkUpload, validateMediaAttachment, decideOrderShare, decidePostShare, decideProductShare,
  MAX_UPLOAD_BYTES, MAX_VOICE_SECONDS,
} from "../dmAttachmentPolicy";
import { resolveDmMediaRef, type DmMediaContext } from "../dmMedia";

const bytes = (...head: number[]) => Uint8Array.from([...head, ...new Array(32).fill(0)]);
const ftyp = () => Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]);
const ebml = () => bytes(0x1a, 0x45, 0xdf, 0xa3);

describe("checkUpload", () => {
  it("accepts m4a voice notes under both mime aliases", () => {
    for (const mime of ["audio/m4a", "audio/mp4", "audio/x-m4a"]) {
      const r = checkUpload(mime, ftyp());
      expect(r).toMatchObject({ ok: true, kind: "audio", ext: "m4a" });
    }
  });
  it("accepts browser webm/ogg audio (web preview recorder)", () => {
    expect(checkUpload("audio/webm", ebml())).toMatchObject({ ok: true, kind: "audio" });
    expect(checkUpload("audio/ogg", bytes(0x4f, 0x67, 0x67, 0x53))).toMatchObject({ ok: true, kind: "audio" });
  });
  it("rejects unknown and non-media mime types", () => {
    expect(checkUpload("text/html", bytes(0x3c))).toMatchObject({ ok: false, status: 400 });
    expect(checkUpload("audio/x-evil", bytes(0))).toMatchObject({ ok: false, status: 400 });
    expect(checkUpload(undefined, bytes(0))).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects content that does not match the declared type", () => {
    expect(checkUpload("image/png", bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c))).toMatchObject({ ok: false, status: 400 });
    expect(checkUpload("audio/m4a", bytes(1, 2, 3, 4))).toMatchObject({ ok: false, status: 400 });
  });
  it("enforces per-kind size caps", () => {
    const bigAudio = new Uint8Array(MAX_UPLOAD_BYTES.audio + 1);
    bigAudio.set(ftyp());
    expect(checkUpload("audio/m4a", bigAudio)).toMatchObject({ ok: false, status: 413 });
    const okVideo = new Uint8Array(MAX_UPLOAD_BYTES.audio + 1024);
    okVideo.set(ftyp());
    expect(checkUpload("video/mp4", okVideo)).toMatchObject({ ok: true, kind: "video" });
    const bigVideo = new Uint8Array(MAX_UPLOAD_BYTES.video + 1);
    bigVideo.set(ftyp());
    expect(checkUpload("video/mp4", bigVideo)).toMatchObject({ ok: false, status: 413 });
  });
  it("rejects empty files", () => {
    expect(checkUpload("image/jpeg", new Uint8Array(0))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("validateMediaAttachment", () => {
  const bucket = "b1";
  const good = `https://storage.googleapis.com/${bucket}/messaging/u/x.m4a`;
  it("passes non-media attachments through", () => {
    expect(validateMediaAttachment({ type: "product" }, bucket)).toEqual({ ok: true });
  });
  it("requires an https uri from our bucket", () => {
    expect(validateMediaAttachment({ type: "voice", uri: "file:///x.m4a" }, bucket).ok).toBe(false);
    expect(validateMediaAttachment({ type: "voice", uri: "https://evil.example/x.m4a" }, bucket).ok).toBe(false);
    expect(validateMediaAttachment({ type: "voice", uri: good }, bucket).ok).toBe(true);
    expect(validateMediaAttachment({ type: "image" }, bucket).ok).toBe(false);
  });
  it("caps voice note duration", () => {
    expect(validateMediaAttachment({ type: "voice", uri: good, meta: { duration: String(MAX_VOICE_SECONDS) } }, bucket).ok).toBe(true);
    expect(validateMediaAttachment({ type: "voice", uri: good, meta: { duration: String(MAX_VOICE_SECONDS + 1) } }, bucket).ok).toBe(false);
    expect(validateMediaAttachment({ type: "voice", uri: good, meta: { duration: "abc" } }, bucket).ok).toBe(false);
  });
  it("caps video duration", () => {
    expect(validateMediaAttachment({ type: "video", uri: good, meta: { duration: "60" } }, bucket).ok).toBe(true);
    expect(validateMediaAttachment({ type: "video", uri: good, meta: { duration: "600" } }, bucket).ok).toBe(false);
  });
});

describe("DM media refs (private uploads)", () => {
  const ctx: DmMediaContext = { bucketId: "b1", privateDir: "/b1/.private", cdnBase: null };
  const path = "/objects/messaging/user_2abc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
  const signed = `https://storage.googleapis.com/b1/.private/messaging/user_2abc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg?X-Goog-Signature=abc`;

  it("normalizes our signed URL (storage host or CDN) to the canonical path", () => {
    expect(resolveDmMediaRef(signed, ctx)).toEqual({ ok: true, kind: "canonical", value: path });
    const cdn = { ...ctx, cdnBase: "https://cdn.example.com/media" };
    expect(resolveDmMediaRef(`https://cdn.example.com/media/b1/.private/messaging/user_2abc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg?sig=1`, cdn))
      .toEqual({ ok: true, kind: "canonical", value: path });
    expect(resolveDmMediaRef(path, ctx)).toEqual({ ok: true, kind: "canonical", value: path });
  });

  it("keeps legacy public bucket URLs as-is", () => {
    const legacy = "https://storage.googleapis.com/b1/messaging/u/x.jpg";
    expect(resolveDmMediaRef(legacy, ctx)).toEqual({ ok: true, kind: "legacy", value: legacy });
  });

  it("refuses other private objects, path tricks and foreign hosts", () => {
    for (const uri of [
      "/objects/uploads/abc",
      "/objects/messaging/u/../../uploads/x.jpg",
      "https://storage.googleapis.com/b1/.private/uploads/abc?X-Goog-Signature=x",
      "https://storage.googleapis.com/b1/.private/messaging/u/not-a-uuid.jpg?X-Goog-Signature=x",
      "https://storage.googleapis.com/b1/other.jpg?X-Goog-Signature=x",
      "https://storage.googleapis.com/b2/messaging/u/x.jpg",
      "https://evil.example/b1/.private/messaging/user_2abc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg",
    ]) {
      expect(resolveDmMediaRef(uri, ctx).ok, uri).toBe(false);
    }
  });

  it("validateMediaAttachment returns the canonical uri and photoUris to store", () => {
    const r = validateMediaAttachment({ type: "image", uri: signed, meta: { photoUris: JSON.stringify([signed, path]) } }, ctx);
    expect(r).toEqual({ ok: true, uri: path, photoUris: JSON.stringify([path, path]) });
    expect(validateMediaAttachment({ type: "image", uri: signed, meta: { photoUris: JSON.stringify(["https://evil.example/x.jpg"]) } }, ctx).ok).toBe(false);
    expect(validateMediaAttachment({ type: "image", uri: signed, meta: { photoUris: "not json" } }, ctx).ok).toBe(false);
  });
});

describe("decideOrderShare", () => {
  const order = { ownerId: "seller", buyerId: "buyer" };
  it("lets the buyer share their own order with the seller", () => {
    expect(decideOrderShare({ order, senderId: "buyer", otherParticipantIds: ["seller"] }).ok).toBe(true);
  });
  it("lets the seller share with the buyer", () => {
    expect(decideOrderShare({ order, senderId: "seller", otherParticipantIds: ["buyer"] }).ok).toBe(true);
  });
  it("blocks a buyer sharing someone else's order", () => {
    expect(decideOrderShare({ order, senderId: "other", otherParticipantIds: ["seller"] })).toMatchObject({ ok: false, status: 403 });
  });
  it("blocks sharing with a third party", () => {
    expect(decideOrderShare({ order, senderId: "buyer", otherParticipantIds: ["friend"] })).toMatchObject({ ok: false, status: 403 });
    expect(decideOrderShare({ order, senderId: "buyer", otherParticipantIds: ["seller", "friend"] }).ok).toBe(false);
    expect(decideOrderShare({ order, senderId: "buyer", otherParticipantIds: [] }).ok).toBe(false);
  });
  it("blocks guest orders (no buyer account)", () => {
    expect(decideOrderShare({ order: { ownerId: "seller", buyerId: null }, senderId: "seller", otherParticipantIds: ["x"] }).ok).toBe(false);
  });
});

describe("decidePostShare", () => {
  const pub = { userId: "a", postStatus: "published", moderationStatus: "visible", visibility: { isPublic: true } };
  it("allows a public post from anyone", () => {
    expect(decidePostShare({ post: pub, senderId: "b" }).ok).toBe(true);
  });
  it("blocks drafts, removed and private posts from non-authors", () => {
    expect(decidePostShare({ post: { ...pub, postStatus: "draft" }, senderId: "b" }).ok).toBe(false);
    expect(decidePostShare({ post: { ...pub, moderationStatus: "removed" }, senderId: "b" }).ok).toBe(false);
    expect(decidePostShare({ post: { ...pub, visibility: { isPublic: false } }, senderId: "b" }).ok).toBe(false);
  });
  it("lets the author share their own", () => {
    expect(decidePostShare({ post: { ...pub, postStatus: "draft" }, senderId: "a" }).ok).toBe(true);
  });
});

describe("decideProductShare", () => {
  it("only active products", () => {
    expect(decideProductShare({ product: { status: "active" } }).ok).toBe(true);
    expect(decideProductShare({ product: { status: "draft" } })).toMatchObject({ ok: false, status: 400 });
  });
});

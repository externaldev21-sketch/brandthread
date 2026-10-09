/**
 * Pure policy for DM rich content (shared cards + uploaded media).
 * No DB / network access, so it is unit-testable without a database — the
 * routes in routes/conversations.ts load the rows and feed them in here.
 */
import { resolveDmMediaRef, type DmMediaContext } from "./dmMedia";

// ── Upload limits ────────────────────────────────────────────────────────────

export type UploadKind = "image" | "video" | "audio";

export const UPLOAD_MEDIA_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  // Some recorders (including this app's voice-message recorder) report the
  // informal "audio/m4a" mime type rather than the registered "audio/mp4".
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  // Browser MediaRecorder output (web preview voice notes).
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

export const MAX_UPLOAD_BYTES: Record<UploadKind, number> = {
  image: 12 * 1024 * 1024,
  video: 60 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
};

/** Voice notes are capped at 5 minutes; videos at the 1 minute the pickers enforce (+ slack). */
export const MAX_VOICE_SECONDS = 300;
export const MAX_VIDEO_SECONDS = 75;

export function uploadKindForMime(mime: string): UploadKind | null {
  if (!(mime in UPLOAD_MEDIA_MIME_EXTENSIONS)) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

export type UploadCheck =
  | { ok: true; kind: UploadKind; ext: string }
  | { ok: false; status: number; error: string };

/** Validates declared mime + decoded size + leading magic bytes. */
export function checkUpload(mimeRaw: unknown, bytes: Uint8Array): UploadCheck {
  const mime = typeof mimeRaw === "string" ? mimeRaw.toLowerCase() : "";
  const kind = uploadKindForMime(mime);
  if (!kind) {
    return { ok: false, status: 400, error: `mimeType must be one of: ${Object.keys(UPLOAD_MEDIA_MIME_EXTENSIONS).join(", ")}` };
  }
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "File is empty" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES[kind]) {
    return {
      ok: false,
      status: 413,
      error: `${kind[0].toUpperCase()}${kind.slice(1)} too large (max ${Math.round(MAX_UPLOAD_BYTES[kind] / 1048576)} MB)`,
    };
  }
  if (!magicBytesMatch(mime, bytes)) {
    return { ok: false, status: 400, error: "File contents do not match the declared type" };
  }
  return { ok: true, kind, ext: UPLOAD_MEDIA_MIME_EXTENSIONS[mime] };
}

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function magicBytesMatch(mime: string, b: Uint8Array): boolean {
  switch (mime) {
    case "image/jpeg": return b[0] === 0xff && b[1] === 0xd8;
    case "image/png": return b[0] === 0x89 && ascii(b, 1, 3) === "PNG";
    case "image/gif": return ascii(b, 0, 3) === "GIF";
    case "image/webp": return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP";
    case "audio/wav": return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE";
    case "video/mp4":
    case "video/quicktime":
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a": return ascii(b, 4, 4) === "ftyp";
    case "video/webm":
    case "audio/webm": return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case "audio/ogg": return ascii(b, 0, 4) === "OggS";
    case "audio/mpeg": return ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case "audio/aac": return (b[0] === 0xff && (b[1] & 0xf0) === 0xf0) || ascii(b, 4, 4) === "ftyp";
    default: return false;
  }
}

// ── Media attachment shape ───────────────────────────────────────────────────

export type MediaAttachmentCheck =
  | {
      ok: true;
      /** What to store for `uri` (canonical private path, or the legacy URL unchanged). */
      uri?: string;
      /** What to store for `meta.photoUris` (same normalization), when present. */
      photoUris?: string;
    }
  | { ok: false; error: string };

/** A multi-photo message carries its photos in meta.photoUris (a JSON string array). */
const MAX_PHOTO_URIS = 10;

/**
 * image/video/voice attachments: an upload-media reference (the canonical
 * private path, our signed URL for it, or a legacy public bucket URL) + sane
 * duration. `ctx` may be a bare bucket id (legacy callers) or the full
 * DmMediaContext; the normalized values to store are returned.
 */
export function validateMediaAttachment(
  att: { type?: string; uri?: unknown; meta?: Record<string, unknown> | null },
  ctx: string | DmMediaContext,
): MediaAttachmentCheck {
  if (att.type !== "image" && att.type !== "video" && att.type !== "voice") return { ok: true };
  const context: DmMediaContext = typeof ctx === "string" ? { bucketId: ctx, privateDir: "", cdnBase: null } : ctx;
  const uri = att.uri;
  if (typeof uri !== "string" || !(/^https:\/\//i.test(uri) || uri.startsWith("/"))) {
    return { ok: false, error: `${att.type} attachment requires an uploaded https uri.` };
  }
  const ref = resolveDmMediaRef(uri, context);
  if (!ref.ok) {
    return { ok: false, error: `${att.type} attachment must be uploaded through upload-media.` };
  }
  let photoUris: string | undefined;
  const rawPhotos = att.meta?.photoUris;
  if (rawPhotos != null && rawPhotos !== "") {
    let list: unknown;
    try { list = typeof rawPhotos === "string" ? JSON.parse(rawPhotos) : rawPhotos; } catch { list = null; }
    if (!Array.isArray(list) || list.length > MAX_PHOTO_URIS) {
      return { ok: false, error: "Invalid photo list." };
    }
    const normalized: string[] = [];
    for (const item of list) {
      const r = resolveDmMediaRef(item, context);
      if (!r.ok) return { ok: false, error: `${att.type} attachment must be uploaded through upload-media.` };
      normalized.push(r.value);
    }
    photoUris = JSON.stringify(normalized);
  }
  if (att.type === "voice" || att.type === "video") {
    const raw = att.meta?.duration;
    if (raw != null && raw !== "") {
      const secs = Number(raw);
      const cap = att.type === "voice" ? MAX_VOICE_SECONDS : MAX_VIDEO_SECONDS;
      if (!Number.isFinite(secs) || secs < 0) return { ok: false, error: "Invalid media duration." };
      if (secs > cap) {
        return {
          ok: false,
          error: att.type === "voice"
            ? `Voice messages are limited to ${MAX_VOICE_SECONDS / 60} minutes.`
            : `Videos are limited to ${MAX_VIDEO_SECONDS} seconds.`,
        };
      }
    }
  }
  return { ok: true, uri: ref.value, ...(photoUris !== undefined ? { photoUris } : {}) };
}

// ── Shared entity access ─────────────────────────────────────────────────────

export type ShareDecision = { ok: true } | { ok: false; status: number; error: string };

/**
 * Order cards: the sender must be a party to the order (the seller, or the
 * buyer who placed it) and the conversation's other participants must all be
 * the order's counterpart — a buyer cannot push their order (tracking,
 * status) into a chat with an unrelated third party.
 */
export function decideOrderShare(input: {
  order: { ownerId: string; buyerId: string | null };
  senderId: string;
  otherParticipantIds: string[];
}): ShareDecision {
  const { order, senderId, otherParticipantIds } = input;
  const isSeller = order.ownerId === senderId;
  const isBuyer = !!order.buyerId && order.buyerId === senderId;
  if (!isSeller && !isBuyer) return { ok: false, status: 403, error: "You can only attach your own orders." };
  const counterpart = isSeller ? order.buyerId : order.ownerId;
  if (!counterpart || otherParticipantIds.length === 0 || otherParticipantIds.some((id) => id !== counterpart)) {
    return { ok: false, status: 403, error: "Orders can only be shared with the other party on the order." };
  }
  return { ok: true };
}

/**
 * Post cards: any published, visible, public post can be shared into any
 * conversation (it is already public — the card only shows caption/cover).
 * The author may always share their own.
 */
export function decidePostShare(input: {
  post: { userId: string; postStatus: string; moderationStatus: string; visibility: { isPublic?: boolean } | null };
  senderId: string;
}): ShareDecision {
  const { post, senderId } = input;
  if (post.userId === senderId) return { ok: true };
  const publicPost = post.postStatus === "published"
    && post.moderationStatus === "visible"
    && post.visibility?.isPublic !== false;
  if (!publicPost) return { ok: false, status: 403, error: "This post can't be shared." };
  return { ok: true };
}

/** Product cards: any active (publicly listed) product can be shared. */
export function decideProductShare(input: { product: { status: string } }): ShareDecision {
  if (input.product.status !== "active") return { ok: false, status: 400, error: "Only active products can be attached." };
  return { ok: true };
}

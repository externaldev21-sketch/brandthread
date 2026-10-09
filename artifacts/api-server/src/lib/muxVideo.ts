/**
 * Video posts → adaptive HLS streaming via Mux (https://mux.com).
 *
 * OFF unless all three server env vars are set:
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET  — API access token (Settings → Access Tokens, "Mux Video" read+write)
 *   MUX_WEBHOOK_SECRET              — signing secret of the webhook pointing at /api/webhooks/mux
 *
 * Flow: after a published video post is created, `scheduleHlsTranscode`
 * hands Mux a short-lived signed URL of the stored MP4. Mux ingests it and
 * builds the rendition ladder (it is ABR by default). Its
 * `video.asset.ready` webhook stores `https://stream.mux.com/<playbackId>.m3u8`
 * on the post; the feed then prefers that URL and keeps the MP4 as fallback.
 * Nothing here ever throws into a request: failures are logged and the post
 * simply keeps playing its MP4.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

export interface MuxConfig {
  tokenId: string;
  tokenSecret: string;
  webhookSecret: string;
}

export function muxConfig(env: NodeJS.ProcessEnv = process.env): MuxConfig | null {
  const tokenId = (env.MUX_TOKEN_ID ?? "").trim();
  const tokenSecret = (env.MUX_TOKEN_SECRET ?? "").trim();
  const webhookSecret = (env.MUX_WEBHOOK_SECRET ?? "").trim();
  if (!tokenId || !tokenSecret || !webhookSecret) return null;
  return { tokenId, tokenSecret, webhookSecret };
}

const PLAYBACK_ID_RE = /^[A-Za-z0-9]{10,64}$/;

export function hlsUrlForPlaybackId(playbackId: string): string | null {
  return PLAYBACK_ID_RE.test(playbackId) ? `https://stream.mux.com/${playbackId}.m3u8` : null;
}

/** Signature tolerance for webhook replay protection (Mux recommends ~5 minutes). */
export const MUX_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verifies a `Mux-Signature: t=<unix>,v1=<hex hmac-sha256(secret, "<t>.<body>")>` header.
 */
export function verifyMuxSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = MUX_SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (!header || !secret) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s?.trim());
    if (key === "t" && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return signatures.some((sig) => {
    if (!/^[0-9a-f]+$/i.test(sig) || sig.length !== expected.length * 2) return false;
    return timingSafeEqual(Buffer.from(sig, "hex"), expected);
  });
}

export type MuxAssetEvent =
  | { kind: "ready"; assetId: string; postId: string | null; hlsUrl: string; posterUrl: string }
  | { kind: "errored"; assetId: string; postId: string | null }
  | null;

/** Pulls the parts of a Mux webhook this app cares about; null for anything else. */
export function parseMuxAssetEvent(event: unknown): MuxAssetEvent {
  const e = event as { type?: unknown; data?: { id?: unknown; passthrough?: unknown; playback_ids?: unknown } } | null;
  if (!e || typeof e.type !== "string" || !e.data || typeof e.data.id !== "string") return null;
  const assetId = e.data.id;
  const postId = typeof e.data.passthrough === "string" && e.data.passthrough ? e.data.passthrough : null;
  if (e.type === "video.asset.errored") return { kind: "errored", assetId, postId };
  if (e.type !== "video.asset.ready") return null;
  const ids = Array.isArray(e.data.playback_ids) ? e.data.playback_ids as Array<{ id?: unknown; policy?: unknown }> : [];
  const publicId = ids.find((p) => p && p.policy === "public" && typeof p.id === "string");
  const hlsUrl = publicId ? hlsUrlForPlaybackId(publicId.id as string) : null;
  if (!hlsUrl) return { kind: "errored", assetId, postId };
  // Poster frame Mux renders; only used when the post has no thumbnail of its own.
  const posterUrl = `https://image.mux.com/${publicId!.id as string}/thumbnail.jpg?time=0`;
  return { kind: "ready", assetId, postId, hlsUrl, posterUrl };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function authHeader(config: MuxConfig): string {
  return `Basic ${Buffer.from(`${config.tokenId}:${config.tokenSecret}`).toString("base64")}`;
}

/** Creates a Mux asset from a fetchable URL. Returns the asset id. */
export async function createMuxAsset(
  config: MuxConfig,
  inputUrl: string,
  passthrough: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<string> {
  const res = await fetchImpl("https://api.mux.com/video/v1/assets", {
    method: "POST",
    headers: { Authorization: authHeader(config), "Content-Type": "application/json" },
    body: JSON.stringify({
      input: [{ url: inputUrl }],
      playback_policy: ["public"],
      passthrough,
      video_quality: "basic",
      max_resolution_tier: "1080p",
    }),
  });
  if (!res.ok) throw new Error(`Mux asset create failed (${res.status})`);
  const body = (await res.json()) as { data?: { id?: unknown } };
  if (typeof body?.data?.id !== "string") throw new Error("Mux asset create returned no id");
  return body.data.id;
}

export async function deleteMuxAsset(
  config: MuxConfig,
  assetId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<void> {
  if (!/^[A-Za-z0-9]+$/.test(assetId)) return;
  const res = await fetchImpl(`https://api.mux.com/video/v1/assets/${assetId}`, {
    method: "DELETE",
    headers: { Authorization: authHeader(config) },
  });
  if (!res.ok && res.status !== 404) throw new Error(`Mux asset delete failed (${res.status})`);
}

/**
 * Fire-and-forget: start an HLS transcode of a just-published video post.
 * No-op when Mux is not configured or the post has no stored video path.
 */
export function scheduleHlsTranscode(postId: string, sourceObjectPath: string | null | undefined): void {
  const config = muxConfig();
  if (!config || !sourceObjectPath || !sourceObjectPath.startsWith("/objects/")) return;
  void (async () => {
    const { ObjectStorageService } = await import("./objectStorage");
    // Mux fetches the input right away; an hour leaves room for its queue.
    const inputUrl = await new ObjectStorageService().getObjectEntityDownloadURL(sourceObjectPath, 3600);
    const assetId = await createMuxAsset(config, inputUrl, postId);
    const { db, posts } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db.update(posts)
      .set({ videoMuxAssetId: assetId, videoHlsStatus: "pending" })
      .where(eq(posts.id, postId));
  })().catch((err) => logger.warn({ err, postId }, "HLS transcode could not be started"));
}

/** Fire-and-forget: remove the streaming copy of a deleted post. */
export function scheduleMuxAssetRemoval(assetId: string | null | undefined): void {
  const config = muxConfig();
  if (!config || !assetId) return;
  void deleteMuxAsset(config, assetId).catch((err) => logger.warn({ err, assetId }, "Mux asset removal failed"));
}
